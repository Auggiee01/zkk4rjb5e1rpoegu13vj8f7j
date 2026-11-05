import { newItem } from './store.mjs';
import { domainOf } from './ui.mjs';
import { parseOtpAuth } from '../shared/totp.mjs';

/** RFC 4180 CSV parser (handles quotes, escaped quotes, CRLF and newlines inside quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const SYN = {
  name: ['name', 'title', 'item name', 'account', 'item'],
  url: ['url', 'login_uri', 'website', 'uri', 'web site', 'login url', 'urls', 'site'],
  username: ['username', 'login_username', 'user', 'user name', 'email', 'login', 'e-mail', 'username/email'],
  password: ['password', 'login_password', 'pass', 'pwd'],
  totp: ['totp', 'login_totp', 'otpauth', 'otp', 'one-time password', '2fa', 'otp secret', 'authenticator key'],
  notes: ['notes', 'note', 'extra', 'comments', 'comment'],
  favorite: ['favorite', 'fav', 'favourite'],
  type: ['type'],
  folder: ['folder', 'grouping', 'group', 'vault', 'collection']
};

/**
 * Convert a CSV export (Chrome, Edge, Firefox, Bitwarden, 1Password, LastPass, Proton Pass, Aura, Vault, generic)
 * into Vault items. Returns { items, skipped, format }.
 */
export function itemsFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('This CSV file has no data rows');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = {};
  for (const [k, names] of Object.entries(SYN)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) col[k] = i;
  }
  if (col.password === undefined && col.username === undefined) throw new Error('Could not find username or password columns in this CSV');
  const format = header.includes('login_uri') ? 'Bitwarden' : header.includes('httprealm') ? 'Firefox' : header.includes('otpauth') ? '1Password' : header.includes('grouping') ? 'LastPass' : header.join(',') === 'name,url,username,password,note' ? 'Chrome / Edge' : 'CSV';
  const items = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const get = (k) => (col[k] !== undefined ? (r[col[k]] ?? '').trim() : '');
    const type = get('type').toLowerCase();
    if (type && !['login', 'note', 'securenote', 'secure note', 'password', ''].includes(type)) { skipped++; continue; }
    const isNote = ['note', 'securenote', 'secure note'].includes(type) || (!get('password') && !get('username') && get('notes'));
    const it = newItem(isNote ? 'note' : 'login');
    const urls = get('url').split(/[\s,]+/).filter((u) => u && u !== 'http://' && u !== 'https://' && !/^android:/.test(u));
    it.name = get('name') || domainOf(urls[0] || '') || get('username') || 'Imported item';
    it.notes = get('notes');
    it.favorite = ['1', 'true', 'yes', 'x'].includes(get('favorite').toLowerCase());
    if (get('folder')) it.fields.push({ label: 'Folder', value: get('folder'), hidden: false });
    if (!isNote) {
      it.login.username = get('username');
      it.login.password = get('password');
      it.login.urls = urls.length ? urls : [];
      it.login.passwordChangedAt = new Date().toISOString();
      const totp = get('totp');
      if (totp) {
        try { it.login.totp = { ...parseOtpAuth(totp) }; it.login.totp.issuer ||= it.name; it.login.totp.account ||= it.login.username; }
        catch { it.fields.push({ label: 'TOTP (could not read)', value: totp, hidden: true }); }
      }
      if (!it.login.username && !it.login.password && !urls.length) { skipped++; continue; }
    }
    items.push(it);
  }
  return { items, skipped, format };
}

/** Remove items that already exist (same type, name/username/password). */
export function dedupe(incoming, existing) {
  const key = (i) => [i.type, (i.name || '').toLowerCase(), i.login?.username || '', i.login?.password || '', i.notes || ''].join('\u0001');
  const have = new Set(existing.map(key));
  const out = [];
  for (const i of incoming) { const k = key(i); if (!have.has(k)) { have.add(k); out.push(i); } }
  return { items: out, duplicates: incoming.length - out.length };
}
