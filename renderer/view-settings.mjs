import { S, setSettings, items, saveItems, emit } from './store.mjs';
import { icon } from './icons.mjs';
import { esc, toast, confirmDialog, promptPassword, modal } from './ui.mjs';
import { itemsFromCsv, dedupe } from './importers.mjs';
import { fetchIconsFor, prettyHotkey } from './view-vault.mjs';
import { estimateStrength } from '../shared/generator.mjs';
const HN = () => S.hello?.name || 'Windows Hello';

export const ACCENTS = [
  ['aura', 'Aura blue', '#4f7cff', '#8b5cf6'], ['violet', 'Violet', '#8b5cf6', '#d946ef'], ['ocean', 'Ocean', '#0ea5e9', '#14b8a6'],
  ['emerald', 'Emerald', '#10b981', '#84cc16'], ['sunset', 'Sunset', '#f97316', '#ef4444'], ['rose', 'Rose', '#f43f5e', '#ec4899'], ['graphite', 'Graphite', '#64748b', '#94a3b8']
];

const S_SYNC_LABEL = () => (S.platform === 'ios' ? 'Sync with PC' : 'iPhone & sync');
export const PHONE_APP_URL = 'https://auggiee01.github.io/zkk4rjb5e1rpoegu13vj8f7j/';
const SECTIONS_FN = () => [['appearance', 'Appearance', 'palette'], ['security', 'Security', 'lock'], ['sync', S_SYNC_LABEL(), 'refresh'], ['autotype', 'Auto-type', 'keyboard'], ['browser', 'Browser extension', 'globe'], ['privacy', 'Privacy & network', 'wifiOff'], ['data', 'Import & export', 'database'], ['system', 'Windows', 'monitor'], ['about', 'About & legal', 'info']];
let section = 'appearance';

