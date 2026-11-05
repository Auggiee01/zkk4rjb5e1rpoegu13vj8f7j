/**
 * Vault for iPhone: provides the same `window.kh` API as the desktop app's preload script,
 * implemented in the browser. Everything is stored encrypted in IndexedDB on the phone.
 */
import * as W from '../shared/webvault.mjs';
import { mergePayloads } from '../shared/sync.mjs';

// ---------------------------------------------------------------- storage
const DB = 'vault-app';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvGet(k) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); }
async function kvSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }
async function kvDel(k) { const db = await idb(); return new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = () => res(); }); }
try { navigator.storage?.persist?.(); } catch { /* ignore */ }

// ---------------------------------------------------------------- settings
const DEFAULTS = {
  theme: 'system', accent: 'aura', scale: 1, density: 'comfortable', reduceMotion: false,
  autoLockMinutes: 5, lockOnSystemLock: true, lockOnMinimize: false, clipboardClearSeconds: 0, hideFromCapture: false,
  fetchIcons: false, breachCheck: false, autotypeEnabled: false, autotypeHotkey: '', autotypeSequence: '{USERNAME}{TAB}{PASSWORD}{ENTER}',
  autotypeDelay: 8, closeToTray: false, startWithWindows: false, generator: null, sidebarCollapsed: false, listSort: 'name', lastSync: null
};
let settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('vault.settings') || '{}') };
const saveSettings = () => localStorage.setItem('vault.settings', JSON.stringify(settings));

// ---------------------------------------------------------------- vault state
let header = null, vaultKey = null, payload = null;
let failed = 0;
const ok = (x = {}) => ({ ok: true, ...x });
const fail = (code, message) => ({ error: code, message });
const wrap = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { return fail(e.code || 'ERROR', e.message); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const progress = (p) => { const el = document.getElementById('go'); if (el && el.disabled && p > 0) el.dataset.p = Math.round(p * 100); };

async function persist() {
  const file = await W.sealFile(header, vaultKey, payload);
  header = { ...file, data: undefined };
  await kvSet('vaultFile', file);
}

function sanitize(raw) {
  const it = JSON.parse(JSON.stringify(raw));
  if (!it.id) it.id = crypto.randomUUID();
  if (!['login', 'card', 'note', 'identity', 'passkey', 'securitykey'].includes(it.type)) throw new Error('Unknown item type');
  it.name = String(it.name || '').slice(0, 300) || 'Untitled';
  return it;
}

function lockNow() {
  if (vaultKey) vaultKey.fill(0);
  vaultKey = null; payload = null;
  location.reload();
}

// ---------------------------------------------------------------- auto-lock
let lastActivity = Date.now(), hiddenAt = 0;
setInterval(() => { if (vaultKey && settings.autoLockMinutes > 0 && Date.now() - lastActivity > settings.autoLockMinutes * 60000) lockNow(); }, 5000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (vaultKey && hiddenAt && settings.lockOnSystemLock && Date.now() - hiddenAt > 60000) lockNow();
});

// ---------------------------------------------------------------- file pickers & saving
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    input.click();
  });
}
const readText = (f) => f.text();
const readB64 = async (f) => W.b64(new Uint8Array(await f.arrayBuffer()));

/** iOS only lets a page share a file straight after a tap, so show a button for it. */
async function offerFile(name, text, mime, title, note) {
  const file = new File([text], name, { type: mime });
  const { modal, toast } = await import('../renderer/ui.mjs');
  return modal({
    title, body: `<p class="modal-text">${note}</p>`,
    actions: [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Save to Files', value: true, kind: 'primary' }],
    onMount: (el, close) => {
      const btn = el.querySelector('.modal-foot .btn-primary');
      btn.addEventListener('click', async (e) => {
        e.stopImmediatePropagation();
        try {
          if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: name });
          else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click(); }
          close(true);
        } catch (err) { if (err.name !== 'AbortError') toast('Could not save: ' + err.message, { type: 'error' }); }
      }, { capture: true });
    }
  });
}

async function decodeQrFromBlob(blob) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height);
  return window.jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' })?.data || null;
}

