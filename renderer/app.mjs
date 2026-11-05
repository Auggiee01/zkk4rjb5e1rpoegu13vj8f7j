import { S, TYPES, items, onChange, emit, setSettings, byId, wordlist, passkeyCount } from './store.mjs';
import { tidyDialog } from './tidy.mjs';
const HN = () => S.hello?.name || 'Windows Hello';
import { icon, logo } from './icons.mjs';
import { $, $$, esc, toast, modalOpen, debounce } from './ui.mjs';
import { renderVaultView, renderList, renderDetail, vaultActions, startEdit, autotypeChooser, prettyHotkey } from './view-vault.mjs';
import { renderAuthPage, add2faFlow, tickOtp, copyOtp } from './view-auth.mjs';
import { renderGeneratorPage } from './view-generator.mjs';
import { renderHealthPage, healthActions, analyze } from './view-health.mjs';
import { renderSettingsPage, settingsActions } from './view-settings.mjs';
import { estimateStrength, generatePassphrase } from '../shared/generator.mjs';

const kh = window.kh;
const root = document.getElementById('root');
const ITEM_VIEWS = new Set(['all', 'favorites', ...Object.keys(TYPES)]);

// ---------------------------------------------------------------- appearance
function resolvedTheme() {
  const t = S.settings.theme || 'system';
  return t === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
}
function applyAppearance() {
  const d = document.documentElement;
  S.theme = resolvedTheme();
  d.dataset.theme = S.theme;
  d.dataset.accent = S.settings.accent || 'aura';
  d.dataset.density = S.settings.density || 'comfortable';
  d.dataset.motion = S.settings.reduceMotion ? 'reduce' : 'full';
  d.dataset.platform = S.platform;
  requestAnimationFrame(() => {
    const cs = getComputedStyle(d);
    kh.win.titlebar({ color: cs.getPropertyValue('--titlebar').trim(), symbolColor: cs.getPropertyValue('--titlebar-fg').trim() });
  });
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);

function titlebar(withSearch) {
  return `<header class="titlebar">
    <div class="tb-brand">${logo(20)}<span>Vault</span></div>
    ${withSearch ? `<div class="tb-search">${icon('search')}<input id="search" type="search" placeholder="Search your vault" value="${esc(S.search)}" spellcheck="false" autocomplete="off"><kbd>Ctrl F</kbd></div>
      <div class="tb-actions"><button class="tb-btn" data-action="lock" title="Lock now (Ctrl + L)">${icon('lock')}<span>Lock</span></button></div>` : '<div class="grow"></div>'}
  </header>`;
}