const sel = (key, options, value) => `<select data-set="${key}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const sw = (key, value) => `<input type="checkbox" class="switch" data-set="${key}" ${value ? 'checked' : ''}>`;
const row = (title, desc, control) => `<div class="set-row"><div class="set-text"><b>${title}</b>${desc ? `<span>${desc}</span>` : ''}</div><div class="set-ctl">${control}</div></div>`;

function appearance(s) {
  return `<div class="card set-card"><h3>Theme</h3>
    <div class="theme-pick">${[['system', 'Match Windows', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']].map(([v, l, ic]) => `
      <button class="theme-opt ${s.theme === v ? 'on' : ''}" data-action="set-theme" data-v="${v}">
        <span class="theme-prev tp-${v}"><i></i><i></i><i></i></span><span>${icon(ic)}${l}</span></button>`).join('')}</div>
    <h3>Accent colour</h3>
    <div class="accent-pick">${ACCENTS.map(([v, l, a, b]) => `<button class="swatch ${s.accent === v ? 'on' : ''}" data-action="set-accent" data-v="${v}" title="${l}" style="--a:${a};--b:${b}">${s.accent === v ? icon('check') : ''}</button>`).join('')}</div>
  </div>
  <div class="card set-card"><h3>Size & layout</h3>
    ${row('Interface scale', 'Make everything bigger or smaller. Windows display scaling is already taken into account. Shortcut: <kbd>Ctrl</kbd> <kbd>+</kbd> / <kbd>−</kbd> / <kbd>0</kbd>',
      `<div class="scale-ctl"><input type="range" min="70" max="200" step="5" value="${Math.round(s.scale * 100)}" data-set="scale"><output>${Math.round(s.scale * 100)}%</output></div>`)}
    ${row('Density', 'Compact fits more items on screen.', sel('density', [['comfortable', 'Comfortable'], ['compact', 'Compact']], s.density))}
    ${row('Reduce motion', 'Turn off animations.', sw('reduceMotion', s.reduceMotion))}
  </div>`;
}

function security(s) {
  return `<div class="card set-card">
    ${row('Lock automatically', 'After this long without using Vault.', sel('autoLockMinutes', [[1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [240, '4 hours'], [0, 'Never']], s.autoLockMinutes))}
    ${row(S.platform === 'ios' ? 'Lock when you leave the app' : 'Lock when Windows locks or sleeps', S.platform === 'ios' ? 'Locks after 1 minute in the background. Recommended.' : 'Recommended.', sw('lockOnSystemLock', s.lockOnSystemLock))}
    ${S.platform === 'ios' ? '' : row('Lock when minimised', '', sw('lockOnMinimize', s.lockOnMinimize))}
    ${S.platform === 'ios' ? '' : row('Clear copied passwords', 'Removes passwords and codes from the clipboard after this long (only if you have not copied something else).', sel('clipboardClearSeconds', [[10, '10 seconds'], [20, '20 seconds'], [30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [0, 'Never']], s.clipboardClearSeconds))}
    ${S.platform === 'ios' ? '' : row('Hide from screenshots & screen sharing', 'Vault appears black in screenshots, recordings and when streaming or sharing your screen on Discord.', sw('hideFromCapture', s.hideFromCapture))}
  </div>
  ${S.hello.supported ? `<div class="card set-card">
    ${row(`Unlock with ${HN()}`, S.platform === 'ios' ? 'Open Vault with Face ID or your passcode. The unlock key is protected by a passkey on this iPhone, and your master password is still asked for every 14 days.' : 'Open Vault with your Windows PIN, face or fingerprint. The unlock key is protected by Windows Hello on this PC, and your master password is still asked for every 14 days.',
      S.helloStatus === null ? '<span class="muted small">Checking…</span>'
        : !S.helloStatus.available && !S.helloStatus.enabled ? (S.platform === 'ios' ? '<span class="muted small">Needs Face ID or a passcode set up on this iPhone</span>' : '<span class="muted small">Set up a PIN in Windows Settings → Accounts → Sign-in options first</span>')
        : `<input type="checkbox" class="switch" data-action="hello-toggle" ${S.helloStatus.enabled ? 'checked' : ''}>`)}
  </div>` : ''}
  <div class="card set-card">
    ${row('Master password', 'Changing it re-encrypts your vault key. Your old backups keep their old password.', `<button class="btn btn-soft sm" data-action="change-master">${icon('key')}Change</button>`)}
    ${row('Encryption', `AES-256-GCM, with your key derived from the master password using <b>${esc(S.kdf)}</b>${S.kdf === 'Argon2id' ? ' (64 MiB, 3 passes)' : S.kdf === 'scrypt' ? ' (128 MiB, N = 2¹⁷)' : ''}.`, `<span class="pill ok">${icon('shieldCheck')}Local only</span>`)}
  </div>`;
}

function autotype(s) {
  if (!S.autotypeSupported) return `<div class="card set-card"><p class="card-text">Auto-type is available in the Windows version of Vault.</p></div>`;
  return `<div class="card set-card">
    <p class="card-text">Desktop apps like <b>Battle.net</b>, <b>Steam</b>, <b>Discord</b> and <b>Roblox</b> don't let password managers fill their sign-in boxes. Auto-type solves this: click into the app's username box, press the shortcut, and Vault types your details for you.</p>
    ${row('Enable auto-type', '', sw('autotypeEnabled', s.autotypeEnabled))}
    ${row('Global shortcut', 'Works from any app while Vault is running (even in the tray).', `<button class="hotkey" data-action="record-hotkey">${esc(prettyHotkey(s.autotypeHotkey))}</button>`)}
    ${row('Default key sequence', 'Tokens: {USERNAME} {PASSWORD} {TOTP} {TAB} {ENTER} {DELAY 500}', `<input class="mono input-sm" data-set="autotypeSequence" value="${esc(s.autotypeSequence)}" spellcheck="false">`)}
    ${row('Typing speed', 'Slow down if an app misses characters.', sel('autotypeDelay', [[4, 'Fast'], [8, 'Normal'], [20, 'Careful'], [50, 'Slow']], s.autotypeDelay))}
  </div>
  <div class="card set-card tips"><h3>${icon('info')}How matching works</h3>
    <p class="card-text">Vault looks at the window you're in. A login matches when its name or website matches the window title or app (for example a login called “Steam” matches the “Sign in to Steam” window). If several logins match — say two Battle.net accounts — Vault asks which one to use. You can set an exact match per login in its <i>Auto-type</i> section.</p></div>`;
}

let syncInfo = null;
function qrSvg(text) {
  const qr = window.qrcodegen.QrCode.encodeText(text, window.qrcodegen.QrCode.Ecc.MEDIUM);
  const n = qr.size, b = 2; let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.getModule(x, y)) d += `M${x + b} ${y + b}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n + b * 2} ${n + b * 2}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
function sync() {
  if (S.platform === 'ios') {
    return `<div class="card set-card"><h3>${icon('refresh')}Sync with Vault on your PC</h3>
      <p class="card-text">Your PC keeps an encrypted copy of your vault in <b>iCloud Drive</b>, which your iPhone reads through the <b>Files</b> app. Only encrypted data is ever stored in iCloud.</p>
      <div class="row-actions"><button class="btn btn-primary sm" data-action="sync-pull">${icon('download')}Get changes from PC</button><button class="btn btn-soft sm" data-action="sync-push">${icon('upload')}Send changes to PC</button></div>
      <p class="hint">${S.settings.lastSync ? 'Last synced ' + esc(new Date(S.settings.lastSync).toLocaleString()) : 'Not synced yet'}</p></div>
      <div class="card set-card tips"><h3>${icon('info')}How it works</h3><ol class="steps">
        <li><b>Get changes from PC</b>: pick <span class="mono">iCloud Drive → Vault → Vault-sync.kvault</span>. New and edited items are merged in, and nothing is lost.</li>
        <li><b>Send changes to PC</b>: save the file into that same folder. Vault on your PC merges it within a few seconds while it's unlocked.</li>
      </ol></div>`;
  }
  if (!syncInfo) { window.kh.sync.info().then((r) => { syncInfo = r; emit('view'); }); return '<div class="card set-card"><p class="card-text">Loading…</p></div>'; }
  const i = syncInfo;
  return `<div class="card set-card"><h3>${icon('refresh')}Sync with your iPhone</h3>
    <p class="card-text">Vault keeps an encrypted copy of your vault in <b>iCloud Drive</b>. Your iPhone reads it through its Files app and sends changes back. iCloud only ever sees encrypted data.</p>
    ${i.folder ? `${row('Sync folder', `<span class="mono">${esc(i.folder)}</span>`, `<button class="btn btn-ghost sm" data-action="sync-open">${icon('folder')}Open</button><button class="btn btn-ghost sm danger" data-action="sync-off">Stop syncing</button>`)}
      ${row('Status', i.lastError ? `<span class="bad-text">${esc(i.lastError)}</span>` : i.lastSync ? 'Checked ' + esc(new Date(i.lastSync).toLocaleTimeString()) + '. Vault checks every 20 seconds while unlocked' : 'Waiting for first sync', `<button class="btn btn-soft sm" data-action="sync-now">${icon('refresh')}Sync now</button>`)}`
      : i.iCloud ? `<div class="row-actions"><button class="btn btn-primary sm" data-action="sync-icloud">${icon('folder')}Use iCloud Drive</button><button class="btn btn-ghost sm" data-action="sync-choose">${icon('folder')}Choose another folder…</button></div>
         <p class="hint">Creates <span class="mono">${esc(i.iCloud)}\\Vault</span>.</p>`
      : `<ol class="steps"><li>Install <b>iCloud for Windows</b> from the Microsoft Store (it's free, from Apple).</li><li>Sign in with the same Apple ID as your iPhone and tick <b>iCloud Drive</b>.</li><li>Come back here and click <b>Check again</b>.</li></ol>
         <div class="row-actions"><button class="btn btn-primary sm" data-action="sync-recheck">${icon('refresh')}Check again</button><button class="btn btn-soft sm" data-action="open-ms-store">${icon('external')}Get iCloud for Windows</button><button class="btn btn-ghost sm" data-action="sync-choose">${icon('folder')}Choose another folder…</button></div>`}
  </div>
  <div class="card set-card"><h3>${icon('monitor')}Install Vault on your iPhone</h3>
    <div class="phone-setup"><div class="qr-box small">${qrSvg(PHONE_APP_URL)}</div>
    <ol class="steps"><li>Scan this with your iPhone's Camera, or open <span class="mono">${esc(PHONE_APP_URL)}</span> in <b>Safari</b>.</li>
      <li>Tap the <b>Share</b> button, then <b>Add to Home Screen</b>, then <b>Add</b>.</li>
      <li>Open Vault from your Home Screen and choose <b>Open my vault from my PC</b>, then pick <span class="mono">iCloud Drive → Vault → Vault-sync.kvault</span> and enter your master password.</li>
      <li>Turn on <b>Face ID</b> when it asks.</li></ol></div>
  </div>`;
}

let extInfo = null;
function browser() {
  if (!extInfo) {
    window.kh.ext.info().then((r) => { extInfo = r; emit('view'); });
    return '<div class="card set-card"><p class="card-text">Loading…</p></div>';
  }
  const pairs = extInfo.pairs || [];
  return `<div class="card set-card">
    <h3>${icon('globe')}Use Vault in Chrome, Edge, Brave or Opera</h3>
    <p class="card-text">The extension fills your logins, saves new ones, suggests strong passwords, fills 2FA codes and handles <b>passkeys</b>. Everything stays in this app. The extension only asks it for what the current website needs.</p>
    <ol class="steps">
      <li>Open your browser's extensions page: <span class="mono">chrome://extensions</span> (Edge: <span class="mono">edge://extensions</span>, Brave: <span class="mono">brave://extensions</span>).</li>
      <li>Turn on <b>Developer mode</b> (a switch at the top right, or bottom left in Edge).</li>
      <li>Click <b>Load unpacked</b> and choose the Vault extension folder.</li>
      <li>Pin the Vault icon in the toolbar, click it and choose <b>Connect</b>, then approve the request here.</li>
    </ol>
    <div class="row-actions">
      <button class="btn btn-primary sm" data-action="ext-folder">${icon('folder')}Open extension folder</button>
      <button class="btn btn-soft sm" data-action="ext-copy" data-text="${esc(extInfo.extensionDir || '')}">${icon('copy')}Copy folder path</button>
    </div>
    <p class="hint mono small">${esc(extInfo.extensionDir || 'Extension folder not found — reinstall Vault')}</p>
  </div>
  <div class="card set-card"><h3>${icon('link')}Connected browsers</h3>
    ${pairs.length ? pairs.map((p) => row(esc(p.name), `Connected ${esc(new Date(p.createdAt).toLocaleDateString())}${p.lastUsed ? ' · last used ' + esc(new Date(p.lastUsed).toLocaleDateString()) : ''}`,
      `<button class="btn btn-ghost sm danger" data-action="ext-remove" data-id="${esc(p.id)}">${icon('x')}Disconnect</button>`)).join('')
      : '<p class="card-text">No browsers connected yet.</p>'}
  </div>
  <div class="card set-card tips"><h3>${icon('passkey')}Passkeys</h3>
    <p class="card-text">When a website offers to create a passkey, Vault asks whether to save it here, and Windows Hello confirms it's you. To move a passkey from another manager (like 1Password), sign in as usual, add a new passkey in that site's security settings while the Vault extension is on, then remove the old one there.</p></div>`;
}

function privacy(s) {
  return `<div class="card set-card">
    <p class="card-text"><b>Vault has no account, no server and no telemetry.</b> Your vault is a single encrypted file on this computer. The only network requests it can make are the two optional features below.</p>
    ${row('Fetch website icons', 'When you add a website, Vault downloads its icon directly from that website (not via Google or any other service) and stores it encrypted in your vault.', sw('fetchIcons', s.fetchIcons))}
    ${row('Breach checking', 'Compare passwords against Have I Been Pwned using k-anonymity: only the first 5 characters of a SHA-1 hash are sent, never your password.', sw('breachCheck', s.breachCheck))}
  </div>
  <div class="card set-card">${row('Fetch missing icons now', 'Useful after importing.', `<button class="btn btn-soft sm" data-action="fetch-icons">${icon('refresh')}Fetch icons</button>`)}</div>`;
}

function data() {
  return `<div class="card set-card"><h3>Import</h3>
    ${row('From a browser or password manager (CSV)', 'Chrome, Edge, Firefox, Bitwarden, 1Password, LastPass, Proton Pass, Aura and most others can export a CSV file. Delete that file after importing — it is not encrypted.', `<button class="btn btn-soft sm" data-action="import-csv">${icon('upload')}Import CSV</button>`)}
    ${row('From a Vault backup', 'Adds items from an encrypted .kvault backup (duplicates are skipped).', `<button class="btn btn-soft sm" data-action="import-kvault">${icon('upload')}Import backup</button>`)}
    ${row('2FA codes from Google Authenticator', 'In Google Authenticator choose “Transfer accounts → Export”, then add the QR code it shows from the Authenticator page.', `<button class="btn btn-soft sm" data-action="add-2fa">${icon('qr')}Scan export QR</button>`)}
  </div>
  <div class="card set-card"><h3>Export & backup</h3>
    ${row('Encrypted backup', 'A copy of your whole vault protected by a password you choose. Keep one on a USB stick or cloud drive.', `<button class="btn btn-soft sm" data-action="export-kvault">${icon('download')}Save backup</button>`)}
    ${row('Unencrypted CSV', 'For moving to another password manager. <b>Anyone who opens this file can read every password.</b>', `<button class="btn btn-ghost sm danger" data-action="export-csv">${icon('alert')}Export CSV</button>`)}
    ${S.platform === 'ios' ? '' : row('Automatic backups', 'Vault keeps the last 10 versions of your vault in a “backups” folder next to it.', `<button class="btn btn-ghost sm" data-action="open-folder">${icon('folder')}Open folder</button>`)}
    <p class="hint mono small">${esc(S.vaultPath)}</p>
  </div>`;
}

function system(s) {
  return `<div class="card set-card">
    ${row('Keep running in the system tray', 'Closing the window keeps Vault in the tray so the auto-type shortcut still works. Quit from the tray icon.', sw('closeToTray', s.closeToTray))}
    ${row('Start with Windows', 'Starts quietly in the tray (still locked) when you sign in.', sw('startWithWindows', s.startWithWindows))}
    ${row('Quit Vault', '', `<button class="btn btn-ghost sm" data-action="quit">${icon('logout')}Quit</button>`)}
  </div>`;
}

function about() {
  return `<div class="card set-card">
    <h3>Vault ${esc(S.version)}</h3>
    <p class="card-text">A personal password manager and authenticator built just for you. Everything stays on this device, encrypted with your master password.</p>
    <h3>Open-source components</h3>
    <ul class="credits">
      <li><b>Electron</b> — MIT License</li>
      <li><b>jsQR</b> by Cosmo Wolfe — Apache License 2.0</li>
      <li><b>QR Code generator library</b> by Project Nayuki — MIT License</li>
      <li><b>EFF Long Wordlist</b> by the Electronic Frontier Foundation — CC BY 3.0 US</li>
      <li><b>Pwned Passwords</b> by Have I Been Pwned (Troy Hunt) — CC BY 4.0 (optional breach checking)</li>
    </ul>
    <h3>Your responsibilities</h3>
    <p class="card-text">There is no password reset: if you forget your master password, the vault cannot be recovered — keep an encrypted backup and write your master password down somewhere safe offline. Use Vault only with accounts that are yours.</p>
  </div>`;
}

export function renderSettingsPage(main) {
  if (section !== 'browser') extInfo = null;
  if (section !== 'sync') syncInfo = null;
  const s = S.settings;
  if (section === 'security' && S.hello.supported && S.helloStatus === null) {
    window.kh.hello.status().then((st) => { S.helloStatus = st.error ? { available: false, enabled: false } : st; emit('view'); });
  }
  const body = { appearance, security, sync, autotype, browser, privacy, data, system, about }[section](s);
  main.innerHTML = `<div class="page settings">
    <div class="page-head"><div><h1>Settings</h1></div></div>
    <div class="set-layout">
      <nav class="set-nav">${SECTIONS_FN().filter(([k]) => S.platform === 'ios' ? !['system', 'autotype', 'browser'].includes(k) : (k !== 'system' || S.platform === 'win32')).map(([k, l, ic]) => `<button class="${k === section ? 'on' : ''}" data-action="set-section" data-v="${k}">${icon(ic)}<span>${l}</span></button>`).join('')}</nav>
      <div class="set-body">${body}</div>
    </div>
  </div>`;
  main.querySelector('.set-body').addEventListener('change', onSettingChange);
  main.querySelector('.set-body').addEventListener('input', (e) => {
    if (e.target.dataset.set === 'scale') e.target.nextElementSibling.textContent = e.target.value + '%';
  });
}

async function onSettingChange(e) {
  const k = e.target.dataset.set;
  if (!k) return;
  let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (['autoLockMinutes', 'clipboardClearSeconds', 'autotypeDelay'].includes(k)) v = Number(v);
  if (k === 'scale') v = Number(v) / 100;
  if (k === 'breachCheck' && v) {
    e.target.checked = false;
    const { healthActions } = await import('./view-health.mjs');
    return healthActions['breach-enable']();
  }
  const r = await setSettings({ [k]: v });
  if (r.hotkey && !r.hotkey.ok) toast(r.hotkey.error, { type: 'error', timeout: 5000 });
  if (k !== 'autotypeSequence') emit('appearance');
}

function recordHotkey() {
  return modal({
    title: 'Set auto-type shortcut',
    body: `<p class="modal-text">Press the new key combination. Use at least one of Ctrl, Alt or Shift plus a letter, number or F-key.</p><div class="hotkey big" id="hkShow">Waiting…</div><p class="form-error" hidden></p>`,
    actions: [{ label: 'Cancel', value: null, kind: 'ghost' }, { label: 'Save', kind: 'primary', value: (el) => el.querySelector('#hkShow').dataset.acc || null }],
    onMount: (el) => {
      const show = el.querySelector('#hkShow');
      const onKey = (e) => {
        if (!el.isConnected) return document.removeEventListener('keydown', onKey, true);
        if (['Control', 'Alt', 'Shift', 'Meta', 'Escape', 'Enter'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
        let key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : /^F\d+$/.test(e.code) ? e.code : e.code === 'Space' ? 'Space' : e.code === 'Backquote' ? '`' : null;
        if (!key || !mods.length) { el.querySelector('.form-error').textContent = 'Add Ctrl, Alt or Shift and a letter, number or F-key'; el.querySelector('.form-error').hidden = false; return; }
        const acc = [...mods, key].join('+');
        show.dataset.acc = acc; show.textContent = prettyHotkey(acc); el.querySelector('.form-error').hidden = true;
      };
      document.addEventListener('keydown', onKey, true);
    }
  });
}

