import { S, otpItems, saveItems, newItem, items, byId, emit } from './store.mjs';
import { icon } from './icons.mjs';
import { esc, avatar, modal, toast, copy, $, domainOf } from './ui.mjs';
import { parseAnyOtp, generateCode, buildOtpAuth, normalizeOtp } from '../shared/totp.mjs';

// ---------------------------------------------------------------- live code ticker
const cache = new Map(); // id -> { step, code }
export function formatCode(code) {
  if (!code) return '';
  if (code.length === 6) return code.slice(0, 3) + ' ' + code.slice(3);
  if (code.length === 8) return code.slice(0, 4) + ' ' + code.slice(4);
  return code;
}

export async function codeFor(otp, key) {
  const r = await generateCode(otp);
  if (key) cache.set(key, r);
  return r;
}

/** Update every [data-otp] element in the document. Called once per second. */
export async function tickOtp() {
  const els = document.querySelectorAll('[data-otp]');
  if (!els.length) return;
  for (const el of els) {
    const id = el.dataset.otp;
    const otp = id.startsWith('draft:') ? draftOtps.get(id) : byId(id)?.login?.totp;
    if (!otp) continue;
    try {
      const r = await generateCode(otp);
      const text = formatCode(r.code);
      if (el.textContent !== text) { el.textContent = text; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
      const ring = el.closest('[data-otp-host]')?.querySelector('.ring');
      if (ring && r.period) {
        ring.style.setProperty('--p', String(r.remaining / r.period));
        ring.dataset.s = r.remaining;
        ring.classList.toggle('low', r.remaining <= 5);
        const label = ring.querySelector('.ring-n'); if (label) label.textContent = r.remaining;
      }
    } catch { el.textContent = 'Invalid key'; }
  }
}
export const draftOtps = new Map();

export function ring() {
  return `<span class="ring" aria-hidden="true"><svg viewBox="0 0 36 36"><circle class="ring-bg" cx="18" cy="18" r="15.5"/><circle class="ring-fg" cx="18" cy="18" r="15.5" pathLength="1"/></svg><span class="ring-n"></span></span>`;
}

// ---------------------------------------------------------------- authenticator page
export function renderAuthPage(main) {
  const list = otpItems();
  main.innerHTML = `<div class="page">
    <div class="page-head">
      <div><h1>Authenticator</h1><p class="sub">Two-factor codes for your accounts. ${S.platform === 'ios' ? 'Tap' : 'Click'} a code to copy it.</p></div>
      <button class="btn btn-primary" data-action="add-2fa">${icon('plus')}Add 2FA code</button>
    </div>
    ${list.length ? `<div class="otp-grid">${list.map(otpCard).join('')}</div>` : emptyAuth()}
  </div>`;
  tickOtp();
}

function otpCard(item) {
  const t = item.login.totp;
  const sub = t.account || item.login.username || domainOf(item.login.urls?.[0] || '');
  return `<div class="otp-card" data-otp-host>
    <button class="otp-main" data-action="copy-otp" data-id="${esc(item.id)}" title="Copy code">
      ${avatar(item, 'md')}
      <span class="otp-names"><span class="otp-name">${esc(item.name)}${t.type === 'steam' ? ' <span class="tag">Steam Guard</span>' : ''}</span><span class="otp-acc">${esc(sub)}</span></span>
      <span class="otp-code mono" data-otp="${esc(item.id)}">••• •••</span>
    </button>
    <div class="otp-side">
      ${t.type === 'hotp' ? `<button class="icon-btn" data-action="hotp-next" data-id="${esc(item.id)}" title="Next code">${icon('refresh')}</button>` : ring()}
      <button class="icon-btn" data-action="open-item" data-id="${esc(item.id)}" title="Open login">${icon('chevronRight')}</button>
    </div>
  </div>`;
}

function emptyAuth() {
  return `<div class="empty-state big">
    <div class="empty-art">${icon('otp')}</div>
    <h2>No 2FA codes yet</h2>
    <p>When a site like Discord, Roblox or Google shows you a QR code to set up an authenticator app, add it here instead of your phone.</p>
    <button class="btn btn-primary" data-action="add-2fa">${icon('qr')}Add your first code</button>
    <div class="how-grid">
      <div>${icon('monitor')}<b>Scan from screen</b><span>Leave the QR code visible in your browser, then choose “Scan screen”.</span></div>
      <div>${icon('camera')}<b>Use your webcam</b><span>Hold up a QR code (for example on your phone) to the camera.</span></div>
      <div>${icon('key')}<b>Type the setup key</b><span>Most sites offer a “can't scan?” text key you can paste.</span></div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- add-2FA flow
/**
 * Opens the add-2FA dialog.
 *  forDraft: return the parsed config instead of saving (used by the editor)
 */
export async function add2faFlow({ forDraft = false, suggestName = '' } = {}) {
  const found = await modal({
    title: 'Add a 2FA code', wide: true, actions: [],
    body: `
      <p class="modal-text">Pick how to read the setup QR code. Nothing leaves your computer.</p>
      <div class="method-grid">
        ${S.platform === 'ios' ? '' : `<button type="button" class="method" data-m="screen">${icon('monitor')}<b>Scan screen</b><span>Finds a QR code anywhere on your screens</span></button>`}
        <button type="button" class="method" data-m="camera">${icon('camera')}<b>${S.platform === 'ios' ? 'Camera' : 'Webcam'}</b><span>${S.platform === 'ios' ? 'Point your camera at the QR code' : 'Hold the code up to your camera'}</span></button>
        <button type="button" class="method" data-m="file">${icon('image')}<b>Image file</b><span>A screenshot or saved QR image</span></button>
        <button type="button" class="method" data-m="clip">${icon('clipboard')}<b>Paste image</b><span>${S.platform === 'ios' ? 'A copied image' : 'Copied screenshot (Win + Shift + S)'}</span></button>
      </div>
      <div class="drop-zone" tabindex="-1">${icon('upload')}<span>…or drop a QR image here</span></div>
      <div class="or"><span>or enter it manually</span></div>
      <div class="fld"><label>Setup key or otpauth:// link</label><div class="input-wrap"><input name="manual" class="mono" placeholder="e.g. JBSW Y3DP EHPK 3PXP" spellcheck="false" autocomplete="off"></div>
        <p class="hint">Sites often hide this behind “Can't scan the code?” or “Enter key manually”.</p></div>
      <details class="adv"><summary>${icon('chevronRight')}Options for the manual key</summary>
        <div class="opt-grid three">
          <div class="fld"><label>Type</label><div class="input-wrap"><select name="type"><option value="totp">Time-based (TOTP)</option><option value="hotp">Counter-based (HOTP)</option><option value="steam">Steam Guard</option></select></div></div>
          <div class="fld"><label>Digits</label><div class="input-wrap"><select name="digits"><option>6</option><option>7</option><option>8</option></select></div></div>
          <div class="fld"><label>Period (seconds)</label><div class="input-wrap"><input name="period" type="number" value="30" min="10" max="300"></div></div>
          <div class="fld"><label>Algorithm</label><div class="input-wrap"><select name="algorithm"><option>SHA1</option><option>SHA256</option><option>SHA512</option></select></div></div>
        </div>
      </details>
      <div class="import-links">
        <button type="button" class="link" data-m="mafile">${icon('upload')}Import a Steam Desktop Authenticator .maFile</button>
        <span class="muted">Google Authenticator “Transfer accounts” QR codes are recognised automatically.</span>
      </div>
      <p class="form-error" hidden></p>
      <div class="modal-foot inline"><button type="button" class="btn btn-ghost" data-m="cancel">Cancel</button><button type="button" class="btn btn-primary" data-m="manual">Continue</button></div>`,
    onMount: (el, close) => {
      const err = el.querySelector('.form-error');
      const fail = (m) => { err.textContent = m; err.hidden = false; };
      const accept = (text) => {
        if (!text) return fail('No QR code found. Make sure the whole code is visible and try again.');
        try { close(parseAnyOtp(text)); } catch (e) { fail(e.message.includes('otpauth') || e.message.includes('Secret') ? e.message : 'That QR code is not a 2FA setup code.'); }
      };
      el.addEventListener('click', async (e) => {
        const m = e.target.closest('[data-m]')?.dataset.m;
        if (!m) return;
        err.hidden = true;
        if (m === 'cancel') return close(null);
        if (m === 'screen') { const r = await window.kh.qr.screen(); if (!r.error) accept(r.text); else fail(r.message); }
        if (m === 'file') { const r = await window.kh.qr.file(); if (!r.canceled) accept(r.text); }
        if (m === 'clip') { const r = await window.kh.qr.clipboard(); if (!r.hadImage && !r.text) fail('There is no image on the clipboard. Take a screenshot with Win + Shift + S first.'); else accept(r.text); }
        if (m === 'camera') { const text = await webcamScan(); if (text) accept(text); }
        if (m === 'mafile') { const r = await window.kh.files.openText('mafile'); if (!r.canceled && !r.error) accept(r.text); }
        if (m === 'manual') {
          const v = el.querySelector('[name=manual]').value.trim();
          if (!v) return fail('Paste the setup key first, or use one of the scan options above.');
          try {
            let list = parseAnyOtp(v);
            if (!/^otpauth/i.test(v) && !v.startsWith('{')) {
              const g = (n) => el.querySelector(`[name=${n}]`).value;
              list = [normalizeOtp({ ...list[0], type: g('type'), digits: g('digits'), period: g('period'), algorithm: g('algorithm'), issuer: suggestName })];
            }
            close(list);
          } catch (ex) { fail(ex.message); }
        }
      });
      el.querySelector('[name=manual]').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); el.querySelector('.btn-primary[data-m=manual]').click(); }
      });
      const dz = el.querySelector('.drop-zone');
      el.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
      el.addEventListener('dragleave', () => dz.classList.remove('over'));
      el.addEventListener('drop', async (e) => {
        e.preventDefault(); dz.classList.remove('over');
        const f = e.dataTransfer.files[0];
        if (!f) return;
        const r = await window.kh.qr.buffer(new Uint8Array(await f.arrayBuffer()));
        accept(r.text);
      });
      el.addEventListener('paste', async (e) => {
        const file = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))?.getAsFile();
        if (file) { e.preventDefault(); const r = await window.kh.qr.buffer(new Uint8Array(await file.arrayBuffer())); accept(r.text); }
      });
    }
  });
  if (!found || !found.length) return null;
  if (forDraft) return found[0];
  return confirmAndSave(found);
}

/** Second step: choose where each code goes, preview it live, and save. */
async function confirmAndSave(list) {
  const logins = items().filter((i) => i.type === 'login').sort((a, b) => a.name.localeCompare(b.name));
  const guess = (o) => {
    const k = (o.issuer || '').toLowerCase();
    if (!k) return '';
    const m = logins.find((l) => !l.login.totp && (l.name.toLowerCase().includes(k) || (l.login.urls || []).some((u) => domainOf(u).includes(k))));
    return m ? m.id : '';
  };
  list.forEach((o, i) => draftOtps.set('draft:' + i, o));
  const res = await modal({
    title: list.length > 1 ? `Found ${list.length} codes` : 'Code found', wide: list.length > 1,
    body: `<div class="found-list">${list.map((o, i) => `
      <div class="found" data-otp-host>
        <div class="found-top">
          <div class="found-names"><input name="issuer${i}" class="plain-input strong" value="${esc(o.issuer)}" placeholder="Service name (e.g. Discord)"><input name="account${i}" class="plain-input" value="${esc(o.account)}" placeholder="Account"></div>
          <span class="otp-code mono" data-otp="draft:${i}">••• •••</span>${o.type === 'hotp' ? '' : ring()}
        </div>
        <div class="fld"><label>Save to</label><div class="input-wrap"><select name="target${i}">
          <option value="">Create a new login</option>
          ${logins.map((l) => `<option value="${esc(l.id)}" ${guess(o) === l.id ? 'selected' : ''}>${esc(l.name)}${l.login.username ? ' — ' + esc(l.login.username) : ''}${l.login.totp ? ' (replace existing code)' : ''}</option>`).join('')}
        </select></div></div>
      </div>`).join('')}</div>
      <p class="hint">${icon('info')}Tip: type the code shown here into the website now to finish turning on 2FA there.</p>`,
    onMount: () => tickOtp(),
    actions: [{ label: 'Cancel', value: null, kind: 'ghost' }, {
      label: 'Save', kind: 'primary', submit: true,
      value: (el) => list.map((o, i) => ({ otp: { ...o, issuer: el.querySelector(`[name=issuer${i}]`).value.trim(), account: el.querySelector(`[name=account${i}]`).value.trim() }, target: el.querySelector(`[name=target${i}]`).value }))
    }]
  });
  list.forEach((_, i) => draftOtps.delete('draft:' + i));
  if (!res) return null;
  const toSave = [];
  for (const { otp, target } of res) {
    if (target) {
      const it = structuredClone(byId(target));
      it.login.totp = otp;
      toSave.push(it);
    } else {
      const it = newItem('login');
      it.name = otp.issuer || otp.account || '2FA code';
      it.login.username = otp.account || '';
      const guess = String(otp.issuer || '').toLowerCase().replace(/[^a-z0-9.-]/g, '');
      it.login.urls = guess ? [guess.includes('.') ? guess : guess + '.com'] : [];
      it.login.totp = otp;
      toSave.push(it);
    }
  }
  await saveItems(toSave);
  toast(toSave.length > 1 ? `${toSave.length} codes saved` : '2FA code saved', { type: 'success' });
  emit('view');
  return toSave;
}

// ---------------------------------------------------------------- webcam
async function webcamScan() {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: S.platform === 'ios' ? { ideal: 'environment' } : 'user' }, audio: false }); }
  catch (e) { toast('Could not open the webcam: ' + (e.message || e.name), { type: 'error', timeout: 4000 }); return null; }
  let raf = 0;
  const text = await modal({
    title: S.platform === 'ios' ? 'Scan with camera' : 'Scan with webcam', actions: [{ label: 'Cancel', value: null, kind: 'ghost' }],
    body: `<div class="cam"><video playsinline muted></video><div class="cam-frame"></div></div><p class="hint center">Hold the QR code steady inside the frame.</p>`,
    onMount: (el, close) => {
      const video = el.querySelector('video');
      video.srcObject = stream;
      video.play();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      let last = 0;
      const loop = (t) => {
        raf = requestAnimationFrame(loop);
        if (t - last < 120 || video.readyState < 2) return;
        last = t;
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (r?.data) close(r.data);
      };
      raf = requestAnimationFrame(loop);
    }
  });
  cancelAnimationFrame(raf);
  stream.getTracks().forEach((t) => t.stop());
  return text;
}

// ---------------------------------------------------------------- export to phone
export function showOtpQr(item) {
  const uri = buildOtpAuth({ ...item.login.totp, issuer: item.login.totp.issuer || item.name, account: item.login.totp.account || item.login.username });
  const qr = window.qrcodegen.QrCode.encodeText(uri, window.qrcodegen.QrCode.Ecc.MEDIUM);
  const n = qr.size, b = 3;
  let path = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.getModule(x, y)) path += `M${x + b} ${y + b}h1v1h-1z`;
  return modal({
    title: 'Move this code to another device',
    body: `<p class="modal-text">Scan this with another authenticator (for example on your iPhone) to have the same codes there. <b>Anyone who sees this QR code can generate your codes</b> — close it when you're done.</p>
      <div class="qr-box"><svg viewBox="0 0 ${n + b * 2} ${n + b * 2}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg></div>`,
    actions: [{ label: 'Done', value: null, kind: 'primary', submit: true }]
  });
}

export async function copyOtp(item) {
  const r = await generateCode(item.login.totp);
  if (r.remaining !== undefined && r.remaining <= 3) toast('Heads up: this code changes in ' + r.remaining + 's', { timeout: 2000 });
  await copy(r.code, 'Code copied');
}

export async function hotpNext(item) {
  const it = structuredClone(item);
  it.login.totp.counter = (it.login.totp.counter || 0) + 1;
  await saveItems([it]);
  const r = await generateCode(it.login.totp);
  await copy(r.code, 'Next code copied');
  emit('view');
}

export { $ };
