// Tidy up: merge passkeys into their logins, and merge duplicate logins.
import { items, saveItems, deleteItems, byId, emit, S } from './store.mjs';
import { icon } from './icons.mjs';
import { esc, avatar, modal, toast } from './ui.mjs';
import { sitesOf, siteKeyForRp } from '../shared/domains.mjs';

const lc = (s) => String(s || '').trim().toLowerCase();

/** Logins that a passkey item belongs to, best match first. */
export function loginsForPasskey(pkItem) {
  const site = siteKeyForRp(pkItem.passkey.rpId);
  const label = site.split('.')[0];
  const logins = items().filter((i) => i.type === 'login').filter((l) => { const s = sitesOf(l); return s.has(site) || s.has('name:' + label); });
  const u = lc(pkItem.passkey.userName);
  return logins.sort((a, b) => (lc(b.login.username) === u) - (lc(a.login.username) === u));
}

export function findSuggestions() {
  const passkeys = [];
  for (const p of items().filter((i) => i.type === 'passkey')) {
    const ls = loginsForPasskey(p);
    const u = lc(p.passkey.userName);
    const match = ls.find((l) => u && lc(l.login.username) === u) || (ls.length === 1 ? ls[0] : null);
    if (match) passkeys.push({ passkey: p, login: match });
  }
  const groups = new Map();
  for (const l of items().filter((i) => i.type === 'login')) {
    const user = lc(l.login.username);
    if (!user) continue;
    for (const site of sitesOf(l)) {
      const key = site + '\u0001' + user;
      if (!groups.has(key)) groups.set(key, []);
      if (!groups.get(key).includes(l)) groups.get(key).push(l);
    }
  }
  const seen = new Set();
  const duplicates = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const key = g.map((x) => x.id).sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    duplicates.push(g);
  }
  return { passkeys, duplicates, count: passkeys.length + duplicates.length };
}

const newest = (a, b) => String(b.login.passwordChangedAt || b.updatedAt || '').localeCompare(String(a.login.passwordChangedAt || a.updatedAt || ''));

/** Merge several logins for the same account into one. The most recently changed password wins. */
export function mergeLoginsData(group) {
  const sorted = [...group].sort(newest);
  const base = structuredClone(sorted[0]);
  const L = base.login;
  for (const o of sorted.slice(1)) {
    const ol = o.login;
    L.urls = [...new Set([...(L.urls || []).filter(Boolean), ...(ol.urls || []).filter(Boolean)])];
    L.totp ||= ol.totp;
    if (ol.password && ol.password !== L.password && !(L.passwordHistory || []).some((h) => h.password === ol.password)) {
      L.passwordHistory = [...(L.passwordHistory || []), { password: ol.password, changedAt: ol.passwordChangedAt || o.updatedAt || new Date().toISOString() }];
    }
    L.passwordHistory = [...(L.passwordHistory || []), ...(ol.passwordHistory || [])].filter((h, i, a) => h.password !== L.password && a.findIndex((x) => x.password === h.password) === i).slice(0, 30);
    L.passkeys = [...(L.passkeys || []), ...(ol.passkeys || [])];
    if (o.notes && o.notes !== base.notes) base.notes = [base.notes, o.notes].filter(Boolean).join('\n\n');
    base.fields = [...(base.fields || []), ...(o.fields || []).filter((f) => !(base.fields || []).some((x) => x.label === f.label && x.value === f.value))];
    base.attachments = [...(base.attachments || []), ...(o.attachments || [])];
    base.favorite = base.favorite || o.favorite;
    if (!base.icon && o.icon) { base.icon = o.icon; base.iconDomain = o.iconDomain; }
    if (!L.autotype?.match && ol.autotype?.match) L.autotype = ol.autotype;
  }
  return { merged: base, removeIds: sorted.slice(1).map((x) => x.id) };
}

export async function mergePasskeyInto(pkItem, login) {
  const upd = structuredClone(byId(login.id));
  upd.login.passkeys = [...(upd.login.passkeys || []), pkItem.passkey];
  if (!upd.icon && pkItem.icon) upd.icon = pkItem.icon;
  if (pkItem.notes) upd.notes = [upd.notes, pkItem.notes].filter(Boolean).join('\n\n');
  await saveItems([upd]);
  await deleteItems([pkItem.id]);
}

