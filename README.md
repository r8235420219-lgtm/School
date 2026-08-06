# StudyHub — Mobile-First School Learning Platform

A complete learning platform for small schools and tutoring centers: hierarchical content (Subject → Sub-category → Chapter), MCQ and Q&A tabs, AI study assistant (Groq), reading-time analytics, and global student chat — all in one mobile-first PWA.

**Stack:** Node.js 24 + TypeScript, Fastify, Socket.IO, SQLite (better-sqlite3 in WAL mode), grammY Telegram bot, Groq AI (text + vision), PDF.js, Chart.js. Zero-dependency icon generator (hand-encoded PNGs). No sharp, no ImageMagick, no serverless — one process, one database file, works anywhere Node runs.

---

## Features

### For Students
- 📚 **Hierarchical content browser** — drill down Subject → Sub-category → Chapter, with MCQ / Q&A tabs per chapter
- 📄 **PDF + image viewer** — PDF.js renders multi-page PDFs in-browser; images display inline
- 🤖 **AI study assistant** — ask questions about any PDF or image (Groq handles both text and vision)
- ⏱️ **Automatic reading tracking** — Page Visibility API + heartbeat + IntersectionObserver + sendBeacon (survives Android backgrounding)
- 💬 **Global class chat** — real-time Socket.IO chat with pagination
- 📲 **PWA** — install to home screen, works offline (cached shell), safe-area insets for notched phones

### For Teachers (Admin)
- 📤 **Telegram bot uploads** — step-by-step conversation to pick/create categories and upload PDFs/images
- 📊 **Analytics dashboard** — per-child reading time + completion stats, day/week/month Chart.js time-series
- 🔑 **Simple auth** — students log in with name + a shared class code (keeps strangers out of chat)

### Under the Hood
- **One SQLite file** (WAL mode) shared by the web process and the bot process
- **Litestream** continuous replication to Cloudflare R2 (free tier) — survives ephemeral disks
- **Groq models config-driven** with boot-time live-model resolution (handles frequent deprecations)
- **No image deps** — icons hand-generated via Node's built-in `zlib` (no sharp/ImageMagick/rsvg)

---

## Quick Start (Local Development)

```bash
# 1. Clone and install
git clone <your-repo>
cd Website
npm install

# 2. Copy .env.example → .env and fill in:
#    - CLASS_CODE (your shared class PIN, e.g. "school123")
#    - TELEGRAM_BOT_TOKEN (from @BotFather)
#    - ADMIN_TELEGRAM_IDS (comma-separated numeric user IDs — find yours by DMing @userinfobot)
#    - GROQ_API_KEY (from console.groq.com)
cp .env.example .env
nano .env

# 3. Start the web server (auto-migrates DB, seeds admin user)
npm run dev:web
# → http://localhost:3000

# 4. In a second terminal, start the Telegram bot
npm run dev:bot
# → DM your bot on Telegram, type /start, then /upload

# 5. Open http://localhost:3000 on your phone (same Wi-Fi)
#    Log in with any name + the CLASS_CODE you set.
```

---

## Environment Variables

Create `.env` in the project root (see `.env.example` for a template):

```bash
# ── Web server ──
PORT=3000
PUBLIC_URL=http://localhost:3000              # or your deploy URL
SESSION_SECRET=<random 32+ char string>       # for signing session cookies
CLASS_CODE=school123                          # shared PIN students use to log in
ADMIN_NAME=Teacher                            # name of the seeded admin user

# ── Telegram bot ──
TELEGRAM_BOT_TOKEN=<from @BotFather>
ADMIN_TELEGRAM_IDS=123456789,987654321        # comma-separated numeric IDs (find yours: @userinfobot)

# ── Groq AI ──
GROQ_API_KEY=<from console.groq.com>
# Optional: override default model lists (comma-separated, first live model wins)
# GROQ_TEXT_MODELS=openai/gpt-oss-120b,openai/gpt-oss-20b,llama-3.3-70b-versatile
# GROQ_VISION_MODELS=qwen/qwen3.6-27b,meta-llama/llama-4-scout-17b-16e-instruct

# ── Storage (local dev defaults to ./data and ./storage) ──
DATA_DIR=./data
STORAGE_DIR=./storage

# ── Litestream (for deploy only; see Deployment section below) ──
LITESTREAM_R2_BUCKET=<your-r2-bucket-name>
LITESTREAM_R2_ACCOUNT_ID=<your-cloudflare-account-id>
LITESTREAM_R2_ACCESS_KEY_ID=<r2-token-access-key>
LITESTREAM_R2_SECRET_ACCESS_KEY=<r2-token-secret>
```

---

## Project Structure

