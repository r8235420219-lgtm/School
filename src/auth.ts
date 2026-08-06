import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';

const COOKIE_NAME = 'sid';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days (seconds)

export interface SessionUser {
  id: number;
  name: string;
  role: 'student' | 'admin';
}

// ─── Signed session tokens (stateless, HMAC) ────────────────────────────────
// Token format: `${userId}.${signature}` where signature = HMAC(userId).
// Simple and dependency-light; the user row is the source of truth.

function sign(value: string): string {
  return createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

function makeToken(userId: number): string {
  const payload = String(userId);
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token: string | undefined): number | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  // Constant-time compare.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const id = parseInt(payload, 10);
  return Number.isFinite(id) ? id : null;
}

// ─── User lookup / creation ─────────────────────────────────────────────────

function findOrCreateStudent(name: string): SessionUser {
  const clean = name.trim().slice(0, 60);
  const now = Date.now();
  // Reuse an existing student by (case-insensitive) name so their history/progress persists.
  const existing = db
    .prepare("SELECT id, name, role FROM users WHERE role='student' AND lower(name)=lower(?) LIMIT 1")
    .get(clean) as SessionUser | undefined;
  if (existing) {
    db.prepare('UPDATE users SET last_seen=? WHERE id=?').run(now, existing.id);
    return existing;
  }
  const info = db
    .prepare("INSERT INTO users (name, role, created_at, last_seen) VALUES (?, 'student', ?, ?)")
    .run(clean, now, now);
  return { id: Number(info.lastInsertRowid), name: clean, role: 'student' };
}

function getUserById(id: number): SessionUser | null {
  const row = db.prepare('SELECT id, name, role FROM users WHERE id=?').get(id) as
    | SessionUser
    | undefined;
  return row ?? null;
}

// ─── Request decoration + guards ────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

function readSession(req: FastifyRequest): SessionUser | null {
  const token = (req.cookies as Record<string, string | undefined>)?.[COOKIE_NAME];
  const id = verifyToken(token);
  if (id == null) return null;
  return getUserById(id);
}

function setSessionCookie(reply: FastifyReply, userId: number) {
  reply.setCookie(COOKIE_NAME, makeToken(userId), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.publicUrl.startsWith('https'),
    maxAge: COOKIE_MAX_AGE,
  });
}

/** Require a logged-in user; 401 otherwise. */
export function requireAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!req.user) {
    reply.code(401).send({ error: 'Not logged in' });
    return false;
  }
  return true;
}

/** Require the admin user; 403 otherwise. */
export function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!req.user) {
    reply.code(401).send({ error: 'Not logged in' });
    return false;
  }
  if (req.user.role !== 'admin') {
    reply.code(403).send({ error: 'Admins only' });
    return false;
  }
  return true;
}

/** Resolve a user from a raw cookie header value (used by Socket.IO handshake). */
export function userFromCookieHeader(cookieHeader: string | undefined): SessionUser | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const token = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
  const id = verifyToken(token);
  if (id == null) return null;
  return getUserById(id);
}

export function registerAuth(app: FastifyInstance) {
  // Attach req.user on every request.
  app.addHook('onRequest', async (req) => {
    req.user = readSession(req);
  });

  // POST /api/login  { name, classCode }
  app.post('/api/login', async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string; classCode?: string };
    const name = (body.name ?? '').trim();
    const classCode = (body.classCode ?? '').trim();

    if (!name || name.length < 2) {
      return reply.code(400).send({ error: 'Please enter your real name.' });
    }
    if (classCode !== config.classCode) {
      return reply.code(403).send({ error: 'Wrong class code. Ask your teacher for it.' });
    }

    const user = findOrCreateStudent(name);
    setSessionCookie(reply, user.id);
    return reply.send({ user });
  });

  // GET /api/me
  app.get('/api/me', async (req, reply) => {
    return reply.send({ user: req.user });
  });

  // POST /api/logout
  app.post('/api/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.send({ ok: true });
  });
}
