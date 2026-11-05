import { S, items, saveItems, setSettings, emit } from './store.mjs';
import { icon } from './icons.mjs';
import { esc, avatar, toast, confirmDialog, timeAgo } from './ui.mjs';
import { estimateStrength } from '../shared/generator.mjs';

const YEAR = 365 * 86400 * 1000;

export function analyze() {
  const logins = items().filter((i) => i.type === 'login' && i.login?.password);
  const groups = new Map();
  for (const it of logins) { const k = it.login.password; groups.set(k, [...(groups.get(k) || []), it]); }
  const weak = [], reused = [], old = [], breached = [], no2fa = [];
  for (const it of logins) {
    const st = estimateStrength(it.login.password);
    if (st.score <= 2) weak.push({ it, why: st.label });
    if (groups.get(it.login.password).length > 1) reused.push({ it, why: `Same as ${groups.get(it.login.password).length - 1} other${groups.get(it.login.password).length > 2 ? 's' : ''}` });
    const changed = it.login.passwordChangedAt || it.createdAt;
    if (changed && Date.now() - new Date(changed).getTime() > YEAR) old.push({ it, why: `Last changed ${timeAgo(changed)}` });
    if (it.login.breach?.count) breached.push({ it, why: `Seen ${it.login.breach.count.toLocaleString()} times in breaches` });
    if (!it.login.totp) no2fa.push({ it, why: 'No 2FA code saved' });
  }
  const bad = new Set([...weak, ...reused, ...breached].map((x) => x.it.id));
  const oldOnly = old.filter((x) => !bad.has(x.it.id)).length;
  const score = logins.length ? Math.round(100 * (logins.length - bad.size - oldOnly * 0.25) / logins.length) : 100;
  const lastCheck = logins.map((i) => i.login.breach?.checkedAt).filter(Boolean).sort().pop();
  return { logins, weak, reused, old, breached, no2fa, score: Math.max(0, score), lastCheck };
}

