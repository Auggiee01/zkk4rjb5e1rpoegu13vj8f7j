import { S, TYPES, visibleItems, byId, saveItems, deleteItems, newItem, subtitle, cardBrand, emit, items } from './store.mjs';
import { icon } from './icons.mjs';
import { esc, $, avatar, copy, toast, confirmDialog, modal, fmtDate, timeAgo, strengthBar, colorizePassword, domainOf } from './ui.mjs';
import { estimateStrength } from '../shared/generator.mjs';
import { ring, tickOtp, add2faFlow, showOtpQr, copyOtp, draftOtps, hotpNext } from './view-auth.mjs';
import { generatorPopover } from './view-generator.mjs';
import { findSuggestions, loginsForPasskey, mergePasskeyInto, separatePasskey, removeEmbeddedPasskey } from './tidy.mjs';

const reveal = new Set();
const isNarrow = () => window.matchMedia('(max-width: 720px)').matches;

// ---------------------------------------------------------------- layout
export function renderVaultView(main) {
  const title = S.view === 'all' ? 'All items' : S.view === 'favorites' ? 'Favourites' : TYPES[S.view]?.plural || 'Items';
  const newType = TYPES[S.view] && S.view !== 'passkey' ? S.view : 'login';
  main.innerHTML = `<div class="split ${S.selectedId || S.editing ? 'has-detail' : ''}">
    <section class="list-pane">
      <div class="pane-head">
        ${S.platform === 'ios' ? `<button class="title-btn" data-action="cat-menu"><h1>${esc(title)}</h1>${icon('chevronDown')}</button>` : `<h1>${esc(title)}</h1>`}<span class="count" id="listCount"></span>
        <div class="grow"></div>
        <div class="menu-wrap">
          <button class="icon-btn" data-action="sort-menu" title="Sort">${icon('sliders')}</button>
        </div>
        <div class="btn-split">
          <button class="btn btn-primary sm" data-action="new" data-type="${newType}">${icon('plus')}<span class="hide-xs">New</span></button>
          <button class="btn btn-primary sm caret" data-action="new-menu" title="Choose item type">${icon('chevronDown')}</button>
        </div>
      </div>
      <div id="tidyBanner"></div>
      <div class="list" id="list" role="listbox" tabindex="0"></div>
    </section>
    <section class="detail-pane" id="detail"></section>
  </div>`;
  renderList();
  renderDetail();
}

function renderTidyBanner() {
  const b = $('#tidyBanner');
  if (!b) return;
  const show = ['all', 'login', 'passkey'].includes(S.view) && !S.search;
  const n = show ? findSuggestions().count : 0;
  b.innerHTML = n ? `<button class="tidy-banner" data-action="tidy">${icon('sparkle')}<span><b>Tidy up</b> ${n} ${n === 1 ? 'item belongs' : 'items belong'} together</span>${icon('chevronRight')}</button>` : '';
}

export function renderList() {
  const host = $('#list');
  if (!host) return;
  renderTidyBanner();
  const list = visibleItems();
  $('#listCount').textContent = list.length;
  if (!list.length) {
    host.innerHTML = S.search
      ? `<div class="empty-state">${icon('search')}<h3>No matches</h3><p>Nothing in this view matches “${esc(S.search)}”.</p></div>`
      : emptyList();
    return;
  }
  host.innerHTML = list.map((it) => `
    <button class="row ${it.id === S.selectedId ? 'active' : ''}" role="option" data-action="select" data-id="${esc(it.id)}">
      ${avatar(it)}
      <span class="row-text"><span class="row-title">${esc(it.name)}</span><span class="row-sub">${esc(subtitle(it))}</span></span>
      <span class="row-badges">${(it.login?.passkeys || []).length ? `<span class="badge" title="Passkey saved">${icon('passkey')}</span>` : ''}${it.login?.totp ? `<span class="badge" title="2FA code saved">${icon('otp')}</span>` : ''}${it.favorite ? `<span class="badge fav">${icon('star')}</span>` : ''}</span>
    </button>`).join('');
}

function emptyList() {
  const t = TYPES[S.view];
  if (S.view === 'passkey') {
    return `<div class="empty-state">${icon('passkey')}<h3>No passkeys yet</h3><p>Passkeys are created when you sign up or turn on “passkey sign-in” on a website. Install the Vault browser extension (Settings → Browser extension) and Vault will offer to save them here.</p></div>`;
  }
  return `<div class="empty-state">${icon(t?.icon || 'shield')}<h3>${t ? `No ${t.plural.toLowerCase()} yet` : S.view === 'favorites' ? 'No favourites yet' : 'Your vault is empty'}</h3>
    <p>${S.view === 'favorites' ? 'Star an item to keep it here.' : 'Add your first item, or import from your browser or another password manager in Settings → Data.'}</p>
    ${S.view !== 'favorites' ? `<button class="btn btn-primary" data-action="new" data-type="${t ? S.view : 'login'}">${icon('plus')}Add ${t ? t.label.toLowerCase() : 'a login'}</button>` : ''}</div>`;
}

export function renderDetail() {
  const host = $('#detail');
  if (!host) return;
  host.closest('.split')?.classList.toggle('has-detail', !!(S.selectedId || S.editing));
  if (S.editing) { renderEditor(host); return; }
  const it = byId(S.selectedId);
  if (!it) {
    host.innerHTML = `<div class="detail-empty">${icon('shieldCheck')}<h3>Select an item</h3><p>Pick something from the list, or press <kbd>Ctrl</kbd> <kbd>N</kbd> to add a login.</p></div>`;
    return;
  }
  host.innerHTML = detailHtml(it);
  host.scrollTop = 0;
  tickOtp();
}

