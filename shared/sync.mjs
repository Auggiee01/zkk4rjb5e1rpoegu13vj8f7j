/**
 * Merging two copies of a vault (PC <-> iPhone). Per item, the most recently updated copy wins.
 * Deletions are remembered as tombstones so a deleted item doesn't come back from the other device.
 */
const ts = (x) => String(x || '');
const TOMBSTONE_DAYS = 365;

export function mergePayloads(local, remote) {
  const deleted = { ...(local.deleted || {}) };
  for (const [id, t] of Object.entries(remote.deleted || {})) if (!deleted[id] || ts(deleted[id]) < ts(t)) deleted[id] = t;

  const byId = new Map();
  const order = [];
  for (const it of local.items || []) { byId.set(it.id, it); order.push(it.id); }
  let added = 0, updated = 0, removed = 0;
  for (const it of remote.items || []) {
    const cur = byId.get(it.id);
    if (!cur) { byId.set(it.id, it); order.push(it.id); added++; }
    else if (ts(it.updatedAt) > ts(cur.updatedAt)) { byId.set(it.id, it); updated++; }
  }
  const items = [];
  for (const id of order) {
    const it = byId.get(id);
    if (deleted[id] && ts(deleted[id]) >= ts(it.updatedAt)) { if ((local.items || []).some((x) => x.id === id)) removed++; else added--; continue; }
    items.push(it);
  }
  const cutoff = new Date(Date.now() - TOMBSTONE_DAYS * 86400000).toISOString();
  for (const [id, t] of Object.entries(deleted)) if (ts(t) < cutoff) delete deleted[id];

  const hist = new Map();
  for (const h of [...(local.generatorHistory || []), ...(remote.generatorHistory || [])]) if (!hist.has(h.value)) hist.set(h.value, h);
  const generatorHistory = [...hist.values()].sort((a, b) => ts(b.at).localeCompare(ts(a.at))).slice(0, 25);

  const merged = { ...local, items, deleted, generatorHistory, meta: { ...(remote.meta || {}), ...(local.meta || {}) } };
  return { merged, added: Math.max(0, added), updated, removed, changed: added > 0 || updated > 0 || removed > 0 };
}
