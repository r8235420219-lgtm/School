import Database from 'better-sqlite3';
import { config } from './config.js';
import { existsSync } from 'node:fs';

const dbPath = config.dbPath;
const dbExistedBefore = existsSync(dbPath);

export const db = new Database(dbPath);

// Enable WAL mode (better concurrency, safer for simultaneous web + bot writes).
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Idempotent migrations — run every startup.
function migrate() {
  const version = db.pragma('user_version', { simple: true }) as number;

  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('subject', 'subcategory', 'chapter')),
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);

      CREATE TABLE IF NOT EXISTS assets (
        id INTEGER PRIMARY KEY,
        chapter_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        tab TEXT NOT NULL CHECK(tab IN ('mcq', 'qa')),
        type TEXT NOT NULL CHECK(type IN ('pdf', 'image')),
        file_path TEXT NOT NULL,
        original_name TEXT,
        extracted_text TEXT,
        uploaded_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_assets_chapter ON assets(chapter_id);

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student', 'admin')),
        created_at INTEGER NOT NULL,
        last_seen INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_users_name ON users(name);

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

      CREATE TABLE IF NOT EXISTS ai_messages (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ai_messages_user ON ai_messages(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS reading_sessions (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        seconds INTEGER NOT NULL DEFAULT 0,
        pages_seen INTEGER DEFAULT 0,
        total_pages INTEGER,
        completed INTEGER DEFAULT 0 CHECK(completed IN (0,1)),
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reading_user_asset ON reading_sessions(user_id, asset_id);
      CREATE INDEX IF NOT EXISTS idx_reading_updated ON reading_sessions(updated_at DESC);
    `);
    db.pragma('user_version = 1');
  }

  // Future migrations: if (version < 2) { ... db.pragma('user_version = 2'); }
}

migrate();

// Seed the single admin user (idempotent — only creates if doesn't exist).
export function seedAdmin() {
  const existing = db
    .prepare('SELECT id FROM users WHERE role = ? LIMIT 1')
    .get('admin');
  if (!existing) {
    const now = Date.now();
    db.prepare('INSERT INTO users (name, role, created_at) VALUES (?, ?, ?)').run(
      config.adminName,
      'admin',
      now
    );
    console.log(`[db] Created admin user: ${config.adminName}`);
  }
}

if (!dbExistedBefore) {
  seedAdmin();
  console.log('[db] Fresh database initialized with schema v1 + admin user.');
} else {
  console.log('[db] Existing database opened (WAL mode).');
}

export default db;