```
Website/
├── package.json           # deps: fastify, socket.io, better-sqlite3, grammy, openai, pdf-parse
├── tsconfig.json          # ES2022, NodeNext modules
├── .env.example           # template for local .env
├── litestream.yml         # R2 replication config (for deploy)
├── src/
│   ├── config.ts          # loads .env, resolves dirs, Groq model lists
│   ├── db.ts              # better-sqlite3 open + migrations (6 tables)
│   ├── server.ts          # Fastify app: static PWA + REST + Socket.IO
│   ├── auth.ts            # name+classCode login → HMAC session cookie
│   ├── groq.ts            # OpenAI SDK → Groq (text + vision streaming)
│   ├── pdf.ts             # pdf-parse wrapper (extract text + page count)
│   ├── routes/
│   │   ├── content.ts     # GET /api/tree, /api/chapter/:id/assets, /api/asset/:id/file
│   │   ├── ai.ts          # POST /api/ai/ask (kicks off Socket.IO stream)
│   │   ├── reading.ts     # POST /api/reading/heartbeat (upsert reading_sessions)
│   │   └── admin.ts       # GET /api/admin/overview, /api/admin/charts?period=
│   └── realtime.ts        # Socket.IO: global chat + AI streaming room
├── bot/
│   └── index.ts           # grammY session state machine: category builder + file intake
├── public/                # PWA frontend (mobile-first, no build step)
│   ├── index.html         # SPA shell
│   ├── style.css          # dark theme, CSS vars, safe-area insets
│   ├── app.js             # login, nav, tree drill-down, chapter tabs
│   ├── viewer.js          # PDF.js + reading tracker + AI chat box
│   ├── chat.js            # global Socket.IO chat
│   ├── admin.html         # teacher dashboard
│   ├── admin.js           # Chart.js day/week/month toggles
│   ├── api.js             # fetch helpers + shared state
│   ├── sw.js              # service worker (cache shell, never API)
│   ├── manifest.webmanifest
│   └── icons/
│       ├── icon.svg       # vector (book mark on gradient)
│       ├── icon-192.png   # hand-encoded PNG (no sharp/ImageMagick)
│       └── icon-512.png
├── scripts/
│   └── gen-icons.mjs      # PNG generator (Node zlib, no deps)
├── data/                  # SQLite file (gitignored)
└── storage/               # uploaded PDFs/images (gitignored)
    ├── mcq/
    └── qa/
```

---

## Database Schema

Six tables, one self-referencing `nodes` for the hierarchy:

```sql
nodes (id, parent_id, kind, name, sort_order, created_at)
  -- kind: 'subject' | 'subcategory' | 'chapter'
  -- parent_id NULL = top-level Subject

assets (id, chapter_id, tab, type, file_path, original_name, extracted_text, uploaded_at)
  -- tab: 'mcq' | 'qa'
  -- type: 'pdf' | 'image'
  -- extracted_text: cached PDF text (NULL for images)

users (id, name, role, created_at, last_seen)
  -- role: 'student' | 'admin'

messages (id, user_id, body, created_at)
  -- global chat

ai_messages (id, user_id, asset_id, role, body, created_at)
  -- AI Q&A history (role: 'user' | 'assistant')

reading_sessions (id, user_id, asset_id, seconds, pages_seen, total_pages, completed, started_at, updated_at)
  -- reading tracker state (one row per user+asset)
```

Auto-migrates on first run. Seeds admin user (id=1, name from `ADMIN_NAME` env).

---

## Groq AI Setup