// ---------------------------------------------------------------- lock & setup
function renderLock() {
  const setup = S.status === 'setup';
  root.innerHTML = `${titlebar(false)}
  <div class="lock-screen">
    <div class="lock-glow"></div>
    <form class="lock-card" autocomplete="off" novalidate>
      <div class="lock-logo">${logo(64)}</div>
      ${setup ? `
        <h1>Welcome to Vault</h1>
        ${S.platform === 'ios' ? `<p class="sub">Already using Vault on your PC? Open that vault here. It's in the <span class="mono">Vault</span> folder in iCloud Drive.</p>
          <button type="button" class="btn btn-primary block lg" data-lock="restore">${icon('download')}Open my vault from my PC</button>
          <div class="or"><span>or create a new vault</span></div>` : ''}
        <p class="sub">Create a master password. It encrypts everything in your vault and is the only password you'll need to remember.</p>
        <div class="fld"><label>Master password</label><div class="input-wrap"><input type="password" id="pw1" autofocus>
          <button type="button" class="icon-btn" data-lock="reveal" title="Show">${icon('eye')}</button></div><div id="pwMeter"></div></div>
        <div class="fld"><label>Confirm master password</label><div class="input-wrap"><input type="password" id="pw2"></div></div>
        <button type="button" class="link sm" data-lock="suggest">${icon('sparkle')}Suggest a memorable passphrase</button>
        <label class="check"><input type="checkbox" id="ack"><span>I understand that <b>nobody can reset this password</b> — if I forget it, my vault can't be recovered.</span></label>
        <p class="form-error" hidden></p>
        <button type="submit" class="btn ${S.platform === 'ios' ? 'btn-soft' : 'btn-primary'} block lg" id="go">${icon('shieldCheck')}Create my vault</button>
        <p class="fine">Your vault is stored only on this ${S.platform === 'ios' ? 'iPhone' : 'computer'} and is encrypted with ${esc(S.kdf)} + AES-256-GCM.${S.platform === 'ios' ? '' : '<br>Moving from another PC? <button type="button" class="link sm" data-lock="restore">Restore a Vault backup</button>'}</p>`
      : `
        <h1>Welcome back</h1>
        <p class="sub">${S.hello.enabled ? `Unlock with ${HN()} or your master password.` : 'Enter your master password to unlock your vault.'}</p>
        ${S.hello.enabled ? `<button type="button" class="btn btn-primary block lg" data-lock="hello" id="helloBtn">${icon('fingerprint')}Unlock with ${HN()}</button>
          <div class="or"><span>or use your master password</span></div>` : ''}
        <div class="fld"><div class="input-wrap big"><input type="password" id="pw1" placeholder="Master password" ${S.hello.enabled ? '' : 'autofocus'}>
          <button type="button" class="icon-btn" data-lock="reveal" title="Show">${icon('eye')}</button></div>
          <p class="caps" hidden>${icon('alert')}Caps Lock is on</p></div>
        <p class="form-error" hidden></p>
        <button type="submit" class="btn ${S.hello.enabled ? 'btn-soft' : 'btn-primary'} block lg" id="go">${icon('unlock')}Unlock</button>
        <p class="fine">Forgot it? There's no reset, but you can <button type="button" class="link sm" data-lock="restore">restore an encrypted backup</button> if you made one.</p>`}
    </form>
  </div>`;
  const form = $('.lock-card');
  const pw1 = $('#pw1');
  const err = $('.form-error');
  const fail = (m) => { err.textContent = m; err.hidden = false; form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); };
  pw1.addEventListener('keyup', (e) => { const c = $('.caps'); if (c) c.hidden = !e.getModifierState?.('CapsLock'); });
  if (setup) pw1.addEventListener('input', () => {
    const s = estimateStrength(pw1.value);
    $('#pwMeter').innerHTML = pw1.value ? `<div class="strength s${s.score}"><div class="strength-track">${[0, 1, 2, 3].map((i) => `<i class="${i < Math.max(1, s.score) ? 'on' : ''}"></i>`).join('')}</div><span>${s.label} · cracking ≈ ${s.crackTime}</span></div>` : '';
  });
  form.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-lock]')?.dataset.lock;
    if (a === 'reveal') { const show = pw1.type === 'password'; $$('#pw1, #pw2').forEach((i) => { i.type = show ? 'text' : 'password'; }); }
    if (a === 'hello') return helloUnlock();
    if (a === 'restore') {
      const f = await kh.files.openText('kvault');
      if (f.canceled || f.error) return;
      const { promptPassword, confirmDialog } = await import('./ui.mjs');
      const pw = await promptPassword('Restore backup', `Enter the password of <b>${esc(f.name)}</b>. Your current vault file is kept in the backups folder.`, { label: 'Backup password' });
      if (!pw) return;
      if (!setup && !(await confirmDialog('Replace your vault with this backup?', 'After restoring, unlock with the <b>backup\'s</b> password.', { confirmLabel: 'Restore', danger: true }))) return;
      const r = await kh.vault.restore(f.text, pw);
      if (r.error) return fail(r.error === 'WRONG_PASSWORD' ? 'That is not the password for this backup.' : r.message);
      toast(setup ? 'Vault found. Unlock it with your master password' : 'Backup restored. Unlock with its password', { type: 'success', timeout: 4000 });
      S.status = 'locked';
      renderLock();
      return;
    }
    if (a === 'suggest') {
      const p = generatePassphrase(await wordlist(), { words: 5, separator: '-', capitalize: true, includeNumber: true });
      pw1.value = p; const p2 = $('#pw2'); p2.value = p; pw1.type = p2.type = 'text';
      pw1.dispatchEvent(new Event('input'));
      toast('Write this down and keep it somewhere safe', { timeout: 4000 });
    }
  });
  async function helloUnlock() {
    const b = $('#helloBtn');
    if (!b || b.disabled) return;
    err.hidden = true;
    b.disabled = true; b.innerHTML = `<span class="spinner"></span>Waiting for ${HN()}…`;
    const r = await kh.hello.unlock();
    if (r.ok) { S.data = r.data; S.status = 'unlocked'; renderShell(); return; }
    b.disabled = false; b.innerHTML = `${icon('fingerprint')}Unlock with ${HN()}`;
    if (r.error === 'HELLO_RESET') { S.hello.enabled = false; S.helloReenable = true; b.nextElementSibling?.remove(); b.remove(); }
    if (r.error !== 'HELLO_CANCELED') fail(r.message);
    pw1.focus();
  }
  if (!setup && S.hello.enabled) {
    // Prompt straight away only when the user is actually looking at Vault.
    const auto = () => { if (document.hasFocus() && $('#helloBtn') && !$('#helloBtn').disabled && !pw1.value) helloUnlock(); };
    setTimeout(auto, 350);
    window.addEventListener('focus', auto, { once: true });
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const go = $('#go');
    if (setup) {
      const p1 = pw1.value, p2 = $('#pw2').value;
      if (p1.length < 8) return fail('Use at least 8 characters — a passphrase of 4–5 words is ideal.');
      if (p1 !== p2) return fail('The two passwords do not match.');
      if (!$('#ack').checked) return fail('Please tick the box to confirm you understand there is no password reset.');
      if (estimateStrength(p1).score < 2) return fail('That master password is too easy to guess. Try the passphrase suggestion.');
      go.disabled = true; go.innerHTML = '<span class="spinner"></span>Creating your vault…';
      const r = await kh.vault.create(p1);
      if (r.error) { go.disabled = false; go.innerHTML = `${icon('shieldCheck')}Create my vault`; return fail(r.message); }
      S.data = r.data; S.status = 'unlocked'; S.view = 'all';
      renderShell();
      toast('Your vault is ready', { type: 'success' });
      offerHello(p1);
    } else {
      if (!pw1.value) return fail('Enter your master password.');
      go.disabled = true; go.innerHTML = '<span class="spinner"></span>Unlocking…';
      const r = await kh.vault.unlock(pw1.value);
      if (r.error) {
        go.disabled = false; go.innerHTML = `${icon('unlock')}Unlock`;
        pw1.select();
        return fail(r.error === 'WRONG_PASSWORD' ? 'That master password is not correct.' : r.message);
      }
      const typed = pw1.value;
      pw1.value = '';
      S.data = r.data; S.status = 'unlocked';
      renderShell();
      if (S.helloReenable) { S.helloReenable = false; offerHello(typed); }
    }
  });
}

async function offerHello(masterPassword) {
  if (!S.hello.supported) return;
  const st = await kh.hello.status();
  if (!st.available || st.enabled) return;
  const { confirmDialog } = await import('./ui.mjs');
  const yes = await confirmDialog(`Unlock with ${HN()}?`,
    `Use ${S.platform === 'ios' ? '<b>Face ID</b> (or your iPhone passcode)' : 'your Windows <b>PIN, face or fingerprint</b>'} to open Vault instead of typing your master password every time.<br><br>Your master password still works, and Vault will ask for it every 14 days so you don\'t forget it.`, { confirmLabel: `Turn on ${HN()}` });
  if (!yes) return;
  const r = await kh.hello.enable(masterPassword);
  if (r.error) return toast(r.message, { type: 'error', timeout: 5000 });
  S.hello.enabled = true;
  toast(`${HN()} is on`, { type: 'success' });
}

