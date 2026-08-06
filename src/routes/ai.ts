import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import * as groq from '../groq.js';

interface AssetMeta {
  id: number;
  type: 'pdf' | 'image';
  file_path: string;
  extracted_text: string | null;
}

export function registerAiRoutes(app: FastifyInstance) {
  // POST /api/ai/ask { assetId, question }
  // Returns immediately; answer streams via Socket.IO on the user's private room.
  app.post('/api/ai/ask', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const userId = req.user!.id;
    const body = (req.body ?? {}) as { assetId?: number; question?: string };
    const { assetId, question } = body;

    if (!Number.isFinite(assetId) || !question || question.trim().length < 2) {
      return reply.code(400).send({ error: 'Asset id and question required.' });
    }

    if (!groq.isConfigured()) {
      return reply
        .code(503)
        .send({ error: 'AI is not configured on the server. Ask your teacher to add a Groq API key.' });
    }

    const asset = db
      .prepare('SELECT id, type, file_path, extracted_text FROM assets WHERE id=?')
      .get(assetId) as AssetMeta | undefined;
    if (!asset) {
      return reply.code(404).send({ error: 'Asset not found.' });
    }

    // Fetch recent history (last 10 messages for this user+asset).
    const historyRows = db
      .prepare(
        'SELECT role, body FROM ai_messages WHERE user_id=? AND asset_id=? ORDER BY created_at DESC LIMIT 10'
      )
      .all(userId, assetId) as { role: 'user' | 'assistant'; body: string }[];
    const history = historyRows.reverse().map((r) => ({ role: r.role, content: r.body }));

    // Store the user question immediately.
    const now = Date.now();
    db.prepare('INSERT INTO ai_messages (user_id, asset_id, role, body, created_at) VALUES (?, ?, ?, ?, ?)').run(
      userId,
      assetId,
      'user',
      question.trim(),
      now
    );

    // Kick off the streaming answer (it will emit to Socket.IO and store the answer).
    // We respond immediately to the HTTP request; the client listens on its Socket.IO room.
    streamAnswer(userId, asset, question.trim(), history).catch((err) => {
      console.error('[ai] stream error:', err);
    });

    return reply.send({ ok: true });
  });
}

/**
 * Stream an AI answer to the user's Socket.IO room and persist it to the DB.
 * Requires the Socket.IO server to be attached to `app.io` (done in server.ts).
 */
async function streamAnswer(
  userId: number,
  asset: AssetMeta,
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[]
) {
  const { type, file_path, extracted_text } = asset;
  const io = (globalThis as any).io; // server.ts sets this global
  if (!io) {
    console.error('[ai] Socket.IO not available — cannot stream answer.');
    return;
  }

  const userRoom = `user:${userId}`;
  let fullAnswer = '';

  const handlers: groq.StreamHandlers = {
    onToken: (token) => {
      fullAnswer += token;
      io.to(userRoom).emit('ai:token', { token });
    },
    onDone: (text) => {
      fullAnswer = text || fullAnswer;
      io.to(userRoom).emit('ai:done', { answer: fullAnswer });
      // Persist the assistant answer.
      db.prepare(
        'INSERT INTO ai_messages (user_id, asset_id, role, body, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(userId, asset.id, 'assistant', fullAnswer, Date.now());
    },
    onError: (message) => {
      io.to(userRoom).emit('ai:error', { error: message });
    },
  };

  if (type === 'pdf') {
    await groq.streamTextQuestion(extracted_text || '', question, history, handlers);
  } else {
    // image
    const { resolve } = await import('node:path');
    const { config } = await import('../config.js');
    const imagePath = resolve(config.storageDir, file_path);
    await groq.streamImageQuestion(imagePath, question, history, handlers);
  }
}
