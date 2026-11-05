/**
 * The Vault file format in the browser (iPhone app). Byte-for-byte compatible with src/main/vault.js:
 * same header, AES-256-GCM with the same AAD, scrypt / PBKDF2 key derivation.
 */
import { scrypt } from './scrypt.mjs';

const subtle = globalThis.crypto.subtle;
const FORMAT = 'keyhaven-vault';
const AAD_WRAP = new TextEncoder().encode('keyhaven-vault/v1/keywrap');
const AAD_DATA = new TextEncoder().encode('keyhaven-vault/v1/data');
export const SCRYPT_DEFAULT = { name: 'scrypt', N: 131072, r: 8, p: 1 };

export const b64 = (u8) => { let s = ''; const b = new Uint8Array(u8); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s) => { const bin = atob(String(s || '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

export class WrongPassword extends Error { constructor() { super('Incorrect master password'); this.code = 'WRONG_PASSWORD'; } }

export async function deriveKey(password, kdf, onProgress) {
  const msg = new TextEncoder().encode(String(password).normalize('NFC'));
  const salt = unb64(kdf.salt);
  if (kdf.name === 'scrypt') return scrypt(msg, salt, kdf.N, kdf.r, kdf.p, 32, onProgress);
  if (kdf.name === 'pbkdf2-sha256') {
    const k = await subtle.importKey('raw', msg, 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: kdf.iterations }, k, 256));
  }
  if (kdf.name === 'argon2id') throw new Error('This vault uses Argon2id, which iPhone browsers can’t run. Change the master password once in Vault on your PC (it will switch to scrypt) and try again.');
  throw new Error('Unknown key derivation: ' + kdf.name);
}

export async function seal(keyBytes, plain, aad) {
  const key = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = rand(12);
  const out = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plain));
  return { iv: b64(iv), ct: b64(out.subarray(0, out.length - 16)), tag: b64(out.subarray(out.length - 16)) };
}

export async function open(keyBytes, box, aad) {
  const key = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const ct = unb64(box.ct), tag = unb64(box.tag);
  const joined = new Uint8Array(ct.length + tag.length); joined.set(ct); joined.set(tag, ct.length);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: aad }, key, joined));
}

export function parseFile(text) {
  const f = typeof text === 'string' ? JSON.parse(text) : text;
  if (f.format !== FORMAT) throw new Error('This isn’t a Vault file');
  return f;
}

export const emptyPayload = () => ({ items: [], deleted: {}, generatorHistory: [], meta: { createdAt: new Date().toISOString() } });

export async function createFile(password, onProgress) {
  const kdf = { ...SCRYPT_DEFAULT, salt: b64(rand(16)) };
  const kek = await deriveKey(password, kdf, onProgress);
  const vaultKey = rand(32);
  const header = { format: FORMAT, version: 1, createdAt: new Date().toISOString(), kdf, keyWrap: await seal(kek, vaultKey, AAD_WRAP) };
  const payload = emptyPayload();
  return { header, vaultKey, payload, file: await sealFile(header, vaultKey, payload) };
}

export async function unwrapKey(file, password, onProgress) {
  const kek = await deriveKey(password, file.kdf, onProgress);
  try { return await open(kek, file.keyWrap, AAD_WRAP); } catch { throw new WrongPassword(); }
}

export async function openData(file, vaultKey) {
  const json = new TextDecoder().decode(await open(vaultKey, file.data, AAD_DATA));
  return { ...emptyPayload(), ...JSON.parse(json) };
}

export async function sealFile(header, vaultKey, payload) {
  const { data, ...h } = header;
  return { ...h, updatedAt: new Date().toISOString(), data: await seal(vaultKey, new TextEncoder().encode(JSON.stringify(payload)), AAD_DATA) };
}

export async function rewrapHeader(header, vaultKey, newPassword, onProgress) {
  const kdf = { ...SCRYPT_DEFAULT, salt: b64(rand(16)) };
  const kek = await deriveKey(newPassword, kdf, onProgress);
  return { ...header, kdf, keyWrap: await seal(kek, vaultKey, AAD_WRAP) };
}

/** A standalone encrypted backup protected by its own password. */
export async function exportEncrypted(payload, password, onProgress) {
  const kdf = { ...SCRYPT_DEFAULT, salt: b64(rand(16)) };
  const kek = await deriveKey(password, kdf, onProgress);
  const key = rand(32);
  return { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), kdf, keyWrap: await seal(kek, key, AAD_WRAP), data: await seal(key, new TextEncoder().encode(JSON.stringify(payload)), AAD_DATA) };
}

export { AAD_WRAP, AAD_DATA };
