// Runs a full-text translation in chunks with the current provider's fast model.
import { streamAnswer } from '../ai/adapter.js';
import { translatorPrompt } from '../ai/prompts.js';
import { chunkParagraphs, chunkPrompt, parseChunkAnswer, TRANSLATE_SYSTEM_NOTE } from '../domain/translate.js';

// paragraphs: [{ key, text }] still untranslated. onResult receives [[key, zh], ...] per finished chunk.
// Resolves { ok, model, provider, done, error, aborted }.
export function translateParagraphs({ settings, paragraphs, onResult, onProgress, concurrency = 3, maxChars = 2200 }) {
  const controller = new AbortController();
  const chunks = chunkParagraphs(paragraphs, maxChars);
  let next = 0, done = 0, model = '', provider = '', error = null;
  const system = translatorPrompt(settings) + ' ' + TRANSLATE_SYSTEM_NOTE;

  async function translateChunk(chunk, retry = true) {
    const r = await streamAnswer({ settings, user: chunkPrompt(chunk), system, effort: 'low', fast: true, maxTokens: 6000, signal: controller.signal });
    if (!r.ok) throw Object.assign(new Error(r.error || '翻译失败'), { aborted: r.aborted });
    model = r.model || model; provider = r.provider || provider;
    const parts = parseChunkAnswer(r.text, chunk.length);
    const results = [];
    const missing = [];
    chunk.forEach((p, i) => { if (parts[i]) results.push([p.key, parts[i]]); else missing.push(p); });
    if (results.length) { done += results.length; onResult(results); }
    if (missing.length && retry && !controller.signal.aborted) {
      // Ask again for the paragraphs the model skipped, one chunk, no further retry.
      for (const sub of chunkParagraphs(missing, maxChars)) await translateChunk(sub, false);
    }
  }

  async function worker() {
    while (next < chunks.length && !controller.signal.aborted && !error) {
      const chunk = chunks[next++];
      try { await translateChunk(chunk); }
      catch (err) { error = err; break; }
      if (onProgress) onProgress(done, paragraphs.length);
    }
  }

  const promise = (async () => {
    await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
    if (error) return { ok: false, error: error.message, aborted: !!error.aborted || controller.signal.aborted, model, provider, done };
    return { ok: !controller.signal.aborted, aborted: controller.signal.aborted, model, provider, done };
  })();
  return { promise, abort: () => controller.abort() };
}
