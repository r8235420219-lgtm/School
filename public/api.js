// api.js — thin fetch wrapper around the JSON backend + shared app state.

export const state = {
  user: null,        // { id, name, role }
  socket: null,      // Socket.IO connection
  tree: [],          // cached subject tree
};

async function req(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = (data && data.error) || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  login: (name, classCode) =>
    req('/api/login', { method: 'POST', body: JSON.stringify({ name, classCode }) }),
  me: () => req('/api/me'),
  logout: () => req('/api/logout', { method: 'POST' }),
  tree: () => req('/api/tree'),
  chapterAssets: (chapterId, tab) =>
    req(`/api/chapter/${chapterId}/assets?tab=${encodeURIComponent(tab)}`),
  askAi: (assetId, question) =>
    req('/api/ai/ask', { method: 'POST', body: JSON.stringify({ assetId, question }) }),
  // Reading heartbeat. keepalive lets a final beat survive a backgrounding/unload.
  heartbeat: (payload) =>
    fetch('/api/reading/heartbeat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {}),
};

// ── tiny UI helpers ──
export function $(sel, root = document) { return root.querySelector(sel); }
export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