// ---------------------------------------------------------------- detail
function fieldRow(label, value, { key, secret = false, mono = false, copyLabel, extra = '', multiline = false } = {}) {
  if (value === undefined || value === null || value === '') return '';
  const shown = !secret || reveal.has(key);
  const display = shown ? (mono ? `<span class="mono">${secret ? colorizePassword(value) : esc(value)}</span>` : esc(value)) : '<span class="dots">••••••••••••</span>';
  return `<div class="field">
    <div class="field-main"><label>${esc(label)}</label><div class="value ${multiline ? 'pre' : ''}">${display}</div>${extra}</div>
    <div class="field-actions">
      ${secret ? `<button class="icon-btn" data-action="reveal" data-key="${esc(key)}" title="${shown ? 'Hide' : 'Show'}">${icon(shown ? 'eyeOff' : 'eye')}</button>` : ''}
      <button class="icon-btn" data-action="copy-field" data-key="${esc(key)}" data-label="${esc(copyLabel || label + ' copied')}" title="Copy">${icon('copy')}</button>
    </div>
  </div>`;
}

export function fieldValue(it, key) {
  const [, ...path] = key.split(':');
  let v = it;
  for (const p of path) v = v?.[p];
  return v;
}

function detailHead(it) {
  const site = it.type === 'login' ? (it.login.urls || []).find(Boolean) : '';
  return `<div class="detail-head">
    <button class="icon-btn back" data-action="back" title="Back">${icon('chevronLeft')}</button>
    ${avatar(it, 'lg')}
    <div class="dh-text">
      <h2>${esc(it.name)}</h2>
      ${site ? `<button class="link" data-action="open-url" data-url="${esc(site)}">${esc(domainOf(site))}${icon('external')}</button>${(() => { const n = (it.login.urls || []).filter(Boolean).length - 1; return n > 0 ? `<span class="muted small"> +${n} more website${n === 1 ? '' : 's'}</span>` : ''; })()}` : `<span class="muted">${esc(TYPES[it.type].label)}</span>`}
    </div>
    <div class="dh-actions">
      <button class="icon-btn ${it.favorite ? 'on' : ''}" data-action="fav" data-id="${esc(it.id)}" title="${it.favorite ? 'Remove from favourites' : 'Add to favourites'}">${icon('star')}</button>
      ${it.type === 'login' && S.autotypeSupported ? `<button class="btn btn-soft sm" data-action="autotype" data-id="${esc(it.id)}" title="Type the username and password into the app you were just using">${icon('keyboard')}<span class="hide-sm">Auto-type</span></button>` : ''}
      ${it.type !== 'passkey' ? `<button class="btn btn-soft sm" data-action="edit" data-id="${esc(it.id)}">${icon('edit')}<span class="hide-sm">Edit</span></button>` : ''}
      <button class="icon-btn danger" data-action="delete" data-id="${esc(it.id)}" title="Delete">${icon('trash')}</button>
    </div>
  </div>`;
}