// ---------------------------------------------------------------- shell
function navItem(v, label, ic, count) {
  return `<button class="nav ${S.view === v ? 'on' : ''}" data-action="nav" data-v="${v}" title="${esc(label)}">${icon(ic)}<span class="nav-label">${esc(label)}</span>${count !== undefined ? `<span class="nav-count">${count}</span>` : ''}</button>`;
}
function sidebarHtml() {
  const all = items();
  const c = (t) => all.filter((i) => i.type === t).length;
  const otp = all.filter((i) => i.login?.totp).length;
  const issues = (() => { const a = analyze(); return new Set([...a.weak, ...a.reused, ...a.breached].map((x) => x.it.id)).size; })();
  return `
    <div class="nav-group">
      ${navItem('all', 'All items', 'grid', all.length)}
      ${navItem('favorites', 'Favourites', 'star', all.filter((i) => i.favorite).length)}
    </div>
    <div class="nav-title">Vault</div>
    <div class="nav-group">
      ${navItem('login', 'Logins', 'globe', c('login'))}
      ${navItem('authenticator', 'Authenticator', 'otp', otp)}
      ${navItem('passkey', 'Passkeys', 'passkey', passkeyCount())}
      ${navItem('card', 'Payment cards', 'card', c('card'))}
      ${navItem('note', 'Secure notes', 'note', c('note'))}
      ${navItem('identity', 'Identities', 'user', c('identity'))}
      ${navItem('securitykey', 'Security keys', 'usbkey', c('securitykey'))}
    </div>
    <div class="nav-title">Tools</div>
    <div class="nav-group">
      ${navItem('generator', 'Generator', 'dice')}
      <button class="nav ${S.view === 'health' ? 'on' : ''}" data-action="nav" data-v="health" title="Password health">${icon('shieldCheck')}<span class="nav-label">Password health</span>${issues ? `<span class="nav-count alert">${issues}</span>` : ''}</button>
    </div>
    <div class="grow"></div>
    <div class="nav-group">
      ${navItem('settings', 'Settings', 'sliders')}
      <button class="nav collapse-btn" data-action="toggle-sidebar" title="Collapse sidebar">${icon('sidebar')}<span class="nav-label">Collapse</span></button>
    </div>`;
}

