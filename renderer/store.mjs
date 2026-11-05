import { domainOf } from './ui.mjs';

export const S = {
  status: 'loading',
  settings: {},
  data: null,
  view: 'all',
  selectedId: null,
  editing: null,       // draft item while editing / creating
  search: '',
  platform: 'win32',
  version: '',
  kdf: '',
  vaultPath: '',
  autotypeSupported: false,
  theme: 'dark',
  hello: { supported: false, enabled: false },
  helloStatus: null
};

export const TYPES = {
  login: { label: 'Login', plural: 'Logins', icon: 'globe' },
  card: { label: 'Card', plural: 'Payment cards', icon: 'card' },
  note: { label: 'Secure note', plural: 'Secure notes', icon: 'note' },
  identity: { label: 'Identity', plural: 'Identities', icon: 'user' },
  passkey: { label: 'Passkey', plural: 'Passkeys', icon: 'passkey' },
  securitykey: { label: 'Security key', plural: 'Security keys', icon: 'usbkey' }
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(what) { for (const fn of listeners) fn(what); }

export const uid = () => crypto.randomUUID();
export const items = () => S.data?.items || [];
export const byId = (id) => items().find((i) => i.id === id);

function unwrap(r) {
  if (r && r.error) { const e = new Error(r.message || r.error); e.code = r.error; throw e; }
  return r;
}

export async function saveItems(list) {
  const r = unwrap(await window.kh.vault.upsert(list));
  S.data.items = r.items;
  emit('items');
  return r.items;
}

export async function deleteItems(ids) {
  unwrap(await window.kh.vault.remove(ids));
  const set = new Set(ids);
  S.data.items = S.data.items.filter((i) => !set.has(i.id));
  if (set.has(S.selectedId)) S.selectedId = null;
  emit('items');
}

export async function setMeta(key, value) {
  unwrap(await window.kh.vault.setMeta(key, value));
  if (key === 'generatorHistory') S.data.generatorHistory = value; else S.data.meta = { ...S.data.meta, [key]: value };
}

export async function setSettings(patch) {
  const r = unwrap(await window.kh.settings.set(patch));
  S.settings = r.settings;
  emit('settings');
  return r;
}

export const passkeyCount = () => items().reduce((n, i) => n + (i.type === 'passkey' ? 1 : (i.login?.passkeys || []).length), 0);

export function newItem(type = 'login') {
  const base = { id: uid(), type, name: '', favorite: false, notes: '', icon: null, fields: [], attachments: [] };
  if (type === 'login') base.login = { username: '', password: '', urls: [''], totp: null, autotype: { enabled: true, match: '', sequence: '' }, passwordHistory: [] };
  if (type === 'card') base.card = { holder: '', number: '', expMonth: '', expYear: '', cvv: '', pin: '' };
  if (type === 'identity') base.identity = { firstName: '', lastName: '', email: '', phone: '', birthday: '', address1: '', address2: '', city: '', region: '', postcode: '', country: '' };
  if (type === 'passkey') base.passkey = { rpId: '', userName: '', credentialId: '', createdOn: '' };
  if (type === 'securitykey') base.securitykey = { model: '', serial: '', usedFor: '', isBackup: false, addedOn: '' };
  return base;
}

export function cardBrand(num) {
  const n = String(num || '').replace(/\D/g, '');
  if (/^4/.test(n)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(n)) return 'Mastercard';
  if (/^3[47]/.test(n)) return 'Amex';
  if (/^6(011|5)/.test(n)) return 'Discover';
  if (/^35/.test(n)) return 'JCB';
  if (/^62/.test(n)) return 'UnionPay';
  return n ? 'Card' : '';
}

export function subtitle(item) {
  switch (item.type) {
    case 'login': return item.login?.username || domainOf(item.login?.urls?.[0] || '') || 'No username';
    case 'card': { const n = String(item.card?.number || '').replace(/\D/g, ''); return n ? `${cardBrand(n)} •••• ${n.slice(-4)}` : 'Payment card'; }
    case 'note': return (item.notes || '').split('\n')[0].slice(0, 60) || 'Empty note';
    case 'identity': return [item.identity?.firstName, item.identity?.lastName].filter(Boolean).join(' ') || item.identity?.email || 'Identity';
    case 'passkey': return item.passkey?.userName || item.passkey?.rpId || 'Passkey';
    case 'securitykey': return [item.securitykey?.model, item.securitykey?.isBackup ? 'backup key' : ''].filter(Boolean).join(' · ') || 'Hardware key';
    default: return '';
  }
}

export function searchText(item) {
  const l = item.login || {};
  return [item.name, l.username, ...(l.urls || []), item.notes, l.totp?.issuer, l.totp?.account, item.identity?.email, item.card?.holder,
    item.passkey?.rpId, item.passkey?.userName, item.securitykey?.model, ...(l.passkeys || []).flatMap((p) => [p.rpId, p.userName]), ...(item.fields || []).filter((f) => !f.hidden).map((f) => f.label + ' ' + f.value)]
    .filter(Boolean).join(' ').toLowerCase();
}

export function visibleItems() {
  let list = items();
  const v = S.view;
  if (v === 'favorites') list = list.filter((i) => i.favorite);
  else if (v === 'passkey') list = list.filter((i) => i.type === 'passkey' || (i.login?.passkeys || []).length);
  else if (TYPES[v]) list = list.filter((i) => i.type === v);
  const q = S.search.trim().toLowerCase();
  if (q) {
    const terms = q.split(/\s+/);
    list = list.filter((i) => { const t = searchText(i); return terms.every((x) => t.includes(x)); });
  }
  const sort = S.settings.listSort || 'name';
  return [...list].sort((a, b) => {
    if (sort === 'updated') return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    if (sort === 'created') return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
  });
}

export function otpItems() {
  const q = S.search.trim().toLowerCase();
  return items().filter((i) => i.login?.totp).filter((i) => !q || searchText(i).includes(q))
    .sort((a, b) => (b.favorite - a.favorite) || (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
}

let wordlistPromise = null;
export function wordlist() {
  wordlistPromise ||= fetch('../shared/eff_large_wordlist.txt').then((r) => r.text()).then((t) => t.split(/\r?\n/).map((w) => w.trim()).filter(Boolean));
  return wordlistPromise;
}
