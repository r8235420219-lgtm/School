// app.js — entry point: auth gate, navigation, subject/chapter browsing.
import { api, state, $, el, toast } from './api.js';
import { openViewer } from './viewer.js';
import { initChat, teardownChat } from './chat.js';

// ── Navigation stack for the browse view (subjects → subcats → chapters) ──
let browseStack = []; // [{ node }] path of nodes we've descended into
let currentChapter = null;
let currentTab = 'mcq';

// Inline SVG icons — reliable on every Android WebView, unlike emoji which
// render as "tofu" boxes on some builds (esp. 🖼️ with its variation selector).
const SVG = {
  subject: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  subcategory: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  chapter: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>',
  image: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
};

// ─────────────── BOOT ───────────────
// ES modules in an import chain can evaluate after DOMContentLoaded has already
// fired, in which case a DOMContentLoaded listener never runs and the shell
// (back button, logout, nav, tabs) is left unwired. Guard on readyState so the
// wiring happens either way.
async function boot() {
  registerSW();
  wireLogin();
  wireShell();
  try {
    const { user } = await api.me();
    if (user) { state.user = user; enterApp(); }
    else showLogin();
  } catch {
    showLogin();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

function showLogin() {
  $('#view-login').classList.add('is-active');
  $('#app-shell').hidden = true;
}

function enterApp() {
  $('#view-login').classList.remove('is-active');
  $('#app-shell').hidden = false;
  if (state.user.role === 'admin') $('#nav-admin').hidden = false;
  connectSocket();
  initChat();
  loadTree();
}

// ─────────────── LOGIN ───────────────
function wireLogin() {
  const form = $('#login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#login-name').value.trim();
    const code = $('#login-code').value.trim();
    const errEl = $('#login-error');
    const btn = $('#login-submit');
    errEl.textContent = '';
    if (!name || !code) { errEl.textContent = 'Please fill in both fields.'; return; }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      const { user } = await api.login(name, code);
      state.user = user;
      enterApp();
    } catch (err) {
      errEl.textContent = err.message || 'Login failed.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enter class';
    }
  });
}

// ─────────────── SOCKET ───────────────
function connectSocket() {
  if (state.socket) return;
  // eslint-disable-next-line no-undef
  state.socket = io({ withCredentials: true });
  state.socket.on('connect_error', () => toast('Chat connection lost. Retrying…'));
}

// ─────────────── SHELL / NAV ───────────────
function wireShell() {
  $('#logout-btn').addEventListener('click', async () => {
    try { await api.logout(); } catch {}
    if (state.socket) { state.socket.disconnect(); state.socket = null; }
    teardownChat();
    state.user = null;
    location.reload();
  });

  $('#back-btn').addEventListener('click', () => {
    if (currentChapter) { closeChapter(); return; }
    if (browseStack.length > 0) { browseStack.pop(); renderBrowse(); }
  });

  // Bottom nav
  document.querySelectorAll('.tabbar-btn').forEach((b) => {
    b.addEventListener('click', () => switchNav(b.dataset.nav));
  });

  // Chapter tabs
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('is-active'));
      t.classList.add('is-active');
      currentTab = t.dataset.tab;
      loadAssets();
    });
  });
}

function switchNav(nav) {
  document.querySelectorAll('.tabbar-btn').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.nav === nav));

  if (nav === 'admin') { location.href = '/admin.html'; return; }

  const showBrowse = nav === 'browse';
  // Reset chapter view when leaving browse.
  if (!showBrowse) closeChapter(true);

  $('#view-browse').classList.toggle('is-active', showBrowse);
  $('#view-chapter').classList.remove('is-active');
  $('#view-chat').classList.toggle('is-active', nav === 'chat');

  if (showBrowse) { renderBrowse(); }
  else if (nav === 'chat') { setTopbar('Class chat', false); }
}

function setTopbar(title, showBack) {
  $('#topbar-title').textContent = title;
  $('#back-btn').hidden = !showBack;
}

