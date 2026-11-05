import { S, setSettings, setMeta, wordlist } from './store.mjs';
import { icon } from './icons.mjs';
import { esc, copy, colorizePassword, strengthBar, modal, timeAgo, toast } from './ui.mjs';
import { DEFAULT_PASSWORD_OPTIONS, generatePassword, generatePassphrase, generatePin, generatorEntropy, crackTime, SETS } from '../shared/generator.mjs';

const opts = () => ({ ...DEFAULT_PASSWORD_OPTIONS, ...(S.settings.generator || {}) });

function scoreFromBits(bits) { return bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4; }
const LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];

async function make(o) {
  if (o.mode === 'passphrase') return generatePassphrase(await wordlist(), o);
  if (o.mode === 'pin') return generatePin(o.pinLength);
  return generatePassword(o);
}

function toggle(name, label, sample, checked) {
  return `<label class="chip-toggle ${checked ? 'on' : ''}"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span class="chip-sample">${esc(sample)}</span><span>${esc(label)}</span></label>`;
}

function optionsHtml(o) {
  const mode = `<div class="seg" role="tablist">
    ${[['password', 'Password'], ['passphrase', 'Passphrase'], ['pin', 'PIN']].map(([v, l]) => `<button type="button" class="${o.mode === v ? 'on' : ''}" data-mode="${v}">${l}</button>`).join('')}
  </div>`;
  if (o.mode === 'passphrase') {
    return `${mode}
      <div class="opt-row"><label>Words</label><input type="range" name="words" min="3" max="12" value="${o.words}"><output>${o.words}</output></div>
      <div class="opt-grid">
        <div class="fld"><label>Separator</label><div class="input-wrap"><input name="separator" value="${esc(o.separator)}" maxlength="3"></div></div>
        <label class="switch-row"><span>Capitalise words</span><input type="checkbox" class="switch" name="capitalize" ${o.capitalize ? 'checked' : ''}></label>
        <label class="switch-row"><span>Include a number</span><input type="checkbox" class="switch" name="includeNumber" ${o.includeNumber ? 'checked' : ''}></label>
      </div>
      <p class="hint">Words come from the EFF long wordlist (7,776 words), so each word adds about 12.9 bits.</p>`;
  }
  if (o.mode === 'pin') {
    return `${mode}<div class="opt-row"><label>Digits</label><input type="range" name="pinLength" min="4" max="12" value="${o.pinLength}"><output>${o.pinLength}</output></div>`;
  }
  return `${mode}
    <div class="opt-row"><label>Length</label><input type="range" name="length" min="4" max="128" value="${o.length}"><input type="number" class="num" name="lengthNum" min="4" max="256" value="${o.length}"></div>
    <div class="chip-toggles">
      ${toggle('upper', 'Uppercase', 'ABC', o.upper)}${toggle('lower', 'Lowercase', 'abc', o.lower)}${toggle('digits', 'Numbers', '123', o.digits)}${toggle('symbols', 'Symbols', '!@#', o.symbols)}
    </div>
    <div class="opt-grid">
      <label class="switch-row"><span>Avoid look-alike characters <small>(I l 1 O 0 o)</small></span><input type="checkbox" class="switch" name="avoidAmbiguous" ${o.avoidAmbiguous ? 'checked' : ''}></label>
      <label class="switch-row"><span>At least one of each selected type</span><input type="checkbox" class="switch" name="requireEach" ${o.requireEach ? 'checked' : ''}></label>
    </div>
    <details class="adv" ${o.symbolSet !== SETS.symbols || o.exclude ? 'open' : ''}><summary>${icon('chevronRight')}Advanced</summary>
      <div class="opt-grid">
        <div class="fld"><label>Symbols to use</label><div class="input-wrap"><input name="symbolSet" class="mono" value="${esc(o.symbolSet)}" spellcheck="false"></div><p class="hint">Some sites only allow certain symbols. Edit this list to match.</p></div>
        <div class="fld"><label>Never use these characters</label><div class="input-wrap"><input name="exclude" class="mono" value="${esc(o.exclude)}" spellcheck="false" placeholder="e.g. &quot;'\\"></div></div>
      </div>
    </details>`;
}

/**
 * Mount a generator into a container.
 *  compact: popover version used by the item editor (adds “Use password”)
 */
