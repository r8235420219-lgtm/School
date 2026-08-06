import { Bot, Context, session, type SessionFlavor } from 'grammy';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { config } from '../src/config.js';
import { db } from '../src/db.js';
import { extractPdf } from '../src/pdf.js';

// ─── Session-based upload state machine ──────────────────────────────────────
// Simpler and more robust than the conversations plugin: we track where each
// teacher is in the flow and interpret each incoming message accordingly.

type Step = 'idle' | 'subject' | 'subcategory' | 'chapter' | 'tab' | 'files';

interface UploadState {
  step: Step;
  subjectId?: number;
  subcategoryId?: number;
  chapterId?: number;
  tab?: 'mcq' | 'qa';
  // The numbered options last shown to the user (id lookup by index).
  options?: { id: number; name: string }[];
  // When true, the next text message is a new name to create (not a pick).
  awaitingNewName?: boolean;
  uploadedCount?: number;
}

interface SessionData {
  upload: UploadState;
}

type BotContext = Context & SessionFlavor<SessionData>;

// The web server imports this module and calls startBot() after it is listening
// (single-process deploy — Render's free tier runs one process; a separate bot
// worker would be a paid service). So we must NOT exit or throw at import time.
// Construct with a harmless placeholder when the token is absent; startBot()
// refuses to begin polling without a real token, so the placeholder never makes
// a network call.
const bot = new Bot<BotContext>(config.telegramBotToken || 'disabled:disabled');

// Access control:
//  • If ADMIN_TELEGRAM_IDS is set, only those user IDs may use the bot (locked).
//  • If it's empty, the bot is PUBLIC — anyone who knows the (private) username
//    can use it. Keep the bot's username unlisted so it stays teacher-only in
//    practice.
bot.use(async (ctx, next) => {
  const allowlist = config.adminTelegramIds;
  if (allowlist.length > 0) {
    const userId = ctx.from?.id;
    if (!userId || !allowlist.includes(userId)) {
      await ctx.reply('Sorry, this bot is for authorized teachers only.');
      return;
    }
  }
  await next();
});

bot.use(
  session({
    initial: (): SessionData => ({ upload: { step: 'idle' } }),
  })
);

// ─── Commands ────────────────────────────────────────────────────────────────

bot.command('start', async (ctx) => {
  ctx.session.upload = { step: 'idle' };
  await ctx.reply(
    'Welcome! 📚\n\nUse /upload to organize and upload study materials (PDFs/images) for your students.\n\nYou can type /cancel at any time to stop.'
  );
});

bot.command('cancel', async (ctx) => {
  ctx.session.upload = { step: 'idle' };
  await ctx.reply('Cancelled. Type /upload to start again.');
});

bot.command('upload', async (ctx) => {
  ctx.session.upload = { step: 'subject' };
  await promptNodeChoice(ctx, 'subject', null);
});

bot.command('done', async (ctx) => {
  const s = ctx.session.upload;
  if (s.step !== 'files') {
    await ctx.reply('Nothing to finish. Type /upload to start.');
    return;
  }
  const count = s.uploadedCount ?? 0;
  ctx.session.upload = { step: 'idle' };
  await ctx.reply(
    count > 0
      ? `✅ Upload complete! ${count} file(s) saved.`
      : 'No files were uploaded. Type /upload to try again.'
  );
});

// ─── File intake (only meaningful in the 'files' step) ───────────────────────

bot.on(['message:document', 'message:photo'], async (ctx) => {
  const s = ctx.session.upload;
  if (s.step !== 'files' || !s.chapterId || !s.tab) {
    await ctx.reply('Please start with /upload and choose a category first.');
    return;
  }

  const doc = ctx.message.document;
  const photo = ctx.message.photo;
  let fileName: string;
  let fileId: string;
  let type: 'pdf' | 'image';

  if (doc) {
    fileName = doc.file_name ?? `file-${doc.file_id}.bin`;
    fileId = doc.file_id;
    if (doc.mime_type?.includes('pdf')) type = 'pdf';
    else if (doc.mime_type?.startsWith('image/')) type = 'image';
    else {
      await ctx.reply('Only PDF or image files are supported. Please send a PDF or image, or /done.');
      return;
    }
  } else if (photo && photo.length > 0) {
    const largest = photo[photo.length - 1];
    fileId = largest.file_id;
    fileName = `photo-${largest.file_id}.jpg`;
    type = 'image';
  } else {
    return;
  }

  try {
    const saved = await saveFile(ctx, fileId, fileName, s.chapterId, s.tab, type);
    s.uploadedCount = (s.uploadedCount ?? 0) + 1;
    await ctx.reply(`✅ Saved: ${saved.original_name}\n\nSend more, or type /done to finish.`);
  } catch (err) {
    await ctx.reply(`❌ Failed to save file: ${(err as Error).message}`);
  }
});

// ─── Text handling drives the state machine ──────────────────────────────────

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return; // commands handled above
  const s = ctx.session.upload;

  switch (s.step) {
    case 'subject': {
      const id = await handleNodePick(ctx, 'subject', null);
      if (id !== null) {
        s.subjectId = id;
        s.step = 'subcategory';
        await promptNodeChoice(ctx, 'subcategory', id);
      }
      break;
    }

    case 'subcategory': {
      const id = await handleNodePick(ctx, 'subcategory', s.subjectId!);
      if (id !== null) {
        s.subcategoryId = id;
        s.step = 'chapter';
        await promptNodeChoice(ctx, 'chapter', id);
      }
      break;
    }

    case 'chapter': {
      const id = await handleNodePick(ctx, 'chapter', s.subcategoryId!);
      if (id !== null) {
        s.chapterId = id;
        s.step = 'tab';
        await ctx.reply('Which tab should these files go in?\n\n1 = MCQ\n2 = Question-Answer');
      }
      break;
    }

    case 'tab': {
      const tab = text === '1' ? 'mcq' : text === '2' ? 'qa' : null;
      if (!tab) {
        await ctx.reply('Please reply 1 (MCQ) or 2 (Question-Answer).');
        return;
      }
      s.tab = tab;
      s.step = 'files';
      s.uploadedCount = 0;
      await ctx.reply(
        `Great! Now send PDF or image files for the *${tab.toUpperCase()}* tab.\n\nSend them one by one. When finished, type /done.`,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    case 'files':
      await ctx.reply('Send a PDF or image file, or type /done to finish.');
      break;

    default:
      await ctx.reply('Type /upload to start uploading materials.');
  }
});

