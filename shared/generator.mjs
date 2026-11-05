/**
 * Password / passphrase / PIN generator and strength estimation.
 * Randomness: crypto.getRandomValues with rejection sampling (no modulo bias).
 */
export const SETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>/?~'
};
export const AMBIGUOUS = 'Il1O0o|`\'"';

export function randomInt(max) {
  if (!(max > 0) || max > 2 ** 32) throw new Error('randomInt range');
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = randomInt(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

export const DEFAULT_PASSWORD_OPTIONS = {
  mode: 'password', length: 20, upper: true, lower: true, digits: true, symbols: true,
  symbolSet: SETS.symbols, avoidAmbiguous: false, requireEach: true, exclude: '',
  words: 5, separator: '-', capitalize: true, includeNumber: true,
  pinLength: 6
};

export function buildPools(o) {
  const strip = (s) => {
    let out = [...new Set(s)];
    if (o.avoidAmbiguous) out = out.filter((c) => !AMBIGUOUS.includes(c));
    if (o.exclude) out = out.filter((c) => !o.exclude.includes(c));
    return out.join('');
  };
  const pools = [];
  if (o.upper) pools.push(strip(SETS.upper));
  if (o.lower) pools.push(strip(SETS.lower));
  if (o.digits) pools.push(strip(SETS.digits));
  if (o.symbols) pools.push(strip(o.symbolSet || SETS.symbols));
  return pools.filter((p) => p.length > 0);
}

export function generatePassword(opts = {}) {
  const o = { ...DEFAULT_PASSWORD_OPTIONS, ...opts };
  const length = Math.max(4, Math.min(256, Math.floor(o.length)));
  const pools = buildPools(o);
  if (!pools.length) throw new Error('Choose at least one character type');
  const all = pools.join('');
  const chars = [];
  if (o.requireEach) for (const p of pools.slice(0, length)) chars.push(p[randomInt(p.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  return shuffle(chars).join('');
}

export function generatePin(length = 6) {
  let s = '';
  for (let i = 0; i < Math.max(3, Math.min(32, length)); i++) s += String(randomInt(10));
  return s;
}

export function generatePassphrase(wordlist, opts = {}) {
  const o = { ...DEFAULT_PASSWORD_OPTIONS, ...opts };
  const n = Math.max(3, Math.min(20, Math.floor(o.words)));
  const words = [];
  for (let i = 0; i < n; i++) {
    let w = wordlist[randomInt(wordlist.length)];
    if (o.capitalize) w = w[0].toUpperCase() + w.slice(1);
    words.push(w);
  }
  if (o.includeNumber) { const i = randomInt(words.length); words[i] = words[i] + String(randomInt(10)); }
  return words.join(o.separator ?? '-');
}

/** Exact entropy (bits) of a generator configuration. */
export function generatorEntropy(opts, wordlistSize = 7776) {
  const o = { ...DEFAULT_PASSWORD_OPTIONS, ...opts };
  if (o.mode === 'passphrase') return o.words * Math.log2(wordlistSize) + (o.includeNumber ? Math.log2(10 * o.words) : 0);
  if (o.mode === 'pin') return o.pinLength * Math.log2(10);
  const size = buildPools(o).join('').length;
  return size ? o.length * Math.log2(size) : 0;
}

const COMMON = new Set(('password 123456 123456789 12345678 12345 qwerty abc123 password1 111111 123123 admin letmein welcome monkey dragon football ' +
  'iloveyou 1234567 1234 000000 sunshine princess master login passw0rd shadow baseball superman trustno1 qwertyuiop 654321 ' +
  'starwars whatever freedom hello charlie donald batman access michael jordan minecraft roblox fortnite pokemon summer winter ' +
  'secret google discord steam blizzard battlenet qazwsx zaq12wsx asdfgh asdfghjkl zxcvbnm 1q2w3e4r 1qaz2wsx changeme test ' +
  'computer internet love lovely flower hunter killer soccer hockey ranger buster thomas tigger robert daniel jessica pepper').split(' '));

/**
 * Heuristic strength estimate for arbitrary (user-typed) passwords.
 * Returns { bits, score 0-4, label, crackTime }.
 */
export function estimateStrength(pw) {
  if (!pw) return { bits: 0, score: 0, label: 'Empty', crackTime: '—' };
  const lower = pw.toLowerCase();
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  if (/[^\x00-\x7f]/.test(pw)) pool += 100;
  // Effective length: collapse repeats and simple sequences.
  let eff = 0;
  for (let i = 0; i < pw.length; i++) {
    const c = pw.charCodeAt(i), p = pw.charCodeAt(i - 1), pp = pw.charCodeAt(i - 2);
    if (i >= 1 && c === p) { eff += 0.25; continue; }
    if (i >= 2 && c - p === p - pp && Math.abs(c - p) === 1) { eff += 0.35; continue; }
    eff += 1;
  }
  let bits = eff * Math.log2(Math.max(pool, 2));
  const stripped = lower.replace(/[^a-z]/g, '');
  if (COMMON.has(lower) || COMMON.has(lower.replace(/[0-9!@#$%^&*.]+$/, ''))) bits = Math.min(bits, 10);
  else for (const w of COMMON) if (w.length >= 5 && stripped.includes(w)) { bits -= w.length * 2.5; break; }
  if (/^(19|20)\d{2}$/.test(pw) || /^\d{1,8}$/.test(pw)) bits = Math.min(bits, pw.length * 3.32);
  bits = Math.max(0, bits);
  const score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { bits: Math.round(bits), score, label: ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'][score], crackTime: crackTime(bits) };
}

/** Rough offline crack time at 10 billion guesses/second against a fast hash. */
export function crackTime(bits) {
  const seconds = 2 ** bits / 2 / 1e10;
  if (seconds < 1) return 'instantly';
  const units = [['second', 60], ['minute', 60], ['hour', 24], ['day', 365], ['year', 1000], ['thousand years', 1000], ['million years', 1000], ['billion years', 1000]];
  let v = seconds;
  for (const [name, next] of units) {
    if (v < next) { const n = Math.floor(v); return `${n} ${name}${n === 1 || name.includes(' ') ? '' : 's'}`; }
    v /= next;
  }
  return 'longer than the universe has existed';
}
