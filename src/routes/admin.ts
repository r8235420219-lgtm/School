import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';

export function registerAdminRoutes(app: FastifyInstance) {
  // GET /api/admin/overview — per-child summary table
  app.get('/api/admin/overview', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    const students = db
      .prepare("SELECT id, name FROM users WHERE role='student' ORDER BY name")
      .all() as { id: number; name: string }[];

    const overview = students.map((s) => {
      const stats = db
        .prepare(
          `SELECT
             COUNT(*) total_sessions,
             SUM(seconds) total_seconds,
             SUM(completed) completed_count
           FROM reading_sessions WHERE user_id=?`
        )
        .get(s.id) as { total_sessions: number; total_seconds: number; completed_count: number };

      return {
        userId: s.id,
        name: s.name,
        totalSeconds: stats.total_seconds || 0,
        completed: stats.completed_count || 0,
        totalAssets: stats.total_sessions || 0,
      };
    });

    return reply.send({ students: overview });
  });

  // GET /api/admin/charts?period=day|week|month
  app.get('/api/admin/charts', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { period } = req.query as { period?: string };
    const validPeriod = period === 'week' || period === 'month' ? period : 'day';

    // SQLite strftime formats: %Y-%m-%d (day), %Y-%W (week), %Y-%m (month)
    const formatMap = { day: '%Y-%m-%d', week: '%Y-%W', month: '%Y-%m' };
    const fmt = formatMap[validPeriod];

    const rows = db
      .prepare(
        `SELECT
           strftime(?, updated_at / 1000, 'unixepoch') bucket,
           COUNT(DISTINCT user_id) active_students,
           SUM(seconds) total_seconds
         FROM reading_sessions
         GROUP BY bucket
         ORDER BY bucket DESC
         LIMIT 30`
      )
      .all(fmt) as { bucket: string; active_students: number; total_seconds: number }[];

    // Most recent first, but charts render left-to-right oldest→newest.
    const series = rows.reverse().map((r) => ({
      label: r.bucket,
      activeStudents: r.active_students,
      totalSeconds: r.total_seconds,
    }));

    return reply.send({ period: validPeriod, series });
  });
}
