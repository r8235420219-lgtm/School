// viewer.js — PDF/image viewer + reading-time tracking + per-file AI chat box.
import { api, state, $, el, toast } from './api.js';

// pdf.js worker (UMD global from the CDN script tag in index.html)
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const HEARTBEAT_MS = 15000;

// ── Active-viewing state ──
let current = null;         // the asset being viewed
let activeSeconds = 0;      // accumulated ACTIVE seconds (tab visible)
let lastTick = 0;           // timestamp of last accrual
let totalPages = 1;
const pagesSeen = new Set();
let heartbeatTimer = null;
let tickTimer = null;
let reportedComplete = false;

// ─────────────── OPEN / CLOSE ───────────────
export async function openViewer(asset) {
  current = asset;
  activeSeconds = 0;
  pagesSeen.clear();
  totalPages = 1;
  reportedComplete = false;
  lastTick = performance.now();

  const v = $('#viewer');
  v.hidden = false;
  $('#viewer-title').textContent = asset.name;
  $('#pdf-container').innerHTML = '';
  $('#image-view').hidden = true;
  $('#viewer-loading').hidden = false;

  resetAiPanel();

  if (asset.type === 'pdf') await renderPdf(asset);
  else renderImage(asset);

  startTracking();
}

function closeViewer() {
  stopTracking();
  flushHeartbeat(true);
  $('#viewer').hidden = true;
  $('#ai-panel').hidden = true;
  current = null;
}

// ─────────────── PDF RENDER ───────────────
async function renderPdf(asset) {
  const container = $('#pdf-container');
  try {
    const task = window.pdfjsLib.getDocument(asset.url);
    const pdf = await task.promise;
    totalPages = pdf.numPages;
    $('#viewer-loading').hidden = true;

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const p = Number(e.target.dataset.page);
          if (p) { pagesSeen.add(p); maybeComplete(); }
        }
      }
    }, { threshold: 0.5 });

    for (let n = 1; n <= totalPages; n++) {
      const page = await pdf.getPage(n);
      const scale = Math.min(2, (container.clientWidth || 360) / page.getViewport({ scale: 1 }).width);
      const viewport = page.getViewport({ scale: Math.max(scale, 1) });
      const canvas = el('canvas', 'pdf-page');
      canvas.dataset.page = String(n);
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
      container.append(canvas);
      io.observe(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
  } catch (err) {
    $('#viewer-loading').hidden = true;
    container.innerHTML = `<div class="empty"><div class="empty-emoji">⚠️</div><p>Couldn't render this PDF.</p></div>`;
    console.error('[viewer] pdf render failed', err);
  }
}

function renderImage(asset) {
  totalPages = 1;
  pagesSeen.add(1);
  const img = $('#image-view');
  img.src = asset.url;
  img.hidden = false;
  img.onload = () => { $('#viewer-loading').hidden = true; };
  img.onerror = () => {
    $('#viewer-loading').hidden = true;
    toast("Couldn't load this image.");
  };
}

// ─────────────── READING-TIME TRACKING ───────────────
// Only accrue time while the tab is visible; use timestamp deltas (not tick counting).
function startTracking() {
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  lastTick = performance.now();
  tickTimer = setInterval(accrue, 1000);
  heartbeatTimer = setInterval(() => flushHeartbeat(false), HEARTBEAT_MS);
}

function stopTracking() {
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('pagehide', onPageHide);
  clearInterval(tickTimer); tickTimer = null;
  clearInterval(heartbeatTimer); heartbeatTimer = null;
}

function accrue() {
  if (document.visibilityState !== 'visible') { lastTick = performance.now(); return; }
  const now = performance.now();
  activeSeconds += (now - lastTick) / 1000;
  lastTick = now;
}

function onVisibility() {
  if (document.visibilityState === 'hidden') {
    accrue();               // bank the time up to now
    flushHeartbeat(false);  // report before we might get killed
  } else {
    lastTick = performance.now(); // resume without counting the hidden gap
  }
}

function onPageHide() { accrue(); flushHeartbeat(true); }

function maybeComplete() {
  // Fire a heartbeat as soon as the last page becomes visible so completion is timely.
  if (!reportedComplete && pagesSeen.size >= totalPages) flushHeartbeat(false);
}