let tab = 'weak';
export function renderHealthPage(main) {
  const a = analyze();
  const tiles = [
    ['breached', 'Breached', a.breached.length, 'alert', 'bad'],
    ['weak', 'Weak', a.weak.length, 'bolt', 'warn'],
    ['reused', 'Reused', a.reused.length, 'copy', 'warn'],
    ['old', 'Older than a year', a.old.length, 'history', 'info'],
    ['no2fa', 'Without 2FA', a.no2fa.length, 'otp', 'info']
  ];
  const list = a[tab] || [];
  const grade = a.score >= 90 ? 'Excellent' : a.score >= 70 ? 'Good' : a.score >= 50 ? 'Needs work' : 'At risk';
  main.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Password health</h1><p class="sub">Spot weak, reused and exposed passwords and fix them in a click.</p></div></div>
    <div class="health-top">
      <div class="card score-card">
        <div class="score-ring" style="--v:${a.score / 100}"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="sr-bg"/><circle cx="60" cy="60" r="52" class="sr-fg" pathLength="1"/></svg><div><b>${a.logins.length ? a.score : '—'}</b><span>${a.logins.length ? grade : 'No logins'}</span></div></div>
        <div class="score-text">
          <h3>Your security score</h3>
          <p>${a.logins.length} login${a.logins.length === 1 ? '' : 's'} analysed on this device.</p>
          <div class="breach-box">
            ${S.settings.breachCheck
              ? `<button class="btn btn-soft sm" data-action="breach-check">${icon('shieldCheck')}Check for breaches now</button><span class="muted small">${a.lastCheck ? 'Last checked ' + esc(timeAgo(a.lastCheck)) : 'Not checked yet'}</span>`
              : `<button class="btn btn-soft sm" data-action="breach-enable">${icon('shieldCheck')}Turn on breach checking</button><span class="muted small">Optional and private — see how it works</span>`}
          </div>
        </div>
      </div>
      <div class="tiles">${tiles.map(([k, l, n, ic, tone]) => `<button class="tile ${tab === k ? 'on' : ''} tone-${tone} ${n ? '' : 'zero'}" data-action="health-tab" data-tab="${k}">${icon(ic)}<b>${n}</b><span>${l}</span></button>`).join('')}</div>
    </div>
    <div class="card issue-list">
      ${list.length ? list.map(({ it, why }) => `<div class="issue">${avatar(it)}<div class="row-text"><span class="row-title">${esc(it.name)}</span><span class="row-sub">${esc(it.login.username || '')} · ${esc(why)}</span></div>
        <button class="btn btn-soft sm" data-action="health-fix" data-id="${esc(it.id)}" data-tab="${tab}">${tab === 'no2fa' ? `${icon('qr')}Add 2FA` : `${icon('edit')}Change`}</button></div>`).join('')
        : `<div class="empty-state">${icon('shieldCheck')}<h3>Nothing to fix here</h3><p>${tab === 'breached' && !S.settings.breachCheck ? 'Turn on breach checking to look for exposed passwords.' : 'Nice work!'}</p></div>`}
    </div>
    ${tab === 'no2fa' ? `<p class="hint">${icon('info')}Not every site supports 2FA. For those that do (Discord, Roblox, Google, Microsoft, Epic Games…), turning it on is the single best upgrade you can make.</p>` : ''}
    ${tab === 'breached' ? `<p class="hint">${icon('info')}Breach data from <b>Have I Been Pwned — Pwned Passwords</b> (CC BY 4.0). Only the first 5 characters of each password's SHA-1 hash are sent; the full password never leaves this computer.</p>` : ''}
  </div>`;
}

async function sha1Hex(s) {
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export async function runBreachCheck() {
  const logins = items().filter((i) => i.type === 'login' && i.login?.password);
  if (!logins.length) return toast('No passwords to check');
  toast(`Checking ${logins.length} passwords…`, { timeout: 2000 });
  const byHash = new Map();
  for (const it of logins) { const h = await sha1Hex(it.login.password); byHash.set(it.id, h); }
  const ranges = new Map();
  for (const h of new Set(byHash.values())) {
    const p = h.slice(0, 5);
    if (ranges.has(p)) continue;
    const r = await window.kh.hibp.range(p);
    if (r.error) { toast(r.message || 'Breach check failed — are you online?', { type: 'error', timeout: 5000 }); return; }
    const m = new Map();
    for (const line of r.text.split('\n')) { const [suf, n] = line.trim().split(':'); if (suf) m.set(suf, Number(n)); }
    ranges.set(p, m);
  }
  const now = new Date().toISOString();
  const updates = [];
  let hits = 0;
  for (const it of logins) {
    const h = byHash.get(it.id);
    const count = ranges.get(h.slice(0, 5))?.get(h.slice(5)) || 0;
    if (count) hits++;
    const upd = structuredClone(it);
    upd.login.breach = { count, checkedAt: now };
    updates.push(upd);
  }
  await saveItems(updates);
  tab = hits ? 'breached' : tab;
  toast(hits ? `${hits} password${hits === 1 ? '' : 's'} found in known breaches` : 'Good news — none of your passwords appear in known breaches', { type: hits ? 'error' : 'success', timeout: 5000 });
  emit('view');
}

export const healthActions = {
  'health-tab': (el) => { tab = el.dataset.tab; emit('view'); },
  'breach-check': () => runBreachCheck(),
  'breach-enable': async () => {
    const ok = await confirmDialog('Check passwords against known breaches?',
      `Vault can compare your passwords with the <b>Have I Been Pwned</b> list of passwords exposed in data breaches, using a privacy technique called <i>k-anonymity</i>:<br><br>
       • Your password is hashed (SHA-1) on this computer.<br>• Only the first <b>5 characters</b> of that hash are sent to api.pwnedpasswords.com.<br>• The site returns hundreds of matching hash endings and Vault checks them locally.<br><br>
       Your passwords, usernames and email addresses are never sent. You can turn this off at any time in Settings.`, { confirmLabel: 'Turn on & check' });
    if (!ok) return;
    await setSettings({ breachCheck: true });
    runBreachCheck();
  }
};