function renderShell() {
  root.innerHTML = `${titlebar(true)}
    <div class="body ${S.settings.sidebarCollapsed ? 'collapsed' : ''}">
      <nav class="sidebar" id="sidebar">${sidebarHtml()}</nav>
      <main class="main" id="main"></main>
    </div>
    ${S.platform === 'ios' ? `<nav class="tabbar" id="tabbar">${tabbarHtml()}</nav>` : ''}`;
  const search = $('#search');
  search.addEventListener('input', debounce(() => {
    S.search = search.value;
    if (!ITEM_VIEWS.has(S.view) && S.view !== 'authenticator') { S.view = 'all'; refreshSidebar(); renderMain(); }
    else if (S.view === 'authenticator') renderMain();
    else renderList();
  }, 80));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { search.value = ''; S.search = ''; search.dispatchEvent(new Event('input')); search.blur(); }
    if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); moveSelection(e.key === 'Enter' ? 0 : 1, true); }
  });
  renderMain();
}

const TABS = [['all', 'Vault', 'grid'], ['authenticator', 'Codes', 'otp'], ['generator', 'Generator', 'dice'], ['health', 'Health', 'shieldCheck'], ['settings', 'Settings', 'sliders']];
function tabbarHtml() {
  const active = ITEM_VIEWS.has(S.view) ? 'all' : S.view;
  return TABS.map(([v, l, ic]) => `<button class="tab ${active === v ? 'on' : ''}" data-action="nav" data-v="${v}">${icon(ic)}<span>${l}</span></button>`).join('');
}
function refreshSidebar() { const sb = $('#sidebar'); if (sb) sb.innerHTML = sidebarHtml(); const tb = $('#tabbar'); if (tb) tb.innerHTML = tabbarHtml(); }

function renderMain() {
  const main = $('#main');
  if (!main) return;
  main.dataset.view = S.view;
  if (ITEM_VIEWS.has(S.view)) renderVaultView(main);
  else if (S.view === 'authenticator') renderAuthPage(main);
  else if (S.view === 'generator') renderGeneratorPage(main);
  else if (S.view === 'health') renderHealthPage(main);
  else if (S.view === 'settings') renderSettingsPage(main);
  main.scrollTop = 0;
}