export function mountGenerator(root, { compact = false, onUse } = {}) {
  let o = opts();
  let current = '';

  root.innerHTML = `
    <div class="gen ${compact ? 'compact' : ''}">
      <div class="gen-out card">
        <div class="gen-text mono" id="genText" aria-live="polite"></div>
        <div class="gen-actions">
          <button type="button" class="icon-btn lg" data-g="regen" title="Generate another (Space)">${icon('refresh')}</button>
          <button type="button" class="btn btn-primary" data-g="copy">${icon('copy')}Copy</button>
          ${compact ? `<button type="button" class="btn btn-accent" data-g="use">${icon('check')}Use this</button>` : ''}
        </div>
        <div class="gen-strength"></div>
      </div>
      <div class="gen-opts card"></div>
      ${compact ? '' : `<div class="card gen-history"><div class="card-head"><h3>${icon('history')}Recently generated</h3><button type="button" class="btn btn-ghost sm" data-g="clear">Clear</button></div><div class="hist-list"></div><p class="hint">History is stored inside your encrypted vault and keeps the last 25 passwords.</p></div>`}
    </div>`;
  const form = root.querySelector('.gen-opts');
  const out = root.querySelector('#genText');

  const persist = debounceSave();
  async function regen(record = false) {
    try { current = await make(o); } catch (e) { current = ''; out.innerHTML = `<span class="muted">${esc(e.message)}</span>`; root.querySelector('.gen-strength').innerHTML = ''; return; }
    out.innerHTML = colorizePassword(current);
    out.classList.toggle('long', current.length > 40);
    const bits = generatorEntropy(o, 7776);
    const score = scoreFromBits(bits);
    root.querySelector('.gen-strength').innerHTML = strengthBar(score, LABELS[score], `${Math.round(bits)} bits · cracking would take ${crackTime(bits)}`);
    if (record) addHistory(current);
  }
  function renderOpts() { form.innerHTML = optionsHtml(o); }

  form.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.name) return;
    if (t.type === 'checkbox') { o[t.name] = t.checked; t.closest('.chip-toggle')?.classList.toggle('on', t.checked); }
    else if (t.name === 'lengthNum') { o.length = Math.max(4, Math.min(256, Number(t.value) || 4)); form.querySelector('[name=length]').value = Math.min(128, o.length); }
    else if (t.type === 'range') { o[t.name] = Number(t.value); const n = t.parentElement.querySelector('output, .num'); if (n) n.value = t.value; if (n) n.textContent = t.value; }
    else o[t.name] = t.value;
    persist(o);
    regen();
  });
  root.addEventListener('click', async (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) { o.mode = m.dataset.mode; renderOpts(); persist(o); regen(); return; }
    const b = e.target.closest('[data-g]');
    if (!b) return;
    if (b.dataset.g === 'regen') regen();
    if (b.dataset.g === 'copy') { await copy(current, 'Password copied'); addHistory(current); }
    if (b.dataset.g === 'use') { addHistory(current); onUse?.(current); }
    if (b.dataset.g === 'clear') { await setMeta('generatorHistory', []); renderHistory(); }
    if (b.dataset.g === 'hcopy') copy(b.dataset.v, 'Password copied');
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === ' ' && !['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(e.target.tagName)) { e.preventDefault(); regen(); }
  });

  function renderHistory() {
    const host = root.querySelector('.hist-list');
    if (!host) return;
    const h = S.data?.generatorHistory || [];
    host.innerHTML = h.length ? h.map((x) => `<div class="hist-row"><span class="mono">${colorizePassword(x.value)}</span><small>${esc(timeAgo(x.at))}</small><button type="button" class="icon-btn" data-g="hcopy" data-v="${esc(x.value)}" title="Copy">${icon('copy')}</button></div>`).join('')
      : `<p class="muted empty-small">Passwords you copy or use will appear here.</p>`;
  }
  async function addHistory(value) {
    if (!value || !S.data) return;
    const h = (S.data.generatorHistory || []).filter((x) => x.value !== value);
    h.unshift({ value, at: new Date().toISOString() });
    try { await setMeta('generatorHistory', h.slice(0, 25)); } catch { /* ignore */ }
    renderHistory();
  }

  renderOpts();
  renderHistory();
  regen();
  return { get value() { return current; } };
}

function debounceSave() {
  let t;
  return (o) => { clearTimeout(t); t = setTimeout(() => setSettings({ generator: { ...o } }).catch(() => {}), 400); };
}

export function renderGeneratorPage(main) {
  main.innerHTML = `<div class="page narrow">
    <div class="page-head"><div><h1>Password generator</h1><p class="sub">Strong, random passwords made on this device with your system's secure random number generator.</p></div></div>
    <div id="genMount"></div>
  </div>`;
  mountGenerator(main.querySelector('#genMount'));
}

export function generatorPopover() {
  return modal({
    title: 'Generate a password', wide: true, actions: [],
    body: '<div id="genPop"></div>',
    onMount: (el, close) => mountGenerator(el.querySelector('#genPop'), { compact: true, onUse: (v) => { toast('Password inserted', { type: 'success' }); close(v); } })
  });
}