function detailHtml(it) {
  const id = it.id;
  let body = '';
  if (it.type === 'login') {
    const l = it.login;
    const st = l.password ? estimateStrength(l.password) : null;
    const reused = l.password ? items().filter((x) => x.id !== id && x.login?.password === l.password).length : 0;
    const warn = [
      l.breach?.count ? `<span class="pill bad">${icon('alert')}Found in ${l.breach.count.toLocaleString()} breaches — change it</span>` : '',
      reused ? `<span class="pill warn">${icon('copy')}Reused on ${reused} other ${reused === 1 ? 'login' : 'logins'}</span>` : ''
    ].join('');
    body += `<div class="card fields">
      ${fieldRow('Username', l.username, { key: `${id}:login:username`, copyLabel: 'Username copied' })}
      ${fieldRow('Password', l.password, { key: `${id}:login:password`, secret: true, mono: true, copyLabel: 'Password copied', extra: st ? `<div class="field-extra">${strengthBar(st.score, st.label)}${warn}</div>` : '' })}
      ${l.totp ? `<div class="field otp-field" data-otp-host>
          <div class="field-main"><label>One-time code${l.totp.type === 'steam' ? ' · Steam Guard' : ''}</label>
            <div class="value"><span class="otp-code mono big" data-otp="${esc(id)}">••• •••</span></div></div>
          <div class="field-actions">${l.totp.type === 'hotp' ? `<button class="icon-btn" data-action="hotp-next" data-id="${esc(id)}" title="Next code">${icon('refresh')}</button>` : ring()}
            <button class="icon-btn" data-action="otp-qr" data-id="${esc(id)}" title="Show QR to move to another device">${icon('qr')}</button>
            <button class="icon-btn" data-action="copy-otp" data-id="${esc(id)}" title="Copy code">${icon('copy')}</button></div>
        </div>`
        : `<div class="field muted-field"><div class="field-main"><label>Two-factor authentication</label><div class="value muted">Not set up in Vault</div></div>
            <div class="field-actions"><button class="btn btn-soft sm" data-action="attach-2fa" data-id="${esc(id)}">${icon('qr')}Add code</button></div></div>`}
    </div>`;
    const urls = (l.urls || []).filter(Boolean);
    if (urls.length) body += `<div class="card"><div class="card-head"><h3>${icon('globe')}Websites</h3></div>${urls.map((u) => `
      <div class="field"><div class="field-main"><div class="value">${esc(u)}</div></div><div class="field-actions">
        <button class="icon-btn" data-action="open-url" data-url="${esc(u)}" title="Open in browser">${icon('external')}</button>
        <button class="icon-btn" data-action="copy-text" data-text="${esc(u)}" title="Copy">${icon('copy')}</button></div></div>`).join('')}</div>`;
    if ((l.passkeys || []).length) body += `<div class="card"><div class="card-head"><h3>${icon('passkey')}Passkeys</h3></div>${l.passkeys.map((p) => `
      <div class="field"><div class="field-main"><label>${esc(p.rpId)}</label><div class="value">${esc(p.userName || p.userDisplayName || 'Passkey')}</div>
        <div class="muted small">Created ${esc(fmtDate(p.createdOn))} · ${p.lastUsed ? 'last used ' + esc(timeAgo(p.lastUsed)) : 'not used yet'}</div></div>
        <div class="field-actions"><button class="btn btn-ghost xs" data-action="pk-separate" data-id="${esc(id)}" data-cred="${esc(p.credentialId)}" title="Make this passkey its own item again">Separate</button>
        <button class="icon-btn danger" data-action="pk-remove" data-id="${esc(id)}" data-cred="${esc(p.credentialId)}" title="Delete passkey">${icon('trash')}</button></div></div>`).join('')}
      <p class="hint">${icon('info')}Vault signs you in to ${esc(l.passkeys[0].rpId)} with this passkey through the browser extension, confirmed with Windows Hello.</p></div>`;
    if (S.autotypeSupported) {
      const at = l.autotype || {};
      body += `<div class="card"><div class="card-head"><h3>${icon('keyboard')}Auto-type for desktop apps</h3></div>
        <p class="card-text">${at.enabled === false ? 'Turned off for this login.' : `Press <kbd>${esc(prettyHotkey(S.settings.autotypeHotkey))}</kbd> while ${at.match ? `a window matching <b>${esc(at.match)}</b>` : `the <b>${esc(it.name)}</b> app or sign-in window`} is focused and Vault types <span class="mono small">${esc(at.sequence || S.settings.autotypeSequence)}</span>.`}</p></div>`;
    }
  }
  if (it.type === 'card') {
    const c = it.card;
    const num = String(c.number || '').replace(/\D/g, '');
    body += `<div class="credit-card"><div class="cc-brand">${esc(cardBrand(num))}</div><div class="cc-num mono">${num ? (reveal.has(`${id}:card:number`) ? esc(num.replace(/(.{4})/g, '$1 ').trim()) : '•••• •••• •••• ' + esc(num.slice(-4))) : ''}</div>
      <div class="cc-bottom"><span>${esc(c.holder || '')}</span><span class="mono">${esc(c.expMonth ? `${String(c.expMonth).padStart(2, '0')}/${String(c.expYear).slice(-2)}` : '')}</span></div></div>
      <div class="card fields">
        ${fieldRow('Cardholder', c.holder, { key: `${id}:card:holder` })}
        ${fieldRow('Card number', num, { key: `${id}:card:number`, secret: true, mono: true, copyLabel: 'Card number copied' })}
        ${fieldRow('Expiry', c.expMonth ? `${String(c.expMonth).padStart(2, '0')}/${c.expYear}` : '', { key: `${id}:card:expiry` })}
        ${fieldRow('Security code (CVV)', c.cvv, { key: `${id}:card:cvv`, secret: true, mono: true, copyLabel: 'CVV copied' })}
        ${fieldRow('PIN', c.pin, { key: `${id}:card:pin`, secret: true, mono: true, copyLabel: 'PIN copied' })}
      </div>`;
  }
  if (it.type === 'identity') {
    const d = it.identity;
    const addr = [d.address1, d.address2, [d.city, d.region, d.postcode].filter(Boolean).join(' '), d.country].filter(Boolean).join('\n');
    body += `<div class="card fields">
      ${fieldRow('Name', [d.firstName, d.lastName].filter(Boolean).join(' '), { key: `${id}:identity:name` })}
      ${fieldRow('Email', d.email, { key: `${id}:identity:email` })}
      ${fieldRow('Phone', d.phone, { key: `${id}:identity:phone` })}
      ${fieldRow('Birthday', d.birthday, { key: `${id}:identity:birthday` })}
      ${fieldRow('Address', addr, { key: `${id}:identity:address`, multiline: true })}
    </div>`;
  }
  if (it.type === 'passkey') {
    const p = it.passkey;
    const matches = loginsForPasskey(it);
    if (matches.length) body += `<div class="merge-hint">${icon('sparkle')}<span>This passkey belongs to your <b>${esc(matches[0].name)}</b> login${matches[0].login.username ? ` (${esc(matches[0].login.username)})` : ''}.</span><button class="btn btn-primary sm" data-action="pk-merge" data-id="${esc(it.id)}" data-login="${esc(matches[0].id)}">Merge</button>${matches.length > 1 ? `<button class="btn btn-ghost sm" data-action="pk-merge-pick" data-id="${esc(it.id)}">Choose…</button>` : ''}</div>`;
    else body += `<div class="merge-hint">${icon('info')}<span>Want this with a login? Pick which one it belongs to.</span><button class="btn btn-soft sm" data-action="pk-merge-pick" data-id="${esc(it.id)}">Merge into a login…</button></div>`;
    body += `<div class="card fields">
      ${fieldRow('Website', p.rpId, { key: `${id}:passkey:rpId` })}
      ${fieldRow('Username', p.userName, { key: `${id}:passkey:userName` })}
      ${fieldRow('Display name', p.userDisplayName && p.userDisplayName !== p.userName ? p.userDisplayName : '', { key: `${id}:passkey:userDisplayName` })}
      ${fieldRow('Created', fmtDate(p.createdOn || it.createdAt, true), { key: `${id}:passkey:created` })}
      ${fieldRow('Last used', p.lastUsed ? fmtDate(p.lastUsed, true) : 'Not used yet', { key: `${id}:passkey:lastUsed` })}
    </div><p class="hint">${icon('info')}The Vault browser extension uses this passkey to sign you in to ${esc(p.rpId)} without a password, confirmed with Windows Hello. Its private key never leaves your vault. Deleting it here does not remove it from the website's list. Remove it in the site's security settings too.</p>`;
  }
  if (it.type === 'securitykey') {
    const k = it.securitykey;
    body += `<div class="card fields">
      ${fieldRow('Model', k.model, { key: `${id}:securitykey:model` })}
      ${fieldRow('Serial number', k.serial, { key: `${id}:securitykey:serial`, mono: true })}
      ${fieldRow('Role', k.isBackup ? 'Backup key — keep somewhere safe' : 'Everyday key', { key: `${id}:securitykey:role` })}
      ${fieldRow('Added', k.addedOn ? fmtDate(k.addedOn) : '', { key: `${id}:securitykey:addedOn` })}
      ${fieldRow('Registered with', k.usedFor, { key: `${id}:securitykey:usedFor`, multiline: true })}
    </div>`;
  }
  if (it.notes) body += `<div class="card"><div class="card-head"><h3>${icon('note')}${it.type === 'note' ? 'Note' : 'Notes'}</h3><button class="icon-btn" data-action="copy-text" data-text="${esc(it.notes)}" title="Copy">${icon('copy')}</button></div><div class="note-body">${esc(it.notes)}</div></div>`;
  const fields = (it.fields || []).filter((f) => f.label || f.value);
  if (fields.length) body += `<div class="card fields"><div class="card-head"><h3>${icon('sliders')}Custom fields</h3></div>${fields.map((f, i) => fieldRow(f.label || 'Field', f.value, { key: `${id}:fields:${i}:value`, secret: f.hidden, mono: f.hidden })).join('')}</div>`;
  if ((it.attachments || []).length) body += `<div class="card"><div class="card-head"><h3>${icon('clip')}Attachments</h3></div>${it.attachments.map((a) => `
    <div class="field"><div class="field-main"><div class="value">${esc(a.name)} <span class="muted small">${(a.size / 1024).toFixed(a.size > 1048576 ? 0 : 1)} KB</span></div></div>
    <div class="field-actions"><button class="icon-btn" data-action="save-attach" data-id="${esc(id)}" data-aid="${esc(a.id)}" title="Save to disk">${icon('download')}</button></div></div>`).join('')}</div>`;
  const hist = it.login?.passwordHistory || [];
  if (hist.length) body += `<details class="card hist"><summary class="card-head"><h3>${icon('history')}Password history (${hist.length})</h3>${icon('chevronDown')}</summary>${hist.map((h, i) => fieldRow(`Used until ${fmtDate(h.changedAt)}`, h.password, { key: `${id}:login:passwordHistory:${i}:password`, secret: true, mono: true, copyLabel: 'Old password copied' })).join('')}</details>`;
  return `<div class="detail">${detailHead(it)}${body}
    <div class="meta">Created ${esc(fmtDate(it.createdAt, true))} · Updated ${esc(timeAgo(it.updatedAt))}${it.login?.passwordChangedAt ? ` · Password changed ${esc(timeAgo(it.login.passwordChangedAt))}` : ''}</div></div>`;
}