function nav(v) {
  if (S.editing) S.editing = null;
  if (v !== S.view) S.selectedId = null;
  S.view = v;
  refreshSidebar();
  renderMain();
}

function moveSelection(delta, fromSearch = false) {
  if (!ITEM_VIEWS.has(S.view)) return;
  const rows = $$('#list .row');
  if (!rows.length) return;
  let i = rows.findIndex((r) => r.dataset.id === S.selectedId);
  i = fromSearch && i < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, i + delta));
  S.editing = null;
  S.selectedId = rows[i].dataset.id;
  emit('select');
  $$('#list .row')[i]?.scrollIntoView({ block: 'nearest' });
}

onChange((what) => {
  if (S.status !== 'unlocked') return;
  if (what === 'items' || what === 'icons') {
    refreshSidebar();
    if (ITEM_VIEWS.has(S.view)) { renderList(); if (!S.editing) renderDetail(); }
    else if (S.view === 'authenticator' || S.view === 'health') renderMain();
  } else if (what === 'view') { refreshSidebar(); renderMain(); }
  else if (what === 'select') {
    $$('#list .row').forEach((r) => r.classList.toggle('active', r.dataset.id === S.selectedId));
    renderDetail();
  } else if (what === 'detail') renderDetail();
  else if (what === 'appearance') { applyAppearance(); if (S.view === 'settings') renderMain(); }
});

// ---------------------------------------------------------------- actions
const actions = {
  ...vaultActions, ...healthActions, ...settingsActions,
  'nav': (el) => nav(el.dataset.v),
  'lock': () => kh.vault.lock(),
  'add-2fa': () => add2faFlow(),
  'tidy': () => tidyDialog(),
  'cat-menu': async (el) => {
    const { popMenu } = await import('./view-vault.mjs');
    popMenu(el, [['all', 'All items', 'grid'], ['favorites', 'Favourites', 'star'], ['login', 'Logins', 'globe'], ['passkey', 'Passkeys', 'passkey'], ['card', 'Payment cards', 'card'], ['note', 'Secure notes', 'note'], ['identity', 'Identities', 'user'], ['securitykey', 'Security keys', 'usbkey']]
      .map(([v, l, ic]) => ({ label: l, icon: S.view === v ? 'check' : ic, run: () => nav(v) })));
  },
  'open-item': (el) => { S.view = 'login'; S.selectedId = el.dataset.id; refreshSidebar(); renderMain(); },
  'copy-otp': (el) => copyOtp(byId(el.dataset.id)),
  'toggle-sidebar': async () => { await setSettings({ sidebarCollapsed: !S.settings.sidebarCollapsed }); $('.body')?.classList.toggle('collapsed', !!S.settings.sidebarCollapsed); },
  'health-fix': async (el) => {
    const id = el.dataset.id;
    S.view = 'login'; S.selectedId = id; refreshSidebar(); renderMain();
    if (el.dataset.tab === 'no2fa') vaultActions['attach-2fa']({ dataset: { id } });
    else startEdit(id);
  }
};
window.__setSort = async (v) => { await setSettings({ listSort: v }); renderList(); };

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !root.contains(el) && !el.closest('.modal')) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  try { await fn(el, e); } catch (err) { console.error(err); toast(err.message || String(err), { type: 'error', timeout: 5000 }); }
});

