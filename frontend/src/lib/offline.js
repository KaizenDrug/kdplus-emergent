// Offline-first helpers for the POS: catalog cache + local sale queue with sync.
const CACHE_KEY = "kdplus_pos_cache_v1";
const QUEUE_KEY = "kdplus_pos_queue_v1";

export function getCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
}
export function saveCache(partial) {
  const merged = { ...getCache(), ...partial, _ts: Date.now() };
  localStorage.setItem(CACHE_KEY, JSON.stringify(merged));
}

export function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { return []; }
}
function setQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }

export function enqueueSale(body, preview) {
  const q = getQueue();
  q.push({ id: body.client_txn_id, body, preview, queued_at: Date.now() });
  setQueue(q);
  return q.length;
}

export function queueCount() { return getQueue().length; }

// Posts each queued sale. Server dedupes on client_txn_id so re-posting is safe.
export async function syncQueue(api) {
  const q = getQueue();
  if (!q.length) return { synced: 0, failed: 0, pending: 0 };
  let synced = 0, failed = 0;
  const remaining = [];
  for (const item of q) {
    try {
      await api.post("/pos/sales", item.body);
      synced++;
    } catch (e) {
      // Never silently discard a sale. Validation and stock conflicts need a
      // cashier/manager to resolve them while preserving the original payload.
      failed++;
      remaining.push({
        ...item,
        last_error: e.response?.data?.detail || e.message || "Sync failed",
        last_attempt_at: Date.now(),
      });
    }
  }
  setQueue(remaining);
  return { synced, failed, pending: remaining.length };
}
