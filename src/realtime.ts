import { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { db } from './db.js';
import { userFromCookieHeader, type SessionUser } from './auth.js';

const GLOBAL_ROOM = 'global';
const MAX_MESSAGE_LEN = 1000;

interface ChatMessageRow {
  id: number;
  user_id: number;
  body: string;
  created_at: number;
  name: string;
}

export function attachRealtime(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    // Same-origin in production; allow the dev origin too.
    cors: { origin: true, credentials: true },
  });

  // Expose io globally so the AI route can stream into user rooms.
  (globalThis as any).io = io;

  // Authenticate each socket from the session cookie.
  io.use((socket, next) => {
    const user = userFromCookieHeader(socket.handshake.headers.cookie);
    if (!user) return next(new Error('unauthorized'));
    (socket.data as { user: SessionUser }).user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = (socket.data as { user: SessionUser }).user;

    // Join the global chat room and the user's private room (for AI streaming).
    socket.join(GLOBAL_ROOM);
    socket.join(`user:${user.id}`);

    // ── Global chat: send message history (most recent 50) ──
    socket.on('chat:history', (payload: { before?: number } | undefined, ack?: (msgs: any[]) => void) => {
      const before = payload?.before && Number.isFinite(payload.before) ? payload.before : Date.now() + 1;
      const rows = db
        .prepare(
          `SELECT m.id, m.user_id, m.body, m.created_at, u.name
           FROM messages m JOIN users u ON u.id = m.user_id
           WHERE m.created_at < ?
           ORDER BY m.created_at DESC LIMIT 50`
        )
        .all(before) as ChatMessageRow[];
      const messages = rows.reverse().map(toClientMessage);
      if (ack) ack(messages);
      else socket.emit('chat:history', messages);
    });

    // ── Global chat: post a new message ──
    socket.on('chat:send', (payload: { body?: string }) => {
      const body = (payload?.body ?? '').trim();
      if (!body) return;
      const clean = body.slice(0, MAX_MESSAGE_LEN);
      const now = Date.now();
      const info = db
        .prepare('INSERT INTO messages (user_id, body, created_at) VALUES (?, ?, ?)')
        .run(user.id, clean, now);
      const message = toClientMessage({
        id: Number(info.lastInsertRowid),
        user_id: user.id,
        body: clean,
        created_at: now,
        name: user.name,
      });
      io.to(GLOBAL_ROOM).emit('chat:new', message);
    });

    socket.on('disconnect', () => {
      // Nothing to clean up; rooms auto-leave.
    });
  });

  return io;
}

function toClientMessage(row: ChatMessageRow) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    body: row.body,
    createdAt: row.created_at,
  };
}
