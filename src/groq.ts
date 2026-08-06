import OpenAI from 'openai';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { config } from './config.js';

/**
 * Groq is OpenAI-API-compatible, so we use the official OpenAI SDK pointed at
 * Groq's base URL. The API key stays server-side — it is never sent to browsers.
 */
const client = new OpenAI({
  apiKey: config.groqApiKey || 'missing-key',
  baseURL: config.groqBaseUrl,
});

// Resolved at boot from the live model list (see resolveModels()).
let resolvedTextModel = config.groqTextModels[0];
let resolvedVisionModel = config.groqVisionModels[0];
let modelsResolved = false;

/**
 * Query Groq's live model list and pick the first configured model (text +
 * vision) that is actually available. Groq deprecates models often, so this
 * keeps us resilient without code changes. Falls back to the first configured
 * id if the list can't be fetched.
 */
export async function resolveModels(): Promise<void> {
  if (!config.groqApiKey) {
    console.warn('[groq] No GROQ_API_KEY set — AI features will return an error until configured.');
    return;
  }
  try {
    const list = await client.models.list();
    const liveIds = new Set(list.data.map((m) => m.id));

    const pickedText = config.groqTextModels.find((m) => liveIds.has(m));
    const pickedVision = config.groqVisionModels.find((m) => liveIds.has(m));

    if (pickedText) resolvedTextModel = pickedText;
    else console.warn(`[groq] None of the configured text models are live; using fallback "${resolvedTextModel}". Live: ${[...liveIds].join(', ')}`);

    if (pickedVision) resolvedVisionModel = pickedVision;
    else console.warn(`[groq] None of the configured vision models are live; image AI may fail. Using "${resolvedVisionModel}".`);

    modelsResolved = true;
    console.log(`[groq] Using text model "${resolvedTextModel}", vision model "${resolvedVisionModel}".`);
  } catch (err) {
    console.warn('[groq] Could not fetch live model list; using first configured models.', (err as Error).message);
  }
}

export function getModels() {
  return { text: resolvedTextModel, vision: resolvedVisionModel, resolved: modelsResolved };
}

export function isConfigured(): boolean {
  return Boolean(config.groqApiKey);
}

const SYSTEM_PROMPT =
  'You are a friendly study assistant for school students. Answer questions about the ' +
  'provided document or image clearly and simply, at a level a student can understand. ' +
  'If the answer is not in the provided content, say so honestly rather than guessing. ' +
  'Keep explanations concise and use simple examples where helpful.';

/** Cap how much PDF text we stuff into the prompt (keeps us within context + cost). */
const MAX_DOC_CHARS = 40_000;

export type StreamHandlers = {
  onToken: (token: string) => void;
  onDone: (fullText: string) => void;
  onError: (message: string) => void;
};

/**
 * Ask a question about a PDF's extracted text. Streams the answer token-by-token.
 */
export async function streamTextQuestion(
  documentText: string,
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  handlers: StreamHandlers
): Promise<void> {
  if (!isConfigured()) return handlers.onError('AI is not configured on the server.');

  const doc = (documentText || '').slice(0, MAX_DOC_CHARS);
  const context = doc
    ? `Here is the document content the student is asking about:\n\n"""\n${doc}\n"""`
    : 'No text could be extracted from this document. Answer from general knowledge if possible, and say the document text was unavailable.';

  try {
    const stream = await client.chat.completions.create({
      model: resolvedTextModel,
      stream: true,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'system', content: context },
        ...history,
        { role: 'user', content: question },
      ],
    });
    await pump(stream, handlers);
  } catch (err) {
    handlers.onError(friendlyError(err));
  }
}

/**
 * Ask a question about an image. Sends the image as a base64 data URL to the
 * vision model. Streams the answer.
 */
export async function streamImageQuestion(
  imagePath: string,
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  handlers: StreamHandlers
): Promise<void> {
  if (!isConfigured()) return handlers.onError('AI is not configured on the server.');

  let dataUrl: string;
  try {
    dataUrl = await imageToDataUrl(imagePath);
  } catch (err) {
    return handlers.onError('Could not read the image file.');
  }

  try {
    const stream = await client.chat.completions.create({
      model: resolvedVisionModel,
      stream: true,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        // Vision history is kept text-only to stay simple and within limits.
        ...history,
        {
          role: 'user',
          content: [
            { type: 'text', text: question },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    });
    await pump(stream, handlers);
  } catch (err) {
    handlers.onError(friendlyError(err));
  }
}

/** Read an image file and return a base64 data URL Groq can accept. */
async function imageToDataUrl(imagePath: string): Promise<string> {
  const buf = await readFile(imagePath);
  const ext = extname(imagePath).toLowerCase().replace('.', '') || 'jpeg';
  const mime =
    ext === 'jpg' ? 'jpeg' : ext === 'png' || ext === 'webp' || ext === 'gif' ? ext : 'jpeg';
  return `data:image/${mime};base64,${buf.toString('base64')}`;
}

/** Drain an OpenAI streaming completion into the handlers. */
async function pump(
  stream: AsyncIterable<any>,
  handlers: StreamHandlers
): Promise<void> {
  let full = '';
  try {
    for await (const chunk of stream) {
      const token = chunk?.choices?.[0]?.delta?.content ?? '';
      if (token) {
        full += token;
        handlers.onToken(token);
      }
    }
    handlers.onDone(full);
  } catch (err) {
    handlers.onError(friendlyError(err));
  }
}

function friendlyError(err: unknown): string {
  const msg = (err as Error)?.message || String(err);
  if (/model/i.test(msg) && /(decommission|not found|does not exist|deprecat)/i.test(msg)) {
    return 'The AI model is temporarily unavailable. Please try again shortly.';
  }
  console.error('[groq] request error:', msg);
  return 'The AI had a problem answering. Please try again.';
}