export async function separatePasskey(loginId, credentialId) {
  const login = structuredClone(byId(loginId));
  const pk = (login.login.passkeys || []).find((p) => p.credentialId === credentialId);
  if (!pk) return;
  login.login.passkeys = login.login.passkeys.filter((p) => p.credentialId !== credentialId);
  const item = { id: crypto.randomUUID(), type: 'passkey', name: login.name, favorite: false, notes: '', icon: login.icon || null, fields: [], attachments: [], passkey: pk };
  await saveItems([login, item]);
  return item;
}

export async function removeEmbeddedPasskey(loginId, credentialId) {
  const login = structuredClone(byId(loginId));
  login.login.passkeys = (login.login.passkeys || []).filter((p) => p.credentialId !== credentialId);
  await saveItems([login]);
}

/** The Tidy up dialog. */
export async function tidyDialog() {
  const s = findSuggestions();
  if (!s.count) { toast('Everything is tidy: no passkeys or duplicate logins to merge', { type: 'success' }); return; }
  const rowPk = (x, i) => `<label class="tidy-row"><input type="checkbox" name="pk${i}" checked>
      <span class="tidy-pair">${avatar(x.passkey, 'sm')}<span class="tidy-text"><b>Passkey ${esc(x.passkey.passkey.userName || '')}</b><small>${esc(x.passkey.passkey.rpId)}</small></span>
      ${icon('chevronRight')}${avatar(x.login, 'sm')}<span class="tidy-text"><b>${esc(x.login.name)}</b><small>${esc(x.login.login.username || 'No username')}</small></span></span></label>`;
  const rowDup = (g, i) => `<label class="tidy-row"><input type="checkbox" name="dup${i}" checked>
      <span class="tidy-pair">${avatar(g[0], 'sm')}<span class="tidy-text"><b>${g.length} logins: ${esc(g.map((x) => x.name).filter((v, j, a) => a.indexOf(v) === j).join(', '))}</b><small>${esc(g[0].login.username)} · the newest password is kept, older ones go into password history</small></span></span></label>`;
  const res = await modal({
    title: 'Tidy up your vault', wide: true,
    body: `<p class="modal-text">Vault found items that belong to the same account. Merging keeps everything: passwords, 2FA codes, passkeys, notes and websites end up in one item.</p>
      ${s.passkeys.length ? `<h4 class="tidy-h">${icon('passkey')}Passkeys to add to their logins</h4>${s.passkeys.map(rowPk).join('')}` : ''}
      ${s.duplicates.length ? `<h4 class="tidy-h">${icon('copy')}Duplicate logins</h4>${s.duplicates.map(rowDup).join('')}` : ''}`,
    actions: [{ label: 'Cancel', value: null, kind: 'ghost' }, {
      label: 'Merge selected', kind: 'primary', submit: true,
      value: (el) => ({ pk: s.passkeys.filter((_, i) => el.querySelector(`[name=pk${i}]`).checked), dup: s.duplicates.filter((_, i) => el.querySelector(`[name=dup${i}]`).checked) })
    }]
  });
  if (!res) return;
  let n = 0;
  for (const g of res.dup) {
    const fresh = g.map((x) => byId(x.id)).filter(Boolean);
    if (fresh.length < 2) continue;
    const { merged, removeIds } = mergeLoginsData(fresh);
    await saveItems([merged]);
    await deleteItems(removeIds);
    n++;
  }
  for (const x of res.pk) {
    const pk = byId(x.passkey.id);
    const target = byId(x.login.id) || loginsForPasskey(pk)[0];
    if (pk && target) { await mergePasskeyInto(pk, target); n++; }
  }
  if (S.selectedId && !byId(S.selectedId)) S.selectedId = null;
  toast(`Merged ${n} ${n === 1 ? 'item' : 'items'}`, { type: 'success' });
  emit('view');
}