export function prettyHotkey(acc) {
  return String(acc || '').replace(/CommandOrControl|Control/g, 'Ctrl').replace(/\+/g, ' + ');
}

// ---------------------------------------------------------------- editor
function getPath(obj, path) { return path.split('.').reduce((o, k) => o?.[k], obj); }
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) { if (o[k] === undefined || o[k] === null) o[k] = /^\d+$/.test(k) ? [] : {}; o = o[k]; }
  o[keys[keys.length - 1]] = value;
}

function inp(label, path, { type = 'text', placeholder = '', mono = false, attrs = '', hint = '', after = '', cls = '' } = {}) {
  const v = getPath(S.editing, path) ?? '';
  return `<div class="fld ${cls}"><label>${esc(label)}</label><div class="input-wrap">
    <input type="${type}" data-bind="${path}" value="${esc(v)}" placeholder="${esc(placeholder)}" class="${mono ? 'mono' : ''}" spellcheck="false" autocomplete="off" ${attrs}>${after}</div>${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
}
function area(label, path, { placeholder = '', rows = 4 } = {}) {
  return `<div class="fld"><label>${esc(label)}</label><div class="input-wrap"><textarea data-bind="${path}" rows="${rows}" placeholder="${esc(placeholder)}">${esc(getPath(S.editing, path) ?? '')}</textarea></div></div>`;
}

function renderEditor(host) {
  const d = S.editing;
  const isNew = !byId(d.id);
  const t = TYPES[d.type];
  let form = `<div class="editor-identity">
      <div class="icon-edit">${avatar(d, 'xl')}<div class="icon-edit-actions">
        ${d.type === 'login' && S.platform !== 'ios' ? `<button type="button" class="btn btn-ghost xs" data-action="icon-refresh" title="Get the icon from the website">${icon('refresh')}Website icon</button>` : ''}
        <button type="button" class="btn btn-ghost xs" data-action="icon-pick">${icon('image')}Custom</button>
        ${d.icon ? `<button type="button" class="btn btn-ghost xs" data-action="icon-clear">${icon('x')}Remove</button>` : ''}
      </div></div>
      <div class="grow">${inp('Name', 'name', { placeholder: d.type === 'login' ? 'e.g. Discord' : t.label, attrs: 'autofocus required' })}</div>
    </div>`;

  if (d.type === 'login') {
    const pw = d.login.password || '';
    const st = estimateStrength(pw);
    form += `<div class="card form-card">
      ${inp('Username or email', 'login.username', { placeholder: 'you@example.com' })}
      <div class="fld"><label>Password</label><div class="input-wrap">
        <input type="${reveal.has('edit:pw') ? 'text' : 'password'}" data-bind="login.password" value="${esc(pw)}" class="mono" spellcheck="false" autocomplete="new-password" id="pwInput">
        <button type="button" class="icon-btn" data-action="edit-reveal" title="Show / hide">${icon(reveal.has('edit:pw') ? 'eyeOff' : 'eye')}</button>
        <button type="button" class="icon-btn accent" data-action="edit-generate" title="Generate a strong password">${icon('sparkle')}</button>
      </div><div id="pwStrength">${pw ? strengthBar(st.score, st.label, `cracking ≈ ${st.crackTime}`) : ''}</div></div>
      <div class="fld"><label>Websites</label>${(d.login.urls?.length ? d.login.urls : ['']).map((u, i) => `
        <div class="input-wrap url-row"><input data-bind="login.urls.${i}" value="${esc(u)}" placeholder="discord.com" spellcheck="false" data-url-input>
          ${i > 0 ? `<button type="button" class="icon-btn" data-action="url-remove" data-i="${i}" title="Remove">${icon('x')}</button>` : ''}</div>`).join('')}
        <button type="button" class="btn btn-soft xs url-add" data-action="url-add">${icon('plus')}Add another website</button>
        <p class="hint">Add every site this account signs in to (e.g. <span class="mono">roblox.com</span> and <span class="mono">create.roblox.com</span>). Autofill works on all of them, and the icon comes from the first.</p></div>
    </div>
    <div class="card form-card" data-otp-host>
      <div class="card-head"><h3>${icon('otp')}Two-factor authentication (2FA)</h3></div>
      ${d.login.totp ? `<div class="otp-preview"><div><div class="otp-code mono big" data-otp="draft:edit">••• •••</div><span class="muted small">${esc(d.login.totp.issuer || '')} ${esc(d.login.totp.account || '')} · ${d.login.totp.type === 'steam' ? 'Steam Guard' : `${d.login.totp.digits} digits · ${d.login.totp.period}s`}</span></div>${d.login.totp.type === 'hotp' ? '' : ring()}
          <button type="button" class="btn btn-ghost sm" data-action="edit-2fa">${icon('refresh')}Replace</button><button type="button" class="btn btn-ghost sm danger" data-action="edit-2fa-remove">${icon('trash')}Remove</button></div>`
        : `<p class="card-text">Store this account's authenticator codes here instead of on your phone.</p><button type="button" class="btn btn-soft" data-action="edit-2fa">${icon('qr')}Set up 2FA code</button>`}
    </div>`;
    if (S.autotypeSupported) {
      form += `<details class="card form-card adv" ${d.login.autotype?.match || d.login.autotype?.sequence ? 'open' : ''}><summary class="card-head"><h3>${icon('keyboard')}Auto-type for desktop apps</h3>${icon('chevronDown')}</summary>
        <label class="switch-row"><span>Allow auto-type for this login</span><input type="checkbox" class="switch" data-bind="login.autotype.enabled" ${d.login.autotype?.enabled !== false ? 'checked' : ''}></label>
        ${inp('Match window title or app name', 'login.autotype.match', { placeholder: 'Leave empty to match by name / website, e.g. “Battle.net”', hint: 'Comma-separated. Matches the app window title or process name (like <span class="mono">Battle.net</span>, <span class="mono">steamwebhelper</span>, <span class="mono">Discord</span>, <span class="mono">RobloxPlayerBeta</span>).' })}
        ${inp('Key sequence', 'login.autotype.sequence', { placeholder: S.settings.autotypeSequence, mono: true, hint: 'Tokens: {USERNAME} {PASSWORD} {TOTP} {TAB} {ENTER} {DELAY 500}. Leave empty for the default.' })}
      </details>`;
    }
  }
  if (d.type === 'card') {
    form += `<div class="card form-card">
      ${inp('Cardholder name', 'card.holder')}
      ${inp('Card number', 'card.number', { mono: true, placeholder: '1234 5678 9012 3456', attrs: 'inputmode="numeric"' })}
      <div class="opt-grid three">${inp('Expiry month', 'card.expMonth', { placeholder: 'MM', attrs: 'inputmode="numeric" maxlength="2"' })}${inp('Expiry year', 'card.expYear', { placeholder: 'YYYY', attrs: 'inputmode="numeric" maxlength="4"' })}${inp('CVV', 'card.cvv', { type: 'password', mono: true, attrs: 'maxlength="4"' })}</div>
      ${inp('PIN', 'card.pin', { type: 'password', mono: true, attrs: 'maxlength="12"' })}
    </div>`;
  }
  if (d.type === 'identity') {
    form += `<div class="card form-card">
      <div class="opt-grid">${inp('First name', 'identity.firstName')}${inp('Last name', 'identity.lastName')}</div>
      <div class="opt-grid">${inp('Email', 'identity.email', { type: 'email' })}${inp('Phone', 'identity.phone', { type: 'tel' })}</div>
      ${inp('Birthday', 'identity.birthday', { type: 'date' })}
      ${inp('Address line 1', 'identity.address1')}${inp('Address line 2', 'identity.address2')}
      <div class="opt-grid three">${inp('City', 'identity.city')}${inp('Region', 'identity.region')}${inp('Postcode', 'identity.postcode')}</div>
      ${inp('Country', 'identity.country')}
    </div>`;
  }
  if (d.type === 'securitykey') {
    form += `<div class="card form-card">
      <div class="opt-grid">${inp('Model', 'securitykey.model', { placeholder: 'e.g. YubiKey 5C NFC' })}${inp('Serial number', 'securitykey.serial', { mono: true })}</div>
      ${inp('Date added', 'securitykey.addedOn', { type: 'date' })}
      <label class="switch-row"><span>This is a backup key</span><input type="checkbox" class="switch" data-bind="securitykey.isBackup" ${d.securitykey.isBackup ? 'checked' : ''}></label>
      ${area('Registered with', 'securitykey.usedFor', { placeholder: 'Google, Microsoft, Discord, Roblox…', rows: 3 })}
      <p class="hint">${icon('info')}Hardware keys keep their secrets on the device itself — this entry helps you remember which accounts each key protects.</p>
    </div>`;
  }
  form += `<div class="card form-card">${area(d.type === 'note' ? 'Note' : 'Notes', 'notes', { rows: d.type === 'note' ? 12 : 4, placeholder: d.type === 'note' ? 'Recovery codes, Wi-Fi passwords, licence keys…' : 'Anything else worth remembering (e.g. backup codes)' })}</div>`;
  form += `<div class="card form-card"><div class="card-head"><h3>${icon('sliders')}Custom fields</h3><button type="button" class="link sm" data-action="field-add">${icon('plus')}Add field</button></div>
    ${(d.fields || []).map((f, i) => `<div class="cf-row">
      <div class="input-wrap"><input data-bind="fields.${i}.label" value="${esc(f.label)}" placeholder="Label"></div>
      <div class="input-wrap grow"><input data-bind="fields.${i}.value" value="${esc(f.value)}" type="${f.hidden ? 'password' : 'text'}" placeholder="Value" class="${f.hidden ? 'mono' : ''}"></div>
      <button type="button" class="icon-btn ${f.hidden ? 'on' : ''}" data-action="field-hide" data-i="${i}" title="${f.hidden ? 'Hidden field' : 'Make hidden'}">${icon(f.hidden ? 'eyeOff' : 'eye')}</button>
      <button type="button" class="icon-btn" data-action="field-remove" data-i="${i}" title="Remove">${icon('x')}</button></div>`).join('') || '<p class="hint">Extra details like security questions, PINs or account numbers.</p>'}
  </div>
  <div class="card form-card"><div class="card-head"><h3>${icon('clip')}Attachments</h3><button type="button" class="link sm" data-action="attach-add">${icon('plus')}Add file</button></div>
    ${(d.attachments || []).map((a, i) => `<div class="field"><div class="field-main"><div class="value">${esc(a.name)} <span class="muted small">${Math.ceil(a.size / 1024)} KB</span></div></div><div class="field-actions"><button type="button" class="icon-btn" data-action="attach-remove" data-i="${i}">${icon('x')}</button></div></div>`).join('') || '<p class="hint">Files are encrypted inside your vault (up to 10 MB each).</p>'}
  </div>`;

  host.innerHTML = `<form class="editor detail" autocomplete="off" novalidate>
    <div class="editor-head">
      <button type="button" class="icon-btn back" data-action="edit-cancel" title="Back">${icon('chevronLeft')}</button>
      <h2>${isNew ? `New ${t.label.toLowerCase()}` : `Edit ${esc(d.name || t.label.toLowerCase())}`}</h2>
      <div class="grow"></div>
      <button type="button" class="btn btn-ghost" data-action="edit-cancel">Cancel</button>
      <button type="button" class="btn btn-primary" data-action="edit-save">${icon('check')}Save</button>
    </div>
    ${form}
  </form>`;
  if (d.login?.totp) { draftOtps.set('draft:edit', d.login.totp); tickOtp(); }
  bindEditor(host);
}

function bindEditor(host) {
  const form = host.querySelector('form');
  form.addEventListener('input', (e) => {
    const path = e.target.dataset.bind;
    if (!path) return;
    setPath(S.editing, path, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
    if (path === 'login.password') {
      const st = estimateStrength(e.target.value);
      $('#pwStrength').innerHTML = e.target.value ? strengthBar(st.score, st.label, `cracking ≈ ${st.crackTime}`) : '';
    }
    if (path === 'name' && !S.editing.icon) host.querySelector('.icon-edit .avatar').outerHTML = avatar(S.editing, 'xl');
  });
  form.addEventListener('focusout', (e) => {
    if (e.target.matches('[data-url-input]') && e.target.dataset.bind === 'login.urls.0') maybeFetchDraftIcon();
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); saveEdit(); }
  });
}

async function maybeFetchDraftIcon(force = false) {
  const d = S.editing;
  if (!d || d.type !== 'login') return;
  const url = (d.login.urls || []).find(Boolean);
  const dom = domainOf(url || '');
  if (!dom) { if (force) toast('Add a website first', { type: 'error' }); return; }
  if (!force && (!S.settings.fetchIcons || d.iconCustom || d.iconDomain === dom)) return;
  if (!d.name) { d.name = dom.split('.').slice(-2, -1)[0].replace(/^./, (c) => c.toUpperCase()); const n = $('[data-bind=name]'); if (n) n.value = d.name; }
  const host = $('.icon-edit .avatar');
  host?.classList.add('loading');
  const r = await window.kh.icons.fetch(url);
  if (S.editing !== d) return;
  if (r.error) { host?.classList.remove('loading'); if (force) toast(`Couldn't get an icon from ${dom}`, { type: 'error' }); d.iconDomain = dom; return; }
  d.icon = r.dataUrl; d.iconDomain = dom; d.iconCustom = false;
  renderDetail();
}