bot.catch((err) => {
  console.error('[bot] error:', err.error);
});

// Called by the web server after it is listening. Starts long polling only when
// a real token is configured; otherwise logs and no-ops so the web app still runs.
export function startBot(): void {
  if (!config.telegramBotToken) {
    console.warn('[bot] TELEGRAM_BOT_TOKEN not set — Telegram bot disabled. Web app runs normally.');
    return;
  }
  // Do not await: bot.start() resolves only when polling stops.
  bot.start({
    onStart: (info) => console.log(`[bot] Telegram bot started as @${info.username}. Waiting for teacher uploads...`),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function listNodes(kind: string, parentId: number | null): { id: number; name: string }[] {
  if (parentId === null) {
    return db
      .prepare('SELECT id, name FROM nodes WHERE kind=? AND parent_id IS NULL ORDER BY sort_order, name')
      .all(kind) as { id: number; name: string }[];
  }
  return db
    .prepare('SELECT id, name FROM nodes WHERE kind=? AND parent_id=? ORDER BY sort_order, name')
    .all(kind, parentId) as { id: number; name: string }[];
}

const KIND_LABEL: Record<string, string> = {
  subject: 'Subject',
  subcategory: 'Sub-category',
  chapter: 'Chapter',
};

/** Show the list of existing nodes (or prompt to create the first one). */
async function promptNodeChoice(
  ctx: BotContext,
  kind: 'subject' | 'subcategory' | 'chapter',
  parentId: number | null
) {
  const existing = listNodes(kind, parentId);
  const label = KIND_LABEL[kind];
  ctx.session.upload.options = existing;
  ctx.session.upload.awaitingNewName = existing.length === 0;

  if (existing.length === 0) {
    await ctx.reply(`No ${label}s exist yet. Type a name to create the first ${label}:`);
    return;
  }

  const list = existing.map((n, i) => `${i + 1}. ${n.name}`).join('\n');
  await ctx.reply(
    `Choose a ${label} by number, or type "new" to create one:\n\n${list}`
  );
}

/**
 * Interpret a text reply during a node-selection step. Returns the resolved node
 * id (existing or newly created), or null if the step should stay put and re-prompt.
 */
async function handleNodePick(
  ctx: BotContext,
  kind: 'subject' | 'subcategory' | 'chapter',
  parentId: number | null
): Promise<number | null> {
  const text = ctx.message!.text!.trim();
  const s = ctx.session.upload;
  const label = KIND_LABEL[kind];

  // If we're waiting for a new name (either "new" was typed, or none existed).
  if (s.awaitingNewName) {
    const name = text.slice(0, 80);
    if (!name) {
      await ctx.reply(`Please type a valid ${label} name.`);
      return null;
    }
    const id = createNode(kind, name, parentId);
    s.awaitingNewName = false;
    await ctx.reply(`Created ${label}: ${name}`);
    return id;
  }

  if (text.toLowerCase() === 'new') {
    s.awaitingNewName = true;
    await ctx.reply(`Type the new ${label} name:`);
    return null;
  }

  const idx = parseInt(text, 10) - 1;
  const options = s.options ?? [];
  if (idx >= 0 && idx < options.length) {
    return options[idx].id;
  }

  await ctx.reply(`Invalid choice. Reply with a number from the list, or type "new".`);
  return null;
}

function createNode(kind: string, name: string, parentId: number | null): number {
  const now = Date.now();
  const info = db
    .prepare('INSERT INTO nodes (parent_id, kind, name, sort_order, created_at) VALUES (?, ?, ?, 0, ?)')
    .run(parentId, kind, name, now);
  return Number(info.lastInsertRowid);
}

/** Download a Telegram file, save to storage/, extract PDF text, insert asset row. */
async function saveFile(
  ctx: BotContext,
  fileId: string,
  originalName: string,
  chapterId: number,
  tab: 'mcq' | 'qa',
  type: 'pdf' | 'image'
): Promise<{ id: number; original_name: string }> {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) throw new Error('No file path from Telegram.');

  // Telegram download URLs are valid ~1 hour; download immediately.
  const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);
  const buffer = Buffer.from(await response.arrayBuffer());

  const sanitized = basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const fileName = `${Date.now()}-${sanitized}`;
  const relPath = join(tab, fileName);
  const absDir = join(config.storageDir, tab);
  await mkdir(absDir, { recursive: true });
  await writeFile(join(config.storageDir, relPath), buffer);

  let extractedText: string | null = null;
  if (type === 'pdf') {
    const extracted = await extractPdf(join(config.storageDir, relPath));
    extractedText = extracted.text || null;
  }

  const now = Date.now();
  const info = db
    .prepare(
      'INSERT INTO assets (chapter_id, tab, type, file_path, original_name, extracted_text, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(chapterId, tab, type, relPath, originalName, extractedText, now);

  return { id: Number(info.lastInsertRowid), original_name: originalName };
}
