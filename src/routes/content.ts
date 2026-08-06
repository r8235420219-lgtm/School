import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';

interface NodeRow {
  id: number;
  parent_id: number | null;
  kind: 'subject' | 'subcategory' | 'chapter';
  name: string;
  sort_order: number;
}

interface AssetRow {
  id: number;
  chapter_id: number;
  tab: 'mcq' | 'qa';
  type: 'pdf' | 'image';
  file_path: string;
  original_name: string | null;
  uploaded_at: number;
}

export function registerContentRoutes(app: FastifyInstance) {
  // Full hierarchy tree (subjects → subcategories → chapters). Students browse this.
  app.get('/api/tree', async (req, reply) => {
    if (!requireAuth(req, reply)) return;

    const nodes = db
      .prepare('SELECT id, parent_id, kind, name, sort_order FROM nodes ORDER BY sort_order, name')
      .all() as NodeRow[];

    // Count assets per chapter so the UI can show badges.
    const counts = db
      .prepare('SELECT chapter_id, tab, COUNT(*) c FROM assets GROUP BY chapter_id, tab')
      .all() as { chapter_id: number; tab: string; c: number }[];
    const countMap = new Map<number, { mcq: number; qa: number }>();
    for (const row of counts) {
      const e = countMap.get(row.chapter_id) ?? { mcq: 0, qa: 0 };
      if (row.tab === 'mcq') e.mcq = row.c;
      else e.qa = row.c;
      countMap.set(row.chapter_id, e);
    }

    const byId = new Map<number, any>();
    for (const n of nodes) {
      byId.set(n.id, {
        id: n.id,
        kind: n.kind,
        name: n.name,
        children: [] as any[],
        ...(n.kind === 'chapter' ? { counts: countMap.get(n.id) ?? { mcq: 0, qa: 0 } } : {}),
      });
    }
    const roots: any[] = [];
    for (const n of nodes) {
      const node = byId.get(n.id);
      if (n.parent_id && byId.has(n.parent_id)) byId.get(n.parent_id).children.push(node);
      else roots.push(node);
    }
    return reply.send({ tree: roots });
  });

  // Assets in a chapter, optionally filtered by tab (mcq|qa).
  app.get('/api/chapter/:id/assets', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    const { tab } = req.query as { tab?: string };
    const chapterId = parseInt(id, 10);
    if (!Number.isFinite(chapterId)) return reply.code(400).send({ error: 'Bad chapter id' });

    let rows: AssetRow[];
    if (tab === 'mcq' || tab === 'qa') {
      rows = db
        .prepare(
          'SELECT id, chapter_id, tab, type, file_path, original_name, uploaded_at FROM assets WHERE chapter_id=? AND tab=? ORDER BY uploaded_at DESC'
        )
        .all(chapterId, tab) as AssetRow[];
    } else {
      rows = db
        .prepare(
          'SELECT id, chapter_id, tab, type, file_path, original_name, uploaded_at FROM assets WHERE chapter_id=? ORDER BY uploaded_at DESC'
        )
        .all(chapterId) as AssetRow[];
    }

    const assets = rows.map((a) => ({
      id: a.id,
      tab: a.tab,
      type: a.type,
      name: a.original_name ?? `file-${a.id}`,
      url: `/api/asset/${a.id}/file`,
      uploaded_at: a.uploaded_at,
    }));
    return reply.send({ assets });
  });

  // Stream the actual file (PDF or image). Auth-gated.
  app.get('/api/asset/:id/file', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    const assetId = parseInt(id, 10);
    const asset = db
      .prepare('SELECT type, file_path, original_name FROM assets WHERE id=?')
      .get(assetId) as { type: string; file_path: string; original_name: string | null } | undefined;
    if (!asset) return reply.code(404).send({ error: 'Not found' });

    // file_path is stored relative to storageDir; resolve safely inside it.
    const abs = resolve(config.storageDir, asset.file_path);
    if (!abs.startsWith(resolve(config.storageDir))) {
      return reply.code(400).send({ error: 'Invalid path' });
    }

    const contentType =
      asset.type === 'pdf'
        ? 'application/pdf'
        : guessImageMime(asset.file_path);
    reply.header('Content-Type', contentType);
    reply.header('Content-Disposition', `inline; filename="${asset.original_name ?? 'file'}"`);
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(createReadStream(abs));
  });
}

function guessImageMime(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.webp')) return 'image/webp';
  if (p.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}