export function startEdit(idOrType) {
  const existing = byId(idOrType);
  S.editing = existing ? structuredClone(existing) : newItem(TYPES[idOrType] ? idOrType : 'login');
  if (S.editing.type === 'login') {
    S.editing.login.autotype ||= { enabled: true, match: '', sequence: '' };
    if (!S.editing.login.urls?.length) S.editing.login.urls = [''];
  }
  S.editing.fields ||= [];
  S.editing.attachments ||= [];
  reveal.delete('edit:pw');
  emit('detail');
}

export async function saveEdit() {
  const d = structuredClone(S.editing);
  if (!d) return;
  if (d.type === 'login') {
    d.login.urls = (d.login.urls || []).map((u) => u.trim()).filter(Boolean);
    if (!d.name.trim()) d.name = domainOf(d.login.urls[0] || '') || d.login.username || '';
    const prev = byId(d.id);
    const oldPw = prev?.login?.password;
    if (prev && oldPw && oldPw !== d.login.password) {
      d.login.passwordHistory = [{ password: oldPw, changedAt: new Date().toISOString() }, ...(d.login.passwordHistory || [])].slice(0, 20);
      d.login.passwordChangedAt = new Date().toISOString();
      delete d.login.breach;
    }
    if (!prev && d.login.password) d.login.passwordChangedAt = new Date().toISOString();
  }
  if (d.type === 'card') d.card.number = String(d.card.number || '').replace(/[^\d]/g, '');
  d.fields = (d.fields || []).filter((f) => f.label || f.value);
  if (!d.name.trim()) { toast('Give this item a name', { type: 'error' }); $('[data-bind=name]')?.focus(); return; }
  try {
    await saveItems([d]);
  } catch (e) { toast('Could not save: ' + e.message, { type: 'error', timeout: 5000 }); return; }
  draftOtps.delete('draft:edit');
  S.editing = null;
  S.selectedId = d.id;
  toast('Saved', { type: 'success' });
  emit('view');
  if (d.type === 'login' && S.settings.fetchIcons && !d.iconCustom) {
    const dom = domainOf(d.login.urls[0] || '');
    if (dom && d.iconDomain !== dom) fetchIconsFor([d.id]);
  }
}