export const settingsActions = {
  'set-section': (el) => { section = el.dataset.v; emit('view'); },
  'set-theme': async (el) => { await setSettings({ theme: el.dataset.v }); emit('appearance'); },
  'set-accent': async (el) => { await setSettings({ accent: el.dataset.v }); emit('appearance'); },
  'record-hotkey': async () => {
    const acc = await recordHotkey();
    if (!acc) return;
    const r = await setSettings({ autotypeHotkey: acc });
    if (r.hotkey && !r.hotkey.ok) toast(r.hotkey.error, { type: 'error', timeout: 5000 }); else toast('Shortcut saved', { type: 'success' });
    emit('view');
  },
  'hello-toggle': async () => {
    if (S.helloStatus?.enabled) {
      await window.kh.hello.disable();
      S.helloStatus = { ...S.helloStatus, enabled: false }; S.hello.enabled = false;
      toast(`${HN()} unlock turned off`);
    } else {
      const pw = await promptPassword(`Turn on ${HN()}`, S.platform === 'ios' ? 'Enter your master password. Your iPhone will then ask to save a passkey for Vault and confirm with Face ID (possibly twice).' : 'Enter your master password. Windows will then ask for your PIN, face or fingerprint (possibly twice).', { label: 'Master password' });
      if (!pw) return emit('view');
      const r = await window.kh.hello.enable(pw);
      if (r.error) { toast(r.error === 'WRONG_PASSWORD' ? 'Incorrect master password' : r.message, { type: 'error', timeout: 5000 }); return emit('view'); }
      S.helloStatus = { ...S.helloStatus, enabled: true }; S.hello.enabled = true;
      toast(`${HN()} is on — try it next time you unlock`, { type: 'success' });
    }
    emit('view');
  },
  'change-master': async () => {
    const oldPw = await promptPassword('Change master password', 'First, enter your current master password.', { label: 'Current master password' });
    if (!oldPw) return;
    const newPw = await promptPassword('Choose a new master password', 'Use a long passphrase you can remember — at least 12 characters is a good idea. There is no way to recover it if forgotten.', { confirm: true, label: 'New master password', minLength: 8 });
    if (!newPw) return;
    if (estimateStrength(newPw).score < 2 && !(await confirmDialog('That password is weak', 'Your master password protects everything. Use it anyway?', { confirmLabel: 'Use anyway', danger: true }))) return;
    toast('Re-encrypting…', { timeout: 1500 });
    const r = await window.kh.vault.changePassword(oldPw, newPw);
    if (r.error) toast(r.error === 'WRONG_PASSWORD' ? 'Current master password is incorrect' : r.message, { type: 'error', timeout: 4000 });
    else toast('Master password changed', { type: 'success' });
  },
  'fetch-icons': async () => {
    const ids = items().filter((i) => i.type === 'login' && !i.icon && (i.login.urls || []).some(Boolean)).map((i) => i.id);
    if (!ids.length) return toast('All logins with a website already have icons');
    toast(`Fetching ${ids.length} icons…`);
    const n = await fetchIconsFor(ids, { force: true });
    toast(`Got ${n} of ${ids.length} icons`, { type: 'success' });
  },
  'import-csv': async () => {
    const r = await window.kh.files.openText('csv');
    if (r.canceled) return;
    if (r.error) return toast(r.message, { type: 'error' });
    let parsed;
    try { parsed = itemsFromCsv(r.text); } catch (e) { return toast(e.message, { type: 'error', timeout: 5000 }); }
    const { items: fresh, duplicates } = dedupe(parsed.items, items());
    const ok = await confirmDialog(`Import ${fresh.length} items?`, `Detected format: <b>${esc(parsed.format)}</b>. ${duplicates ? `${duplicates} duplicates will be skipped. ` : ''}${parsed.skipped ? `${parsed.skipped} rows were not logins or notes and were skipped. ` : ''}<br><br>After importing, <b>delete ${esc(r.name)}</b> (and empty the Recycle Bin) — it contains your passwords in plain text.`, { confirmLabel: 'Import' });
    if (!ok || !fresh.length) return;
    await saveItems(fresh);
    toast(`Imported ${fresh.length} items`, { type: 'success' });
    emit('view');
    if (S.settings.fetchIcons) fetchIconsFor(fresh.map((i) => i.id));
  },
  'import-kvault': async () => {
    const r = await window.kh.files.openText('kvault');
    if (r.canceled) return;
    const pw = await promptPassword('Unlock backup', `Enter the password for <b>${esc(r.name)}</b>.`);
    if (!pw) return;
    const d = await window.kh.vault.decryptBackup(r.text, pw);
    if (d.error) return toast(d.error === 'WRONG_PASSWORD' ? 'Wrong password for this backup' : d.message, { type: 'error', timeout: 4000 });
    const existingIds = new Set(items().map((i) => i.id));
    const { items: fresh } = dedupe(d.data.items.filter((i) => !existingIds.has(i.id)), items());
    if (!fresh.length) return toast('Everything in this backup is already in your vault');
    await saveItems(fresh);
    toast(`Imported ${fresh.length} items`, { type: 'success' });
    emit('view');
  },
  'export-kvault': async () => {
    const pw = await promptPassword('Backup password', 'Choose a password for this backup. You can reuse your master password, or pick a different one.', { confirm: true, minLength: 8 });
    if (!pw) return;
    const r = await window.kh.vault.exportEncrypted(pw);
    if (r.ok) toast('Backup saved', { type: 'success' }); else if (r.error) toast(r.message, { type: 'error' });
  },
  'export-csv': async () => {
    const ok = await confirmDialog('Export without encryption?', 'The CSV file will contain <b>every password in plain text</b>. Only do this to move to another password manager, and delete the file straight afterwards.', { confirmLabel: 'I understand, export', danger: true });
    if (!ok) return;
    const pw = await promptPassword('Confirm it\'s you', 'Enter your master password to export.', { label: 'Master password' });
    if (!pw) return;
    const check = await window.kh.vault.verify(pw);
    if (!check.ok) return toast('Incorrect master password', { type: 'error' });
    const r = await window.kh.vault.exportCsv();
    if (r.ok) toast('Exported — remember to delete the file when done', { type: 'success', timeout: 5000 });
  },
  'open-folder': () => window.kh.app.openDataFolder(),
  'ext-folder': () => window.kh.ext.openFolder(),
  'sync-icloud': async () => { const r = await window.kh.sync.useICloud(); if (r.error) toast(r.message, { type: 'error', timeout: 6000 }); else toast('Syncing with iCloud Drive\\Vault', { type: 'success' }); syncInfo = null; emit('view'); },
  'sync-recheck': () => { syncInfo = null; emit('view'); },
  'open-ms-store': () => window.kh.app.openExternal('https://www.microsoft.com/store/apps/9PKTQ5699M62'),
  'sync-onedrive': async () => { const r = await window.kh.sync.useOneDrive(); if (r.error) toast(r.message, { type: 'error' }); else toast('Syncing with OneDrive\\Vault', { type: 'success' }); syncInfo = null; emit('view'); },
  'sync-choose': async () => { const r = await window.kh.sync.choose(); if (r.ok) toast('Sync folder set', { type: 'success' }); syncInfo = null; emit('view'); },
  'sync-off': async () => { await window.kh.sync.disable(); syncInfo = null; emit('view'); },
  'sync-open': () => window.kh.sync.openFolder(),
  'sync-now': async () => { const r = await window.kh.sync.now(); toast(r.ok ? (r.files ? `Merged changes from ${r.files} file${r.files === 1 ? '' : 's'}` : 'Up to date') : (r.message || 'Sync is waiting: unlock Vault first'), { type: r.ok ? 'success' : 'error' }); syncInfo = null; emit('view'); },
  'sync-pull': async () => {
    const r = await window.kh.sync.pull();
    if (r.canceled) return;
    if (r.error) return toast(r.message, { type: 'error', timeout: 6000 });
    S.data = r.data;
    toast(r.added + r.updated + r.removed ? `Synced: ${r.added} new, ${r.updated} updated, ${r.removed} removed` : 'Already up to date', { type: 'success', timeout: 4000 });
    emit('items'); emit('view');
  },
  'sync-push': async () => { const r = await window.kh.sync.push(); if (r.ok) { toast('Saved. Vault on your PC will merge it', { type: 'success' }); emit('view'); } else if (r.error) toast(r.message, { type: 'error' }); },
  'ext-copy': (el) => window.kh.clipboard.copy(el.dataset.text, false).then(() => toast('Folder path copied — paste it in the “Load unpacked” window', { type: 'success', timeout: 4000 })),
  'ext-remove': async (el) => {
    if (!(await confirmDialog('Disconnect this browser?', 'The extension in that browser will need to connect again before it can fill anything.', { confirmLabel: 'Disconnect', danger: true }))) return;
    await window.kh.ext.remove(el.dataset.id); extInfo = null; emit('view');
  },
  'quit': () => window.kh.app.quit()
};