async function resizeImage(blob, max = 128) {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

// ---------------------------------------------------------------- Face ID (passkey + PRF)
const enc = (s) => new TextEncoder().encode(s);
async function hkdf(bytes, info) {
  const k = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc('vault-faceid'), info: enc(info) }, k, 256));
}
const MASTER_DAYS = 14;
async function prfOutput(credId, salt, create) {
  if (create) {
    const cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'Vault', id: location.hostname }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Vault on this iPhone', displayName: 'Vault' },
      challenge: crypto.getRandomValues(new Uint8Array(32)), pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
      extensions: { prf: { eval: { first: salt } } }
    } });
    const r = cred.getClientExtensionResults().prf;
    if (r?.results?.first) return { credId: new Uint8Array(cred.rawId), out: new Uint8Array(r.results.first) };
    if (r && r.enabled === false) throw Object.assign(new Error('Face ID unlock needs iOS 18 or newer on this iPhone.'), { code: 'HELLO_ERROR' });
    credId = new Uint8Array(cred.rawId);
  }
  const a = await navigator.credentials.get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname, userVerification: 'required',
    allowCredentials: [{ type: 'public-key', id: credId }], extensions: { prf: { eval: { first: salt } } }
  } });
  const out = a.getClientExtensionResults().prf?.results?.first;
  if (!out) throw Object.assign(new Error('Face ID unlock needs iOS 18 or newer on this iPhone.'), { code: 'HELLO_ERROR' });
  return { credId, out: new Uint8Array(out) };
}
const helloErr = (e) => (e.name === 'NotAllowedError' || e.name === 'AbortError') ? fail('HELLO_CANCELED', 'Face ID was cancelled') : fail(e.code || 'HELLO_ERROR', e.message);