document.addEventListener('keydown', (e) => {
  if (S.status !== 'unlocked') return;
  const ctrl = e.ctrlKey || e.metaKey;
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); return zoom(0.1); }
  if (ctrl && e.key === '-') { e.preventDefault(); return zoom(-0.1); }
  if (ctrl && e.key === '0') { e.preventDefault(); return zoom(0); }
  if (modalOpen()) return;
  if (ctrl && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#search')?.focus(); $('#search')?.select(); return; }
  if (ctrl && e.key.toLowerCase() === 'l') { e.preventDefault(); kh.vault.lock(); return; }
  if (ctrl && e.key.toLowerCase() === 'n') { e.preventDefault(); if (!ITEM_VIEWS.has(S.view)) nav('all'); S.selectedId = null; startEdit(TYPES[S.view] && S.view !== 'passkey' ? S.view : 'login'); return; }
  if (ctrl && e.key.toLowerCase() === 'g') { e.preventDefault(); nav('generator'); return; }
  if (ctrl && e.key === ',') { e.preventDefault(); nav('settings'); return; }
  if (e.key === 'Escape' && S.editing) { e.preventDefault(); vaultActions['edit-cancel'](); return; }
  if (!typing && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); moveSelection(e.key === 'ArrowDown' ? 1 : -1); }
  if (!typing && S.selectedId && !S.editing && ctrl && e.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
    const it = byId(S.selectedId);
    if (it?.login?.password) { e.preventDefault(); vaultActions['copy-field']({ dataset: { key: `${it.id}:login:password`, label: 'Password copied' } }); }
  }
  if (!typing && S.selectedId && !S.editing && ctrl && e.key.toLowerCase() === 'b') {
    const it = byId(S.selectedId);
    if (it?.login?.username) { e.preventDefault(); vaultActions['copy-field']({ dataset: { key: `${it.id}:login:username`, label: 'Username copied' } }); }
  }
});

async function zoom(delta) {
  const next = delta === 0 ? 1 : Math.round(Math.min(2, Math.max(0.7, (S.settings.scale || 1) + delta)) * 100) / 100;
  await setSettings({ scale: next });
  toast(`Interface scale ${Math.round(next * 100)}%`, { timeout: 1200 });
  if (S.view === 'settings') renderMain();
}

for (const ev of ['mousemove', 'mousedown', 'keydown', 'wheel']) document.addEventListener(ev, () => kh.app.activity(), { passive: true });

kh.autotype.onChoose((payload) => { if (S.status === 'unlocked') autotypeChooser(payload); });

// ---------------------------------------------------------------- browser extension events
kh.ext.onPairRequest(async ({ reqId, code, browser }) => {
  const { modal } = await import('./ui.mjs');
  const ok = await modal({
    title: 'Connect a browser?',
    body: `<p class="modal-text"><b>${esc(browser)}</b> wants to connect to Vault so it can fill in your logins and passkeys.</p>
      <p class="modal-text">Only approve this if the code in the browser extension matches:</p>
      <div class="hotkey big mono">${esc(code)}</div>
      <p class="hint">${icon('info')}If you didn't just click “Connect” in the Vault extension, choose Deny.</p>`,
    actions: [{ label: 'Deny', value: false, kind: 'ghost' }, { label: 'Approve', value: true, kind: 'primary' }]
  });
  await kh.ext.respondPair(reqId, !!ok);
  if (ok) toast(`${browser} connected`, { type: 'success' });
});
kh.app.onVaultChanged(async () => {
  if (S.status !== 'unlocked') return;
  const r = await kh.vault.data();
  if (r.ok) { S.data = r.data; emit('items'); }
});
kh.app.onVaultUnlocked(async () => {
  if (S.status === 'unlocked') return;
  const r = await kh.vault.data();
  if (r.ok) { S.data = r.data; S.status = 'unlocked'; renderShell(); }
});
kh.app.onNav((v) => { if (S.status === 'unlocked') nav(v); });

// align the OTP ticker to the start of each second
setTimeout(() => { tickOtp(); setInterval(tickOtp, 1000); }, 1000 - (Date.now() % 1000));

// ---------------------------------------------------------------- boot
(async function boot() {
  const init = await kh.init();
  Object.assign(S, {
    settings: init.settings, platform: init.platform, version: init.version, kdf: init.kdf,
    vaultPath: init.vaultPath, autotypeSupported: init.autotypeSupported, hello: init.hello || { supported: false, enabled: false }
  });
  applyAppearance();
  if (init.status === 'unlocked') {
    const r = await kh.vault.data();
    if (r.ok) { S.data = r.data; S.status = 'unlocked'; renderShell(); return; }
  }
  S.status = init.status === 'setup' ? 'setup' : 'locked';
  renderLock();
  if (init.hotkey && !init.hotkey.ok) toast(`Auto-type shortcut ${prettyHotkey(init.settings.autotypeHotkey)}: ${init.hotkey.error}`, { type: 'error', timeout: 6000 });
})();
