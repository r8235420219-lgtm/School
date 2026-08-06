import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, isAbsolute } from 'node:path';
import { mkdirSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Project root is one level up from src/
const ROOT = resolve(__dirname, '..');

function envStr(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function envList(key: string, fallback: string[]): string[] {
  const v = process.env[key];
  if (!v) return fallback;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolvePath(p: string): string {
  return isAbsolute(p) ? p : resolve(ROOT, p);
}

const DATA_DIR = resolvePath(envStr('DATA_DIR', './data'));
const STORAGE_DIR = resolvePath(envStr('STORAGE_DIR', './storage'));

// Ensure the data + storage directories exist at startup.
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(STORAGE_DIR, { recursive: true });

export const config = {
  root: ROOT,
  port: parseInt(envStr('PORT', '3000'), 10),
  publicUrl: envStr('PUBLIC_URL', `http://localhost:${envStr('PORT', '3000')}`),
  sessionSecret: envStr('SESSION_SECRET', 'dev-insecure-secret-change-me'),

  classCode: envStr('CLASS_CODE', 'school123'),
  adminName: envStr('ADMIN_NAME', 'Teacher'),
  adminTelegramIds: envList('ADMIN_TELEGRAM_IDS', [])
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n)),

  telegramBotToken: envStr('TELEGRAM_BOT_TOKEN', ''),

  groqApiKey: envStr('GROQ_API_KEY', ''),
  groqBaseUrl: 'https://api.groq.com/openai/v1',
  // Ordered preference lists; first live model wins at boot (see groq.ts).
  groqTextModels: envList('GROQ_TEXT_MODELS', [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'llama-3.3-70b-versatile',
  ]),
  groqVisionModels: envList('GROQ_VISION_MODELS', [
    'qwen/qwen3.6-27b',
    'meta-llama/llama-4-scout-17b-16e-instruct',
  ]),

  dataDir: DATA_DIR,
  storageDir: STORAGE_DIR,
  dbPath: resolve(DATA_DIR, 'app.sqlite'),

  // Reading-completion tuning.
  minSecondsPerPage: 5, // must dwell at least this long per page to count as "read"
  heartbeatSeconds: 15, // client heartbeat cadence (informational)

  // Upload limits (Telegram caps downloads at 20MB).
  maxUploadBytes: 20 * 1024 * 1024,
} as const;

export type AppConfig = typeof config;