function flushHeartbeat(useBeacon) {
  if (!current) return;
  accrue();
  const payload = {
    assetId: current.id,
    seconds: Math.round(activeSeconds),
    pagesSeen: pagesSeen.size,
    totalPages,
  };
  if (useBeacon && navigator.sendBeacon) {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    navigator.sendBeacon('/api/reading/heartbeat', blob);
  } else {
    api.heartbeat(payload).then((res) => {
      if (res && res.ok && res.completed && !reportedComplete) {
        reportedComplete = true;
        toast('✅ Marked as read!');
      }
    }).catch(() => {});
  }
}

// ─────────────── AI CHAT BOX (per file) ───────────────
let aiStreaming = false;
let aiCurrentBubble = null;

function resetAiPanel() {
  $('#ai-messages').innerHTML = '<div class="ai-hint">Ask anything about this file and I\'ll help using its contents.</div>';
  aiStreaming = false;
  aiCurrentBubble = null;
}

function toggleAiPanel(show) {
  const panel = $('#ai-panel');
  panel.hidden = show === undefined ? !panel.hidden : !show;
  if (!panel.hidden) $('#ai-input').focus();
}

async function askAi(question) {
  if (aiStreaming) return;
  const box = $('#ai-messages');
  const hint = box.querySelector('.ai-hint');
  if (hint) hint.remove();

  box.append(bubble('user', question));
  aiCurrentBubble = bubble('bot thinking', '…');
  box.append(aiCurrentBubble);
  box.scrollTop = box.scrollHeight;
  aiStreaming = true;
  setAiSending(true);

  try {
    await api.askAi(current.id, question);
    // Answer arrives via Socket.IO events wired in initAiSocket().
  } catch (err) {
    aiCurrentBubble.classList.remove('thinking');
    aiCurrentBubble.textContent = `⚠️ ${err.message || 'AI request failed.'}`;
    aiStreaming = false;
    setAiSending(false);
    aiCurrentBubble = null;
  }
}

function bubble(kind, text) {
  const b = el('div', `ai-msg ${kind}`);
  b.textContent = text;
  return b;
}

function setAiSending(sending) {
  const btn = $('#ai-send');
  btn.disabled = sending;
  $('#ai-input').disabled = sending;
}

// Socket.IO streaming — the server emits to this user's private room.
export function initAiSocket() {
  if (!state.socket) return;
  state.socket.on('ai:token', ({ token }) => {
    if (!aiCurrentBubble) return;
    if (aiCurrentBubble.classList.contains('thinking')) {
      aiCurrentBubble.classList.remove('thinking');
      aiCurrentBubble.textContent = '';
    }
    aiCurrentBubble.textContent += token;
    $('#ai-messages').scrollTop = $('#ai-messages').scrollHeight;
  });
  state.socket.on('ai:done', ({ answer }) => {
    if (aiCurrentBubble) {
      aiCurrentBubble.classList.remove('thinking');
      if (answer) aiCurrentBubble.textContent = answer;
    }
    aiStreaming = false; aiCurrentBubble = null; setAiSending(false);
  });
  state.socket.on('ai:error', ({ error }) => {
    if (aiCurrentBubble) {
      aiCurrentBubble.classList.remove('thinking');
      aiCurrentBubble.textContent = `⚠️ ${error || 'Something went wrong.'}`;
    }
    aiStreaming = false; aiCurrentBubble = null; setAiSending(false);
  });
}

// ─────────────── WIRE UP ───────────────
// viewer.js is an ES module in an import chain, so it may execute AFTER
// DOMContentLoaded has already fired. Run wiring immediately if the DOM is
// ready, otherwise wait for the event — either way the buttons get listeners.
function wireViewer() {
  $('#viewer-close').addEventListener('click', closeViewer);
  $('#viewer-ai-toggle').addEventListener('click', () => toggleAiPanel());
  $('#ai-close').addEventListener('click', () => toggleAiPanel(false));
  $('#ai-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#ai-input');
    const q = input.value.trim();
    if (q.length < 2) return;
    input.value = '';
    askAi(q);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireViewer);
} else {
  wireViewer();
}

// Attach AI socket listeners once the socket exists (poll briefly after login).
const socketWait = setInterval(() => {
  if (state.socket) { initAiSocket(); clearInterval(socketWait); }
}, 300);
