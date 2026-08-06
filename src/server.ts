import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import './db.js'; // triggers migration + admin seed on import
import { registerAuth } from './auth.js';
import { registerContentRoutes } from './routes/content.js';
import { registerReadingRoutes } from './routes/reading.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerAdminRoutes } from './routes/admin.js';
import { attachRealtime } from './realtime.js';
import { resolveModels, getModels } from './groq.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

async function main() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } });

  await app.register(cookie, { secret: config.sessionSecret });

  // Serve the PWA frontend from /public.
  await app.register(fastifyStatic, { root: publicDir, prefix: '/' });

  // Health check for hosting platforms.
  app.get('/healthz', async () => ({ ok: true, models: getModels() }));

  // Register API routes.
  registerAuth(app);
  registerContentRoutes(app);
  registerReadingRoutes(app);
  registerAiRoutes(app);
  registerAdminRoutes(app);

  // SPA fallback: serve index.html for non-API, non-file routes.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/socket.io')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });

  // Start the server first so Fastify's HTTP server exists, then attach Socket.IO to it.
  await app.listen({ host: '0.0.0.0', port: config.port });

  // Attach Socket.IO to Fastify's underlying HTTP server.
  attachRealtime(app.server);

  // Resolve Groq models in the background (non-blocking).
  resolveModels().catch(() => {});

  app.log.info(`School platform running at ${config.publicUrl} (port ${config.port})`);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