export function cancelEdit() {
  draftOtps.delete('draft:edit');
  const wasNew = S.editing && !byId(S.editing.id);
  S.editing = null;
  if (wasNew) S.selectedId = S.selectedId && byId(S.selectedId) ? S.selectedId : null;
  emit('detail');
}

/** Fetch website icons in the background (3 at a time) and save them. */
export async function fetchIconsFor(ids, { force = false } = {}) {
  const queue = [...ids];
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      const it = byId(id);
      if (!it || it.type !== 'login' || (it.iconCustom && !force)) continue;
      const url = (it.login.urls || []).find(Boolean);
      const dom = domainOf(url || '');
      if (!dom || (!force && it.iconDomain === dom)) continue;
      const r = await window.kh.icons.fetch(url);
      const fresh = byId(id);
      if (!fresh) continue;
      const upd = structuredClone(fresh);
      upd.iconDomain = dom;
      if (!r.error) { upd.icon = r.dataUrl; upd.iconCustom = false; done++; }
      try { await saveItems([upd]); } catch { /* ignore */ }
      emit('icons');
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return done;
}

// ---------------------------------------------------------------- actions
export const vaultActions = {
  'select': (el) => { if (S.editing) cancelEdit(); S.selectedId = el.dataset.id; emit('select'); },
  'back': () => { S.selectedId = null; emit('select'); },
  'new': (el) => { S.selectedId = null; startEdit(el.dataset.type || 'login'); },
  'new-menu': (el) => popMenu(el, Object.entries(TYPES).filter(([k]) => k !== 'passkey').map(([k, t]) => ({ label: t.label, icon: t.icon, run: () => { S.selectedId = null; startEdit(k); } }))),
  'sort-menu': (el) => popMenu(el, [['name', 'Name (A–Z)'], ['updated', 'Recently updated'], ['created', 'Recently added']].map(([v, l]) => ({ label: l, icon: S.settings.listSort === v ? 'check' : null, run: () => window.__setSort(v) }))),
  'edit': (el) => startEdit(el.dataset.id),
  'edit-cancel': () => cancelEdit(),
  'edit-save': () => saveEdit(),
  'fav': async (el) => { const it = structuredClone(byId(el.dataset.id)); it.favorite = !it.favorite; await saveItems([it]); emit('view'); },
  'delete': async (el) => {
    const it = byId(el.dataset.id);
    const ok = await confirmDialog('Delete item?', `“${esc(it.name)}” will be permanently deleted. A copy remains in your automatic backups until they rotate out.`, { confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await deleteItems([it.id]);
    toast('Deleted');
    emit('view');
  },
  'reveal': (el) => { const k = el.dataset.key; reveal.has(k) ? reveal.delete(k) : reveal.add(k); renderDetail(); },
  'copy-field': (el) => {
    const it = byId(el.dataset.key.split(':')[0]);
    let v = fieldValue(it, el.dataset.key);
    if (el.dataset.key.endsWith(':card:expiry')) v = `${String(it.card.expMonth).padStart(2, '0')}/${it.card.expYear}`;
    if (el.dataset.key.endsWith(':identity:name')) v = [it.identity.firstName, it.identity.lastName].filter(Boolean).join(' ');
    if (v === undefined || v === null) v = el.closest('.field')?.querySelector('.value')?.innerText;
    const sensitive = /password|cvv|pin|number|fields/.test(el.dataset.key);
    copy(v, el.dataset.label, sensitive);
  },
  'copy-text': (el) => copy(el.dataset.text, 'Copied', false),
  'open-url': (el) => { const u = el.dataset.url; window.kh.app.openExternal(/^https?:\/\//i.test(u) ? u : 'https://' + u); },
  'copy-otp': (el) => copyOtp(byId(el.dataset.id)),
  'hotp-next': (el) => hotpNext(byId(el.dataset.id)),
  'otp-qr': (el) => showOtpQr(byId(el.dataset.id)),
  'attach-2fa': async (el) => {
    const it = byId(el.dataset.id);
    const otp = await add2faFlow({ forDraft: true, suggestName: it.name });
    if (!otp) return;
    const upd = structuredClone(it);
    upd.login.totp = { ...otp, issuer: otp.issuer || it.name, account: otp.account || it.login.username };
    await saveItems([upd]);
    toast('2FA code saved', { type: 'success' });
    emit('detail');
  },
  'autotype': async (el) => {
    const r = await window.kh.autotype.perform(el.dataset.id, null);
    if (r?.error) toast(r.message, { type: 'error', timeout: 5000 });
  },
  'pk-merge': async (el) => {
    await mergePasskeyInto(byId(el.dataset.id), byId(el.dataset.login));
    S.selectedId = el.dataset.login; toast('Passkey merged into the login', { type: 'success' }); emit('view');
  },
  'pk-merge-pick': async (el) => {
    const pk = byId(el.dataset.id);
    const sugg = loginsForPasskey(pk);
    const rest = items().filter((i) => i.type === 'login' && !sugg.includes(i)).sort((a, b) => a.name.localeCompare(b.name));
    const pick = await modal({
      title: 'Merge passkey into a login',
      body: `<p class="modal-text">Passkey for <b>${esc(pk.passkey.rpId)}</b>${pk.passkey.userName ? ` (${esc(pk.passkey.userName)})` : ''}. Choose the login it belongs to:</p>
        <div class="chooser-list">${[...sugg, ...rest].map((l) => `<button type="button" class="row" data-pick="${esc(l.id)}">${avatar(l)}<span class="row-text"><span class="row-title">${esc(l.name)}${sugg.includes(l) ? ' <span class="tag">Suggested</span>' : ''}</span><span class="row-sub">${esc(l.login.username || '')}</span></span></button>`).join('') || '<p class="muted">No logins yet.</p>'}</div>`,
      actions: [{ label: 'Cancel', value: null, kind: 'ghost' }],
      onMount: (m, close) => m.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) close(b.dataset.pick); })
    });
    if (!pick) return;
    await mergePasskeyInto(pk, byId(pick));
    S.selectedId = pick; toast('Passkey merged into the login', { type: 'success' }); emit('view');
  },
  'pk-separate': async (el) => {
    const it = await separatePasskey(el.dataset.id, el.dataset.cred);
    if (it) { toast('Passkey moved to its own item'); emit('view'); }
  },
  'pk-remove': async (el) => {
    const ok = await confirmDialog('Delete this passkey?', 'You won\'t be able to sign in with it any more. Also remove it from the website\'s security settings, and make sure you have another way to sign in.', { confirmLabel: 'Delete passkey', danger: true });
    if (!ok) return;
    await removeEmbeddedPasskey(el.dataset.id, el.dataset.cred); toast('Passkey deleted'); emit('detail');
  },
  'save-attach': async (el) => {
    const a = byId(el.dataset.id).attachments.find((x) => x.id === el.dataset.aid);
    const r = await window.kh.files.saveAttachment(a);
    if (r.ok) toast('Saved to ' + r.filePath, { type: 'success' });
  },
  // editor
  'edit-reveal': () => { reveal.has('edit:pw') ? reveal.delete('edit:pw') : reveal.add('edit:pw'); const i = $('#pwInput'); if (i) { i.type = reveal.has('edit:pw') ? 'text' : 'password'; } },
  'edit-generate': async () => {
    const v = await generatorPopover();
    if (!v) return;
    S.editing.login.password = v;
    reveal.add('edit:pw');
    renderDetail();
  },
  'edit-2fa': async () => {
    const otp = await add2faFlow({ forDraft: true, suggestName: S.editing.name });
    if (!otp) return;
    S.editing.login.totp = { ...otp, issuer: otp.issuer || S.editing.name, account: otp.account || S.editing.login.username };
    if (!S.editing.name && otp.issuer) S.editing.name = otp.issuer;
    if (!S.editing.login.username && otp.account) S.editing.login.username = otp.account;
    renderDetail();
  },
  'edit-2fa-remove': async () => {
    if (!(await confirmDialog('Remove 2FA code?', 'Make sure you have another way to sign in (or have turned off 2FA on the website) before removing it.', { confirmLabel: 'Remove', danger: true }))) return;
    S.editing.login.totp = null; renderDetail();
  },
  'url-add': () => { S.editing.login.urls.push(''); renderDetail(); $$last('[data-url-input]')?.focus(); },
  'url-remove': (el) => { S.editing.login.urls.splice(Number(el.dataset.i), 1); renderDetail(); },
  'field-add': () => { S.editing.fields.push({ label: '', value: '', hidden: false }); renderDetail(); },
  'field-remove': (el) => { S.editing.fields.splice(Number(el.dataset.i), 1); renderDetail(); },
  'field-hide': (el) => { const f = S.editing.fields[Number(el.dataset.i)]; f.hidden = !f.hidden; renderDetail(); },
  'attach-add': async () => {
    const r = await window.kh.files.pickAttachments();
    if (r.error) return toast(r.message, { type: 'error' });
    if (r.canceled) return;
    S.editing.attachments.push(...r.files); renderDetail();
  },
  'attach-remove': (el) => { S.editing.attachments.splice(Number(el.dataset.i), 1); renderDetail(); },
  'icon-refresh': () => maybeFetchDraftIcon(true),
  'icon-pick': async () => { const r = await window.kh.icons.pick(); if (r.ok) { S.editing.icon = r.dataUrl; S.editing.iconCustom = true; renderDetail(); } else if (r.error) toast(r.message, { type: 'error' }); },
  'icon-clear': () => { S.editing.icon = null; S.editing.iconCustom = true; renderDetail(); }
};

function $$last(sel) { const all = document.querySelectorAll(sel); return all[all.length - 1]; }

export function popMenu(anchor, entries) {
  document.querySelector('.pop-menu')?.remove();
  const m = document.createElement('div');
  m.className = 'pop-menu';
  m.innerHTML = entries.map((e, i) => `<button data-i="${i}">${e.icon ? icon(e.icon) : '<span class="ic"></span>'}${esc(e.label)}</button>`).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth;
  m.style.top = `${r.bottom + 6}px`;
  m.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
  const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off, true); } };
  setTimeout(() => document.addEventListener('mousedown', off, true));
  m.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (!b) return; m.remove(); document.removeEventListener('mousedown', off, true); entries[Number(b.dataset.i)].run(); });
}

