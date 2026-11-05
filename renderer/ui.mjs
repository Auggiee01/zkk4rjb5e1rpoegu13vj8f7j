import { icon } from './icons.mjs';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtDate(iso, withTime = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
}

export function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const n = (v, u) => `${v} ${u}${v === 1 ? '' : 's'} ago`;
  if (s < 86400 * 30) return n(Math.floor(s / 86400), 'day');
  if (s < 86400 * 365) return n(Math.floor(s / 86400 / 30), 'month');
  return n(Math.floor(s / 86400 / 365), 'year');
}

// ---------------------------------------------------------------- toasts
export function toast(message, { type = 'info', timeout = 2600, action } = {}) {
  let host = $('#toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `${icon(type === 'error' ? 'alert' : type === 'success' ? 'check' : 'info')}<span>${esc(message)}</span>${action ? `<button class="toast-action">${esc(action.label)}</button>` : ''}`;
  host.appendChild(el);
  if (action) el.querySelector('.toast-action').onclick = () => { action.run(); dismiss(); };
  const dismiss = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  setTimeout(dismiss, timeout);
}

export async function copy(text, label = 'Copied', sensitive = true) {
  if (!text) { toast('Nothing to copy', { type: 'error' }); return; }
  const r = await window.kh.clipboard.copy(String(text), sensitive);
  toast(r.clearsIn ? `${label} · clipboard clears in ${r.clearsIn}s` : label, { type: 'success' });
}

// ---------------------------------------------------------------- modal
let modalDepth = 0;
/**
 * modal({ title, body, actions, wide, onMount }) → Promise<value>
 * actions: [{ label, value, kind: 'primary'|'danger'|'ghost', submit?: true }]
 * onMount(el, close) may call close(value).
 */
export function modal({ title = '', body = '', actions = [{ label: 'Close', value: null, kind: 'ghost' }], wide = false, onMount, dismissable = true, className = '' } = {}) {
  return new Promise((resolve) => {
    modalDepth++;
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${wide ? 'wide' : ''} ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      ${title ? `<div class="modal-head"><h3>${esc(title)}</h3>${dismissable ? `<button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>` : ''}</div>` : ''}
      <form class="modal-body" novalidate>${body}</form>
      ${actions.length ? `<div class="modal-foot">${actions.map((a, i) => `<button type="button" class="btn ${a.kind ? 'btn-' + a.kind : ''}" data-i="${i}">${a.icon ? icon(a.icon) : ''}${esc(a.label)}</button>`).join('')}</div>` : ''}
    </div>`;
    document.body.appendChild(back);
    const el = back.querySelector('.modal');
    let done = false;
    const close = (value) => {
      if (done) return; done = true;
      modalDepth--;
      back.classList.add('out');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(() => back.remove(), 160);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable) { e.stopPropagation(); e.preventDefault(); close(null); }
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') {
        const submit = actions.findIndex((a) => a.submit);
        if (submit >= 0) { e.preventDefault(); el.querySelector(`[data-i="${submit}"]`).click(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', (e) => { if (e.target === back && dismissable) close(null); });
    el.querySelector('[data-close]')?.addEventListener('click', () => close(null));
    el.querySelector('form').addEventListener('submit', (e) => e.preventDefault());
    actions.forEach((a, i) => el.querySelector(`[data-i="${i}"]`).addEventListener('click', async () => {
      if (a.validate) { const ok = await a.validate(el); if (!ok) return; }
      close(typeof a.value === 'function' ? a.value(el) : a.value);
    }));
    onMount?.(el, close);
    requestAnimationFrame(() => {
      back.classList.add('in');
      (el.querySelector('[autofocus]') || el.querySelector('input,textarea,select') || el.querySelector('.btn-primary'))?.focus();
    });
  });
}

export const modalOpen = () => modalDepth > 0;

export function confirmDialog(title, message, { confirmLabel = 'Confirm', danger = false } = {}) {
  return modal({
    title,
    body: `<p class="modal-text">${message}</p>`,
    actions: [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: confirmLabel, value: true, kind: danger ? 'danger' : 'primary', submit: true }]
  });
}

export function promptPassword(title, message, { confirm = false, label = 'Password', minLength = 0 } = {}) {
  return modal({
    title,
    body: `${message ? `<p class="modal-text">${message}</p>` : ''}
      <div class="fld"><label>${esc(label)}</label><div class="input-wrap"><input type="password" name="p1" autocomplete="off" autofocus></div></div>
      ${confirm ? `<div class="fld"><label>Confirm ${esc(label.toLowerCase())}</label><div class="input-wrap"><input type="password" name="p2" autocomplete="off"></div></div>` : ''}
      <p class="form-error" hidden></p>`,
    actions: [
      { label: 'Cancel', value: null, kind: 'ghost' },
      {
        label: 'Continue', kind: 'primary', submit: true,
        validate: (el) => {
          const p1 = el.querySelector('[name=p1]').value, p2 = el.querySelector('[name=p2]')?.value;
          const err = el.querySelector('.form-error');
          const fail = (m) => { err.textContent = m; err.hidden = false; return false; };
          if (!p1) return fail('Please enter a password');
          if (p1.length < minLength) return fail(`Use at least ${minLength} characters`);
          if (confirm && p1 !== p2) return fail('The passwords do not match');
          return true;
        },
        value: (el) => el.querySelector('[name=p1]').value
      }
    ]
  });
}

// ---------------------------------------------------------------- avatars
const PALETTE = ['#4f7cff', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#06b6d4', '#eab308', '#ef4444', '#6366f1', '#14b8a6'];
export function colorFor(s) {
  let h = 0;
  for (const c of String(s || '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const TYPE_ICON = { login: 'globe', card: 'card', note: 'note', identity: 'user', passkey: 'passkey', securitykey: 'usbkey' };
export function avatar(item, size = 'md') {
  if (item.icon) return `<span class="avatar avatar-${size} has-img"><img src="${esc(item.icon)}" alt="" draggable="false" loading="lazy"></span>`;
  const name = (item.name || '?').trim();
  if ((item.type === 'login' || item.type === 'passkey') && name) {
    const ch = (name.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
    return `<span class="avatar avatar-${size} letter" style="--av:${colorFor(name)}">${esc(ch)}</span>`;
  }
  return `<span class="avatar avatar-${size} typed t-${item.type}">${icon(TYPE_ICON[item.type] || 'key')}</span>`;
}

export function strengthBar(score, label, extra = '') {
  return `<div class="strength s${score}"><div class="strength-track">${[0, 1, 2, 3].map((i) => `<i class="${i < Math.max(1, score) ? 'on' : ''}"></i>`).join('')}</div><span>${esc(label)}${extra ? ` · ${esc(extra)}` : ''}</span></div>`;
}

/** Colourise a password: digits, symbols and letters in different colours for readability. */
export function colorizePassword(pw) {
  return [...String(pw)].map((c) => {
    const cls = /[0-9]/.test(c) ? 'pd' : /[a-zA-Z]/.test(c) ? '' : 'ps';
    return cls ? `<span class="${cls}">${esc(c)}</span>` : esc(c);
  }).join('');
}

export function domainOf(url) {
  try { return new URL(/^[a-z]+:\/\//i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
