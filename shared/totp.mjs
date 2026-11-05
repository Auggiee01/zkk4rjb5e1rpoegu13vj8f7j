/**
 * One-time password helpers (RFC 4226 HOTP, RFC 6238 TOTP, Steam Guard),
 * otpauth:// parsing/building and Google Authenticator export (otpauth-migration) import.
 * Works in the renderer, the Electron main process and Node (uses WebCrypto).
 */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEAM_CHARS = '23456789BCDFGHJKMNPQRTVWXY';
const subtle = globalThis.crypto.subtle;

export function base32Decode(input) {
  const s = String(input || '').toUpperCase().replace(/[\s=\-_]/g, '');
  if (!/^[A-Z2-7]*$/.test(s)) throw new Error('Secret key contains invalid characters (expected letters A–Z and digits 2–7)');
  const out = [];
  let bits = 0, value = 0;
  for (const ch of s) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

export function base32Encode(bytes) {
  let out = '', bits = 0, value = 0;
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base64ToBytes(b64) {
  const bin = atob(String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const HASHES = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };
const keyCache = new Map();

async function hmac(secretBytes, algorithm, msg) {
  const hash = HASHES[algorithm] || 'SHA-1';
  const cacheKey = hash + ':' + Array.from(secretBytes).join(',');
  let key = keyCache.get(cacheKey);
  if (!key) {
    key = await subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: { name: hash } }, false, ['sign']);
    if (keyCache.size > 500) keyCache.clear();
    keyCache.set(cacheKey, key);
  }
  return new Uint8Array(await subtle.sign('HMAC', key, msg));
}

function counterBytes(counter) {
  const buf = new Uint8Array(8);
  let c = BigInt(counter);
  for (let i = 7; i >= 0; i--) { buf[i] = Number(c & 0xffn); c >>= 8n; }
  return buf;
}

async function truncated(secretBytes, counter, algorithm) {
  const h = await hmac(secretBytes, algorithm, counterBytes(counter));
  const off = h[h.length - 1] & 0x0f;
  return ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
}

export async function hotp(secretBytes, counter, { algorithm = 'SHA1', digits = 6 } = {}) {
  const bin = await truncated(secretBytes, counter, algorithm);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export async function steamCode(secretBytes, counter) {
  let bin = await truncated(secretBytes, counter, 'SHA1');
  let code = '';
  for (let i = 0; i < 5; i++) { code += STEAM_CHARS[bin % STEAM_CHARS.length]; bin = Math.floor(bin / STEAM_CHARS.length); }
  return code;
}

/** Normalised OTP config stored in items: { type, secret (base32), algorithm, digits, period, counter, issuer, account } */
export function normalizeOtp(cfg) {
  const type = ['totp', 'hotp', 'steam'].includes(cfg.type) ? cfg.type : 'totp';
  const secret = String(cfg.secret || '').toUpperCase().replace(/[\s=\-_]/g, '');
  base32Decode(secret); // validate
  if (!secret) throw new Error('Secret key is empty');
  return {
    type,
    secret,
    algorithm: type === 'steam' ? 'SHA1' : (HASHES[String(cfg.algorithm || 'SHA1').toUpperCase().replace('-', '')] ? String(cfg.algorithm || 'SHA1').toUpperCase().replace('-', '') : 'SHA1'),
    digits: type === 'steam' ? 5 : ([6, 7, 8].includes(Number(cfg.digits)) ? Number(cfg.digits) : 6),
    period: type === 'steam' ? 30 : (Number(cfg.period) > 0 ? Number(cfg.period) : 30),
    counter: Number(cfg.counter) || 0,
    issuer: String(cfg.issuer || '').trim(),
    account: String(cfg.account || '').trim()
  };
}

/** Returns { code, remaining, period, progress } for TOTP/Steam, or { code } for HOTP. */
export async function generateCode(cfg, now = Date.now()) {
  const otp = normalizeOtp(cfg);
  const secret = base32Decode(otp.secret);
  if (otp.type === 'hotp') return { code: await hotp(secret, otp.counter, otp), counter: otp.counter };
  const seconds = Math.floor(now / 1000);
  const step = Math.floor(seconds / otp.period);
  const remaining = otp.period - (seconds % otp.period);
  const code = otp.type === 'steam' ? await steamCode(secret, step) : await hotp(secret, step, otp);
  return { code, remaining, period: otp.period, progress: remaining / otp.period, step };
}

export function parseOtpAuth(uri) {
  const text = String(uri || '').trim();
  if (/^otpauth-migration:/i.test(text)) throw new Error('This is a Google Authenticator export code — use “Import from Google Authenticator”');
  if (!/^otpauth:\/\//i.test(text)) {
    // Treat bare text as a secret key.
    return normalizeOtp({ type: 'totp', secret: text });
  }
  const u = new URL(text);
  const type = u.host.toLowerCase();
  let label = decodeURIComponent(u.pathname.replace(/^\//, ''));
  let issuer = u.searchParams.get('issuer') || '';
  let account = label;
  const idx = label.indexOf(':');
  if (idx >= 0) { const li = label.slice(0, idx).trim(); account = label.slice(idx + 1).trim(); if (!issuer) issuer = li; }
  const encoder = (u.searchParams.get('encoder') || '').toLowerCase();
  const isSteam = type === 'steam' || encoder === 'steam' || (/^steam$/i.test(issuer) && Number(u.searchParams.get('digits')) === 5);
  return normalizeOtp({
    type: isSteam ? 'steam' : type,
    secret: u.searchParams.get('secret') || '',
    algorithm: u.searchParams.get('algorithm') || 'SHA1',
    digits: u.searchParams.get('digits') || 6,
    period: u.searchParams.get('period') || 30,
    counter: u.searchParams.get('counter') || 0,
    issuer, account
  });
}

export function buildOtpAuth(cfg) {
  const o = normalizeOtp(cfg);
  const label = encodeURIComponent(o.issuer ? `${o.issuer}:${o.account}` : o.account || 'Account');
  const p = new URLSearchParams({ secret: o.secret });
  if (o.issuer) p.set('issuer', o.issuer);
  if (o.type === 'steam') { p.set('digits', '5'); p.set('encoder', 'steam'); return `otpauth://totp/${label}?${p}`; }
  if (o.algorithm !== 'SHA1') p.set('algorithm', o.algorithm);
  if (o.digits !== 6) p.set('digits', String(o.digits));
  if (o.type === 'totp' && o.period !== 30) p.set('period', String(o.period));
  if (o.type === 'hotp') p.set('counter', String(o.counter));
  return `otpauth://${o.type}/${label}?${p}`;
}

/** Steam Desktop Authenticator .maFile -> otp config. */
export function parseSteamMaFile(text) {
  const j = JSON.parse(text);
  if (!j.shared_secret) throw new Error('No shared_secret in this file');
  return normalizeOtp({ type: 'steam', secret: base32Encode(base64ToBytes(j.shared_secret)), issuer: 'Steam', account: j.account_name || '' });
}

// ---- Google Authenticator "Transfer accounts" (otpauth-migration://offline?data=...) ----
function readVarint(buf, pos) {
  let result = 0n, shift = 0n, b;
  do { b = buf[pos.i++]; result |= BigInt(b & 0x7f) << shift; shift += 7n; } while (b & 0x80);
  return result;
}
function readMessage(buf) {
  const pos = { i: 0 }; const fields = [];
  while (pos.i < buf.length) {
    const tag = Number(readVarint(buf, pos));
    const field = tag >>> 3, wire = tag & 7;
    if (wire === 0) fields.push([field, readVarint(buf, pos)]);
    else if (wire === 2) { const len = Number(readVarint(buf, pos)); fields.push([field, buf.slice(pos.i, pos.i + len)]); pos.i += len; }
    else if (wire === 1) pos.i += 8;
    else if (wire === 5) pos.i += 4;
    else throw new Error('Unsupported protobuf wire type');
  }
  return fields;
}
const td = new TextDecoder();
export function parseMigration(uri) {
  const u = new URL(String(uri).trim());
  const data = u.searchParams.get('data');
  if (!data) throw new Error('No data in migration code');
  const payload = readMessage(base64ToBytes(data));
  const out = [];
  for (const [field, value] of payload) {
    if (field !== 1) continue;
    const p = { secret: null, name: '', issuer: '', algorithm: 1, digits: 1, type: 2, counter: 0n };
    for (const [f, v] of readMessage(value)) {
      if (f === 1) p.secret = v; else if (f === 2) p.name = td.decode(v); else if (f === 3) p.issuer = td.decode(v);
      else if (f === 4) p.algorithm = Number(v); else if (f === 5) p.digits = Number(v); else if (f === 6) p.type = Number(v); else if (f === 7) p.counter = v;
    }
    let account = p.name, issuer = p.issuer;
    const idx = account.indexOf(':');
    if (idx >= 0) { if (!issuer) issuer = account.slice(0, idx); account = account.slice(idx + 1); }
    out.push(normalizeOtp({
      type: p.type === 1 ? 'hotp' : 'totp',
      secret: base32Encode(p.secret || new Uint8Array()),
      algorithm: { 2: 'SHA256', 3: 'SHA512' }[p.algorithm] || 'SHA1',
      digits: p.digits === 2 ? 8 : 6,
      counter: Number(p.counter),
      issuer: issuer.trim(), account: account.trim()
    }));
  }
  return out;
}

/** Accept anything a QR code or paste might contain and return a list of OTP configs. */
export function parseAnyOtp(text) {
  const t = String(text || '').trim();
  if (/^otpauth-migration:/i.test(t)) return parseMigration(t);
  if (t.startsWith('{') && t.includes('shared_secret')) return [parseSteamMaFile(t)];
  return [parseOtpAuth(t)];
}
