// chat.js — global community chat over Socket.IO.
import { state, $, el, fmtTime } from './api.js';

let wired = false;
let oldestTs = null;      // for "load earlier" pagination
let handlers = null;      // keep refs so we can detach on logout

export function initChat() {
  if (!state.socket) return;

  handlers = {
    history: (msgs) => renderHistory(msgs),
    incoming: (msg) => appendMessage(msg, true),
  };

  state.socket.on('chat:history', handlers.history);
  state.socket.on('chat:new', handlers.incoming);

  // Request the most recent page once connected.
  const requestInitial = () => state.socket.emit('chat:history', {}, (msgs) => renderHistory(msgs));
  if (state.socket.connected) requestInitial();
  else state.socket.once('connect', requestInitial);

  if (!wired) wireComposer();
  wired = true;
}

export function teardownChat() {
  if (state.socket && handlers) {
    state.socket.off('chat:history', handlers.history);
    state.socket.off('chat:new', handlers.incoming);
  }
  const box = $('#chat-messages');
  if (box) box.innerHTML = '';
  oldestTs = null;
}

function wireComposer() {
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const body = input.value.trim();
    if (!body) return;
    state.socket.emit('chat:send', { body });
    input.value = '';
  });

  const loadBtn = $('#chat-loadmore').querySelector('button');
  loadBtn.addEventListener('click', () => {
    if (oldestTs == null) return;
    state.socket.emit('chat:history', { before: oldestTs }, (msgs) => prependHistory(msgs));
  });
}

function renderHistory(msgs) {
  const box = $('#chat-messages');
  box.innerHTML = '';
  if (!msgs || !msgs.length) {
    box.innerHTML = '<div class="ai-hint">No messages yet. Say hi to your class! 👋</div>';
    $('#chat-loadmore').hidden = true;
    return;
  }
  oldestTs = msgs[0].createdAt;
  msgs.forEach((m) => appendMessage(m, false));
  $('#chat-loadmore').hidden = msgs.length < 50;
  scrollToBottom();
}

function prependHistory(msgs) {
  const box = $('#chat-messages');
  if (!msgs || !msgs.length) { $('#chat-loadmore').hidden = true; return; }
  const scroller = $('#chat-scroll');
  const prevHeight = scroller.scrollHeight;
  oldestTs = msgs[0].createdAt;
  const frag = document.createDocumentFragment();
  msgs.forEach((m) => frag.append(messageEl(m)));
  box.prepend(frag);
  // Preserve scroll position after prepending older content.
  scroller.scrollTop = scroller.scrollHeight - prevHeight;
  if (msgs.length < 50) $('#chat-loadmore').hidden = true;
}

function appendMessage(msg, doScroll) {
  const box = $('#chat-messages');
  const hint = box.querySelector('.ai-hint');
  if (hint) hint.remove();
  const nearBottom = isNearBottom();
  box.append(messageEl(msg));
  if (doScroll && nearBottom) scrollToBottom();
  else if (!doScroll) scrollToBottom();
}

function messageEl(msg) {
  const mine = state.user && msg.userId === state.user.id;
  const wrap = el('div', `msg${mine ? ' mine' : ''}`);
  if (!mine) wrap.append(el('div', 'msg-name', msg.name));
  wrap.append(el('div', 'msg-body', msg.body));
  wrap.append(el('div', 'msg-time', fmtTime(msg.createdAt)));
  return wrap;
}

function isNearBottom() {
  const s = $('#chat-scroll');
  return s.scrollHeight - s.scrollTop - s.clientHeight < 120;
}
function scrollToBottom() {
  const s = $('#chat-scroll');
  requestAnimationFrame(() => { s.scrollTop = s.scrollHeight; });
}