// ---------------------------------------------------------------- the API
const noop = () => () => {};
window.kh = {
  init: async () => {
    const file = await kvGet('vaultFile');
    const face = await kvGet('faceid');
    return {
      status: vaultKey ? 'unlocked' : file ? 'locked' : 'setup', settings, platform: 'ios', version: '1.2.0', kdf: 'scrypt',
      vaultPath: 'This iPhone (encrypted in the app’s storage)', autotypeSupported: false,
      hello: { supported: !!window.PublicKeyCredential, enabled: !!face, name: 'Face ID' }, hotkey: { ok: true }
    };
  },
  vault: {
    create: wrap(async (pw) => {
      if (String(pw).length < 8) throw new Error('Use at least 8 characters');
      const r = await W.createFile(pw, progress);
      header = { ...r.file, data: undefined }; vaultKey = r.vaultKey; payload = r.payload;
      await kvSet('vaultFile', r.file);
      return ok({ data: payload });
    }),
    unlock: wrap(async (pw) => {
      if (failed) await sleep(Math.min(30000, 500 * 2 ** (failed - 1)));
      const file = await kvGet('vaultFile');
      try { vaultKey = await W.unwrapKey(file, pw, progress); } catch (e) { if (e.code === 'WRONG_PASSWORD') failed++; throw e; }
      failed = 0;
      payload = await W.openData(file, vaultKey); header = { ...file, data: undefined };
      const face = await kvGet('faceid'); if (face) { face.lastMaster = Date.now(); await kvSet('faceid', face); }
      lastActivity = Date.now();
      return ok({ data: payload });
    }),
    lock: async () => { lockNow(); return ok(); },
    data: async () => (payload ? ok({ data: payload }) : fail('LOCKED', 'Locked')),
    upsert: wrap(async (list) => {
      const now = new Date().toISOString();
      for (const raw of Array.isArray(list) ? list : [list]) {
        const it = sanitize(raw);
        const i = payload.items.findIndex((x) => x.id === it.id);
        if (i >= 0) { it.createdAt = payload.items[i].createdAt || now; it.updatedAt = now; payload.items[i] = it; }
        else { it.createdAt ||= now; it.updatedAt = now; payload.items.push(it); }
      }
      await persist();
      return ok({ items: payload.items });
    }),
    remove: wrap(async (ids) => {
      const set = new Set(Array.isArray(ids) ? ids : [ids]);
      payload.items = payload.items.filter((i) => !set.has(i.id));
      payload.deleted ||= {};
      for (const id of set) payload.deleted[id] = new Date().toISOString();
      await persist();
      return ok();
    }),
    setMeta: wrap(async (k, v) => { if (k === 'generatorHistory') payload.generatorHistory = v; else payload.meta = { ...payload.meta, [k]: v }; await persist(); return ok(); }),
    verify: async (pw) => { try { await W.unwrapKey(await kvGet('vaultFile'), pw); return ok(); } catch { return { ok: false }; } },
    changePassword: wrap(async (oldPw, newPw) => {
      await W.unwrapKey(await kvGet('vaultFile'), oldPw);
      header = await W.rewrapHeader(header, vaultKey, newPw, progress);
      await persist();
      return ok();
    }),
    exportEncrypted: wrap(async (pw) => {
      const file = await W.exportEncrypted(payload, pw, progress);
      await offerFile(`Vault-backup-${new Date().toISOString().slice(0, 10)}.kvault`, JSON.stringify(file), 'application/json', 'Backup ready', 'Save it somewhere safe, like iCloud Drive.');
      return ok();
    }),
    exportCsv: wrap(async () => {
      const esc = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const rows = [['type', 'name', 'url', 'username', 'password', 'notes']].concat(payload.items.map((i) => [i.type, i.name, (i.login?.urls || []).join(' '), i.login?.username, i.login?.password, i.notes]));
      await offerFile('Vault-export.csv', rows.map((r) => r.map(esc).join(',')).join('\r\n'), 'text/csv', 'Export ready', '<b>This file is not encrypted.</b> Delete it once you have used it.');
      return ok();
    }),
    decryptBackup: wrap(async (text, pw) => {
      const f = W.parseFile(text);
      const key = await W.unwrapKey(f, pw, progress);
      return ok({ data: await W.openData(f, key) });
    }),
    restore: wrap(async (text, pw) => {
      const f = W.parseFile(text);
      const key = await W.unwrapKey(f, pw, progress);
      await W.openData(f, key);
      await kvSet('vaultFile', f);
      await kvDel('faceid');
      return ok();
    })
  },
  settings: { set: async (patch) => { settings = { ...settings, ...patch }; saveSettings(); return ok({ settings }); } },
  hello: {
    status: async () => ok({ supported: !!window.PublicKeyCredential, available: !!window.PublicKeyCredential, enabled: !!(await kvGet('faceid')) }),
    enable: async (pw) => {
      try { await W.unwrapKey(await kvGet('vaultFile'), pw); } catch { return fail('WRONG_PASSWORD', 'Incorrect master password'); }
      try {
        const salt = crypto.getRandomValues(new Uint8Array(32));
        const { credId, out } = await prfOutput(null, salt, true);
        const key = await hkdf(out, 'wrap');
        const w = await W.seal(key, vaultKey, enc('vault-faceid/v1'));
        await kvSet('faceid', { credId: W.b64(credId), salt: W.b64(salt), wrap: w, lastMaster: Date.now(), vaultCreated: header.createdAt });
        return ok();
      } catch (e) { return helloErr(e); }
    },
    disable: async () => { await kvDel('faceid'); return ok(); },
    unlock: async () => {
      const f = await kvGet('faceid');
      if (!f) return fail('MASTER_REQUIRED', 'Face ID is not turned on');
      if (Date.now() - (f.lastMaster || 0) > MASTER_DAYS * 86400000) return fail('MASTER_REQUIRED', `For safety, enter your master password at least every ${MASTER_DAYS} days so you don’t forget it.`);
      try {
        const { out } = await prfOutput(W.unb64(f.credId), W.unb64(f.salt), false);
        const key = await hkdf(out, 'wrap');
        let vk;
        try { vk = await W.open(key, f.wrap, enc('vault-faceid/v1')); } catch { await kvDel('faceid'); return fail('HELLO_RESET', 'Face ID needs to be set up again. Unlock with your master password.'); }
        const file = await kvGet('vaultFile');
        try { payload = await W.openData(file, vk); } catch { await kvDel('faceid'); return fail('HELLO_RESET', 'Your vault changed, so Face ID needs to be set up again. Unlock with your master password.'); }
        vaultKey = vk; header = { ...file, data: undefined }; lastActivity = Date.now();
        return ok({ data: payload });
      } catch (e) { return helloErr(e); }
    }
  },
  sync: {
    /** Pull: merge a Vault-sync.kvault file (from iCloud Drive) into this phone. */
    pull: wrap(async () => {
      const f = await pickFile('.kvault,application/json,application/octet-stream');
      if (!f) return { canceled: true };
      const file = W.parseFile(await readText(f));
      let remote;
      try { remote = await W.openData(file, vaultKey); }
      catch { return fail('OTHER_VAULT', 'That file belongs to a different vault (it wasn’t made from this vault). Use “Restore a backup” instead.'); }
      const r = mergePayloads(payload, remote);
      payload = r.merged;
      await persist();
      settings.lastSync = new Date().toISOString(); saveSettings();
      return ok({ added: r.added, updated: r.updated, removed: r.removed, data: payload });
    }),
    /** Push: save this phone's vault as Vault-sync.kvault for the PC to merge. */
    push: wrap(async () => {
      const file = await W.sealFile(header, vaultKey, payload);
      const saved = await offerFile('Vault-sync.kvault', JSON.stringify(file), 'application/octet-stream', 'Send changes to your PC',
        'Tap <b>Save to Files</b>, choose <b>iCloud Drive → Vault</b> (the folder Vault on your PC syncs with) and tap <b>Save</b>. If asked, choose <b>Replace</b> or <b>Keep both</b>: Vault on your PC merges either.');
      if (saved) { settings.lastSync = new Date().toISOString(); saveSettings(); }
      return saved ? ok() : { canceled: true };
    })
  },
  files: {
    openText: wrap(async (kind) => {
      const accept = { csv: '.csv,text/csv', kvault: '.kvault,application/json,application/octet-stream', mafile: '.maFile,.json', json: '.json' }[kind] || '';
      const f = await pickFile(accept);
      if (!f) return { canceled: true };
      if (f.size > 50 * 1048576) throw new Error('File is too large');
      return ok({ name: f.name, text: (await readText(f)).replace(/^﻿/, '') });
    }),
    pickAttachments: wrap(async () => {
      const f = await pickFile('');
      if (!f) return { canceled: true };
      if (f.size > 10 * 1048576) throw new Error('Files can be up to 10 MB');
      return ok({ files: [{ id: crypto.randomUUID(), name: f.name, size: f.size, data: await readB64(f), addedAt: new Date().toISOString() }] });
    }),
    saveAttachment: wrap(async (a) => { await offerFile(a.name, W.unb64(a.data), 'application/octet-stream', 'Save attachment', `Save <b>${a.name.replace(/</g, '&lt;')}</b> to Files.`); return ok({ filePath: 'Files' }); })
  },
  clipboard: { copy: async (text) => { try { await navigator.clipboard.writeText(String(text)); } catch { /* ignore */ } return ok({ clearsIn: 0 }); } },
  icons: {
    fetch: async () => fail('UNSUPPORTED', 'Website icons are fetched by Vault on your PC and arrive when you sync.'),
    pick: wrap(async () => { const f = await pickFile('image/*'); if (!f) return { canceled: true }; return ok({ dataUrl: await resizeImage(f) }); })
  },
  qr: {
    screen: async () => fail('UNSUPPORTED', 'Use the camera or a screenshot on iPhone'),
    file: wrap(async () => { const f = await pickFile('image/*'); if (!f) return { canceled: true }; return { text: await decodeQrFromBlob(f) }; }),
    clipboard: wrap(async () => {
      const items = await navigator.clipboard.read();
      for (const it of items) { const t = it.types.find((x) => x.startsWith('image/')); if (t) return { text: await decodeQrFromBlob(await it.getType(t)), hadImage: true }; }
      return { text: null, hadImage: false };
    }),
    buffer: wrap(async (bytes) => ({ text: await decodeQrFromBlob(new Blob([bytes])) }))
  },
  autotype: { perform: async () => fail('UNSUPPORTED', 'Auto-type is only on Windows'), cancel: async () => ok(), onChoose: noop },
  hibp: {
    range: wrap(async (prefix) => {
      if (!/^[0-9A-F]{5}$/.test(String(prefix))) throw new Error('Bad prefix');
      const r = await fetch('https://api.pwnedpasswords.com/range/' + prefix);
      if (!r.ok) throw new Error('Breach check failed (HTTP ' + r.status + ')');
      return ok({ text: await r.text() });
    })
  },
  ext: { info: async () => ok({ pairs: [] }), remove: async () => ok(), openFolder: async () => ok(), respondPair: async () => ok(), onPairRequest: noop },
  win: { titlebar: async () => ok() },
  app: {
    openExternal: async (url) => { window.open(url, '_blank', 'noopener'); return ok(); },
    openDataFolder: async () => ok(), quit: async () => ok(),
    onNav: noop, onSystemTheme: noop, onVaultChanged: noop, onVaultUnlocked: noop,
    activity: () => { lastActivity = Date.now(); }
  }
};

// offline support
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => {});