/** Auto-type chooser shown when the global hotkey matched zero or several logins. */
export async function autotypeChooser({ window: w, suggestions }) {
  const logins = items().filter((i) => i.type === 'login');
  const sugg = suggestions.map(byId).filter(Boolean);
  const render = (q) => {
    const ql = q.toLowerCase();
    const list = q ? logins.filter((l) => (l.name + ' ' + l.login.username + ' ' + (l.login.urls || []).join(' ')).toLowerCase().includes(ql)) : (sugg.length ? sugg : logins);
    return list.slice(0, 50).map((it) => `<button type="button" class="row" data-pick="${esc(it.id)}">${avatar(it)}<span class="row-text"><span class="row-title">${esc(it.name)}</span><span class="row-sub">${esc(it.login.username || '')}</span></span></button>`).join('') || '<p class="muted center">No logins match.</p>';
  };
  const picked = await modal({
    title: 'Auto-type into…',
    body: `<p class="modal-text">Window: <b>${esc(w.title || w.process)}</b> <span class="muted">(${esc(w.process)})</span></p>
      <div class="input-wrap search-in">${icon('search')}<input name="q" placeholder="Search logins" autofocus></div>
      <div class="chooser-list">${render('')}</div>
      <p class="hint">${sugg.length ? 'Showing the best matches.' : 'No login matched this window automatically.'} Tip: set “Match window title” on a login to make this instant next time.</p>`,
    actions: [{ label: 'Cancel', value: null, kind: 'ghost' }],
    onMount: (el, close) => {
      el.querySelector('[name=q]').addEventListener('input', (e) => { el.querySelector('.chooser-list').innerHTML = render(e.target.value); });
      el.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) close(b.dataset.pick); });
      el.querySelector('[name=q]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = el.querySelector('[data-pick]'); if (b) { e.preventDefault(); close(b.dataset.pick); } } });
    }
  });
  if (!picked) { window.kh.autotype.cancel(); return; }
  const r = await window.kh.autotype.perform(picked, 'pending');
  if (r?.error) toast(r.message, { type: 'error', timeout: 5000 });
}

export { isNarrow };
