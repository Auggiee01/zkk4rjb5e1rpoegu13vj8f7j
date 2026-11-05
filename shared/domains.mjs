// Website matching helpers for the UI (same rules as src/main/domains.js).
const TWO_LEVEL = new Set(('co.uk org.uk ac.uk gov.uk co.nz org.nz net.nz govt.nz ac.nz school.nz geek.nz kiwi.nz com.au net.au org.au edu.au gov.au ' +
  'co.jp ne.jp or.jp com.br com.mx com.cn com.hk com.sg com.tw com.tr co.za co.in co.kr com.ar com.co com.my com.ph co.id co.il co.th github.io netlify.app vercel.app pages.dev web.app').split(' '));
export function hostOf(url) {
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : 'https://' + url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}
export function registrable(host) {
  const parts = String(host || '').toLowerCase().split('.');
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  return TWO_LEVEL.has(last2) ? parts.slice(-3).join('.') : last2;
}
/** Sites a login belongs to (registrable domains), falling back to its name when it has no website. */
export function sitesOf(item) {
  const urls = (item.login?.urls || []).filter(Boolean).map(hostOf).filter(Boolean);
  if (urls.length) return new Set(urls.map(registrable));
  const n = String(item.name || item.login?.totp?.issuer || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return new Set(n ? ['name:' + n] : []);
}
export function siteKeyForRp(rpId) { return registrable(String(rpId || '').toLowerCase()); }