1. Get a free API key from [console.groq.com](https://console.groq.com)
2. Add to `.env`: `GROQ_API_KEY=gsk_...`
3. Models are config-driven with fallback (Groq deprecates models frequently):
   - **Text/chat** default: `openai/gpt-oss-120b` (fallback: `openai/gpt-oss-20b`)
   - **Vision** default: `qwen/qwen3.6-27b` (fallback: none → graceful "vision unavailable" message)
4. On boot, `groq.ts` calls `GET /v1/models` and picks the first live configured model
5. Override via env: `GROQ_TEXT_MODELS=model1,model2` and `GROQ_VISION_MODELS=model1,model2`

The AI answers questions using:
- **PDFs** → cached `extracted_text` from `pdf-parse` (no RAG; fine for one chapter)
- **Images** → resized base64 data URL (no sharp; Node `fs` + base64)

---

## Deployment (Render / Railway + Cloudflare R2)

Free-tier hosting (Render/Railway) gives ephemeral disk — Litestream replicates SQLite to R2 so the DB survives restarts.

### 1. Cloudflare R2 Setup (Free Tier: 10GB storage, unlimited egress)

```bash
# 1. Sign up at dash.cloudflare.com, create an R2 bucket (e.g. "studyhub-db")
# 2. API Tokens → Create API Token → R2 Read & Write
#    → copy Access Key ID + Secret Access Key
# 3. Note your Account ID (in the R2 overview page URL)
```

Add to your deploy platform's env vars:
```
LITESTREAM_R2_BUCKET=studyhub-db
LITESTREAM_R2_ACCOUNT_ID=abc123...
LITESTREAM_R2_ACCESS_KEY_ID=...
LITESTREAM_R2_SECRET_ACCESS_KEY=...
```

### 2. Install Litestream Binary

On Render/Railway, add a build command that installs Litestream:

```bash
# Build command (Render/Railway):
curl -fsSL https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.tar.gz | tar -xz -C /usr/local/bin && npm install && npm run build
```

(Adjust version if needed; check [litestream.io/install](https://litestream.io/install))

### 3. Start Command (Web + Bot + Litestream)

Use this as your **Start Command** on Render/Railway:

```bash
litestream replicate -config litestream.yml -exec "npm run start"
```

This:
1. Restores the DB from R2 on first boot (if it exists)
2. Starts continuous replication in the background
3. Runs `npm run start` (which runs both web + bot processes via `concurrently`)

Add to `package.json` `scripts`:
```json
"start": "concurrently \"node --import tsx src/server.ts\" \"node --import tsx bot/index.ts\"",
"build": "tsc --noEmit"
```

### 4. Deploy Platform Config

**Render** (`render.yaml` example):
```yaml
services:
  - type: web
    name: studyhub
    env: node
    buildCommand: curl -fsSL https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.tar.gz | tar -xz -C /usr/local/bin && npm install
    startCommand: litestream replicate -config litestream.yml -exec "npm run start"
    envVars:
      - key: NODE_ENV
        value: production
      - key: PUBLIC_URL
        value: https://studyhub.onrender.com
      # ... add all other env vars from .env
    disk:
      name: storage
      mountPath: /opt/render/project/src/storage
      sizeGB: 1
```

**Railway**: just paste the build + start commands in the UI, add env vars, enable persistent disk for `/app/storage` (1GB).

### 5. Set `PUBLIC_URL` to Your Deploy Domain

```bash
PUBLIC_URL=https://studyhub.onrender.com
# or
PUBLIC_URL=https://studyhub.up.railway.app
```

This is used for Fastify's listen log and for CORS (if needed later).

---

## Production Checklist

- [ ] Generate a strong `SESSION_SECRET` (32+ random chars)
- [ ] Set a non-obvious `CLASS_CODE` (give to students verbally, not in screenshots)
- [ ] Restrict `ADMIN_TELEGRAM_IDS` to your numeric Telegram user ID only
- [ ] Enable Litestream replication to R2 (see above)
- [ ] Test the PWA "Add to Home Screen" on an Android phone
- [ ] Test reading-time tracking survives backgrounding (open a PDF, switch apps, return → time continues)
- [ ] Test AI works for both PDFs and images
- [ ] Test global chat with 2+ devices logged in

---

## How It Works

### Teacher Uploads via Telegram Bot

1. Teacher DMs the bot, types `/upload`
2. Bot prompts: pick/create Subject → Sub-category → Chapter → choose tab (MCQ/QA)
3. Teacher sends PDF or image files (one by one)
4. Bot downloads each file (Telegram URL expires in ~1hr), extracts PDF text via `pdf-parse`, saves to `storage/{tab}/{timestamp}-{name}`, inserts `assets` row
5. Type `/done` to finish

### Student Views Content + Asks AI

1. Student logs in with name + `CLASS_CODE`
2. Drills down Subject → Sub-cat → Chapter, switches between MCQ / QA tabs
3. Taps a file → opens in the viewer (PDF.js for PDFs, `<img>` for images)
4. **Reading tracker**:
   - Accrues active seconds (tab visible only, uses Page Visibility API + timestamp deltas)
   - Detects PDF pages seen via IntersectionObserver (50% threshold)
   - Sends heartbeat every 15s to `/api/reading/heartbeat` (upserts `reading_sessions`)
   - On tab hidden or `pagehide`, fires `navigator.sendBeacon` (survives backgrounding)
   - Marks `completed=1` when all pages seen AND `seconds >= totalPages * 5`
5. **AI chat box** (slides up from bottom):
   - Student types a question
   - POST `/api/ai/ask` → server fetches last 10 history, stores user question, kicks off `streamAnswer()` (non-blocking)
   - Server calls Groq: `streamTextQuestion(extracted_text, ...)` for PDFs, `streamImageQuestion(imagePath, ...)` for images
   - Answer streams token-by-token via `Socket.IO` to the student's private room (`user:${userId}`)
   - Frontend appends each token to the bubble, stores final answer in DB

### Teacher Views Analytics

1. Navigate to "Dashboard" tab (bottom nav, admin-only)
2. **Per-student table**: name, total reading minutes, completed assets, % done
3. **Chart.js time-series**: toggle Daily / Weekly / Monthly
   - X-axis: time buckets (SQLite `strftime('%Y-%m-%d', updated_at/1000, 'unixepoch')`)
   - Left Y-axis: active students (count distinct user_id per bucket)
   - Right Y-axis: total reading time (sum seconds, converted to minutes)

### Global Class Chat

1. Socket.IO connects on login (cookie-based auth in the handshake)
2. Client joins `global` room + `user:${userId}` room (for AI streaming)
3. Client sends `chat:send` → server validates, inserts `messages` row, broadcasts `chat:new` to `global`
4. Cursor-based pagination on scroll-up: `chat:history { before: oldestTs }`

---

## Reading-Time Tracking: How It's Reliable on Mobile

The tracker uses **four techniques** to survive Android's aggressive backgrounding:

1. **Page Visibility API** — `document.visibilityState` pauses the timer when the tab is hidden (switching apps, locking screen)
2. **Timestamp deltas** — accrues `(now - lastTick) / 1000` every second, not tick-counting (immune to throttled timers)
3. **Heartbeat POST** — every 15s while visible, sends cumulative seconds to `/api/reading/heartbeat` (uses `fetch` with `keepalive: true`)
4. **`pagehide` + `sendBeacon`** — when the page unloads or backgrounds, fires `navigator.sendBeacon('/api/reading/heartbeat', jsonBlob)` as a last-ditch save (survives task kill)

**Never uses `beforeunload`/`unload`** (unreliable on Android).

Completion logic: `completed=1` when `(pagesSeen >= totalPages OR singlePageFullySeen) AND seconds >= totalPages * 5`.

---

## No Sharp / No ImageMagick — How?

The PWA icons are **hand-encoded PNGs** via Node's built-in `zlib`:

1. `scripts/gen-icons.mjs` draws a 192×192 and 512×512 RGBA pixel array (gradient + book mark)
2. Prepends filter byte (0) to each scanline, deflates with `zlib.deflateSync`
3. Wraps in PNG signature + IHDR/IDAT/IEND chunks with CRC32
4. Writes to `public/icons/icon-{192,512}.png`

Run: `node scripts/gen-icons.mjs` (already done; output is committed).

Images uploaded by teachers go straight to Groq's vision model as base64 data URLs (no resize needed; Telegram caps at 20MB anyway).

---

## Troubleshooting

### "Wrong class code" on login
→ Check `.env`: `CLASS_CODE` must match what the student types (case-sensitive).

### Bot doesn't respond
→ Verify `TELEGRAM_BOT_TOKEN` and `ADMIN_TELEGRAM_IDS` (find your numeric ID: @userinfobot). Restart the bot process.

### AI says "not configured"
→ Add `GROQ_API_KEY` to `.env` and restart.

### AI says "vision temporarily unavailable"
→ Groq's vision model (`qwen/qwen3.6-27b`) is in preview and may be removed. Add a fallback in `GROQ_VISION_MODELS` or the AI degrades gracefully to text-only.

### Reading time doesn't accrue
→ Open the viewer, keep the tab visible (foreground), wait 15s → check Network tab for `/api/reading/heartbeat` POST. If missing, check for JS errors.

### PDF doesn't render
→ PDF.js CDN (cdnjs.cloudflare.com) must be reachable. If offline, the service worker won't help (PDF.js is not cached). Consider self-hosting `pdf.min.js` and `pdf.worker.min.js`.

### Chart shows no data
→ Upload files via the bot, then open and read them as a student → wait 15s → refresh the dashboard.

### Database "disk I/O error" on deploy
→ Litestream might not be running. Check start command: `litestream replicate -config litestream.yml -exec "npm run start"`. Ensure `litestream.yml` is in the project root and env vars are set.

---

## License

MIT — free to use, modify, and deploy for your school or tutoring center.

---

## Credits

- **Fastify** (web framework)
- **Socket.IO** (realtime chat + AI streaming)
- **better-sqlite3** (synchronous SQLite)
- **grammY** (Telegram bot framework)
- **Groq** (fast LLM inference: text + vision)
- **OpenAI Node SDK** (pointed at Groq's API)
- **pdf-parse** (extract PDF text)
- **PDF.js** (Mozilla, render PDFs in-browser)
- **Chart.js** (analytics charts)
- **Litestream** (SQLite → R2 replication)
- **Cloudflare R2** (S3-compatible, free tier)

Built with ☕ for small schools that need a simple, mobile-first learning platform without vendor lock-in.
