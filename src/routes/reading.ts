import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';

interface HeartbeatBody {
  assetId: number;
  seconds: number;
  pagesSeen?: number;
  totalPages?: number;
}

export function registerReadingRoutes(app: FastifyInstance) {
  // POST /api/reading/heartbeat — upsert reading_sessions and mark completed if criteria met.
  app.post('/api/reading/heartbeat', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const body = (req.body ?? {}) as HeartbeatBody;
    const userId = req.user!.id;
    const { assetId, seconds, pagesSeen, totalPages } = body;

    if (!Number.isFinite(assetId) || !Number.isFinite(seconds) || seconds < 0) {
      return reply.code(400).send({ error: 'Bad request' });
    }

    // Guard against unknown asset ids so we return a clean 404 instead of a raw FK 500.
    const asset = db.prepare('SELECT id FROM assets WHERE id=?').get(assetId);
    if (!asset) {
      return reply.code(404).send({ error: 'Asset not found' });
    }

    const now = Date.now();

    // Find or create the session.
    const existing = db
      .prepare('SELECT id, seconds, pages_seen, total_pages, completed FROM reading_sessions WHERE user_id=? AND asset_id=?')
      .get(userId, assetId) as
      | { id: number; seconds: number; pages_seen: number; total_pages: number | null; completed: number }
      | undefined;

    let sessionId: number;
    let accumulatedSeconds: number;
    let accumulatedPagesSeen: number;
    let knownTotalPages: number | null;

    if (existing) {
      sessionId = existing.id;
      accumulatedSeconds = Math.max(existing.seconds, seconds); // client sends cumulative seconds
      accumulatedPagesSeen = Math.max(existing.pages_seen, pagesSeen ?? 0);
      knownTotalPages = totalPages ?? existing.total_pages;
    } else {
      const info = db
        .prepare(
          'INSERT INTO reading_sessions (user_id, asset_id, seconds, pages_seen, total_pages, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(userId, assetId, seconds, pagesSeen ?? 0, totalPages ?? null, now, now);
      sessionId = Number(info.lastInsertRowid);
      accumulatedSeconds = seconds;
      accumulatedPagesSeen = pagesSeen ?? 0;
      knownTotalPages = totalPages ?? null;
    }

    // Completion logic: all pages seen (or ≥90% for single-page), AND minimum time.
    let completed = 0;
    if (knownTotalPages && knownTotalPages > 0) {
      const allPagesSeen = accumulatedPagesSeen >= knownTotalPages;
      const mostlySeen = knownTotalPages === 1 && accumulatedPagesSeen >= 1; // single-page ≥90% scroll counted as 1 page
      const minTimeReached = accumulatedSeconds >= knownTotalPages * config.minSecondsPerPage;
      if ((allPagesSeen || mostlySeen) && minTimeReached) {
        completed = 1;
      }
    }

    db.prepare(
      'UPDATE reading_sessions SET seconds=?, pages_seen=?, total_pages=?, completed=?, updated_at=? WHERE id=?'
    ).run(accumulatedSeconds, accumulatedPagesSeen, knownTotalPages, completed, now, sessionId);

    return reply.send({ ok: true, completed: completed === 1 });
  });
}