// ─────────────── TREE / BROWSE ───────────────
async function loadTree() {
  try {
    const { tree } = await api.tree();
    state.tree = tree;
    renderBrowse();
  } catch (err) {
    toast(err.message || 'Could not load subjects.');
  }
}

function currentLevelNodes() {
  if (browseStack.length === 0) return state.tree;
  return browseStack[browseStack.length - 1].children || [];
}

function renderBrowse() {
  currentChapter = null;
  $('#view-browse').classList.add('is-active');
  $('#view-chapter').classList.remove('is-active');
  $('#view-chat').classList.remove('is-active');

  const list = $('#node-list');
  list.innerHTML = '';
  const nodes = currentLevelNodes();

  // Breadcrumb + topbar
  const crumb = $('#crumb');
  if (browseStack.length > 0) {
    crumb.hidden = false;
    crumb.innerHTML = '';
    crumb.append(document.createTextNode('📍 '));
    browseStack.forEach((entry, i) => {
      const b = el('b', null, entry.name);
      crumb.append(b);
      if (i < browseStack.length - 1) crumb.append(document.createTextNode(' › '));
    });
    setTopbar(browseStack[browseStack.length - 1].name, true);
  } else {
    crumb.hidden = true;
    setTopbar('Subjects', false);
  }

  if (!nodes || nodes.length === 0) {
    $('#browse-empty').hidden = false;
    return;
  }
  $('#browse-empty').hidden = true;

  for (const node of nodes) {
    const card = el('div', 'node-card');
    const ico = el('div', 'node-ico');
    ico.innerHTML = SVG[node.kind] || SVG.chapter;
    const body = el('div', 'node-body');
    body.append(el('div', 'node-name', node.name));

    if (node.kind === 'chapter') {
      const meta = el('div', 'node-meta');
      const c = node.counts || { mcq: 0, qa: 0 };
      meta.innerHTML = `<span class="badge">${c.mcq} MCQ</span><span class="badge">${c.qa} Q&amp;A</span>`;
      body.append(meta);
    } else {
      const n = (node.children || []).length;
      body.append(el('div', 'node-meta', `${n} item${n === 1 ? '' : 's'}`));
    }

    card.append(ico, body, el('div', 'node-chev', '›'));
    card.addEventListener('click', () => {
      if (node.kind === 'chapter') openChapter(node);
      else { browseStack.push(node); renderBrowse(); }
    });
    list.append(card);
  }
}

// ─────────────── CHAPTER (MCQ/QA) ───────────────
function openChapter(node) {
  currentChapter = node;
  currentTab = 'mcq';
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === 'mcq'));
  $('#view-browse').classList.remove('is-active');
  $('#view-chapter').classList.add('is-active');
  setTopbar(node.name, true);
  loadAssets();
}

function closeChapter(silent) {
  if (!currentChapter) return;
  currentChapter = null;
  $('#view-chapter').classList.remove('is-active');
  if (!silent) renderBrowse();
}

async function loadAssets() {
  if (!currentChapter) return;
  const listEl = $('#asset-list');
  listEl.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
  try {
    const { assets } = await api.chapterAssets(currentChapter.id, currentTab);
    listEl.innerHTML = '';
    if (!assets.length) {
      $('#chapter-empty').hidden = false;
      $('#chapter-empty-text').textContent =
        currentTab === 'mcq' ? 'No MCQ files here yet.' : 'No Q&A files here yet.';
      return;
    }
    $('#chapter-empty').hidden = true;
    for (const a of assets) {
      const card = el('div', 'asset-card');
      const ico = el('div', 'asset-ico');
      ico.innerHTML = a.type === 'pdf' ? SVG.pdf : SVG.image;
      card.append(ico);
      const body = el('div', 'node-body');
      body.append(el('div', 'asset-name', a.name));
      body.append(el('div', 'asset-type', a.type));
      card.append(body);
      card.addEventListener('click', () => openViewer(a));
      listEl.append(card);
    }
  } catch (err) {
    listEl.innerHTML = '';
    $('#chapter-empty').hidden = false;
    $('#chapter-empty-text').textContent = err.message || 'Could not load files.';
  }
}

// ─────────────── PWA SERVICE WORKER ───────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}
