// Full-text translation helpers. Pure: chunking, prompts, answer parsing and content keys.
import { isPageMarker } from './reflow.js';

// Stable key for a paragraph's content so a translation survives re-extraction and re-pasting.
export function textKey(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0') + ':' + s.length;
}

// Paragraphs worth sending: skip page markers, bare numbers and text with no Latin letters.
export function translatable(text) {
  const t = String(text || '').trim();
  if (!t || isPageMarker(t)) return false;
  if (!/[A-Za-z]{2}/.test(t)) return false;
  if ((t.match(/[A-Za-z]/g) || []).length < 6) return false;
  return true;
}

export function chunkParagraphs(paras, maxChars = 2200) {
  const chunks = [];
  let cur = [], size = 0;
  for (const p of paras) {
    if (cur.length && size + p.text.length > maxChars) { chunks.push(cur); cur = []; size = 0; }
    cur.push(p); size += p.text.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export const TRANSLATE_SYSTEM_NOTE = '现在做整篇论文的逐段翻译：输入是带编号的段落，逐段翻译成中文，每段以同样的编号开头，格式为「[n] 译文」，段与段之间空一行。段落一一对应，不要合并、拆分或省略任何一段；标题行同样翻译；参考文献条目只翻译标题可以省略作者。';

export function chunkPrompt(chunk) {
  return `逐段翻译下面 ${chunk.length} 段：\n\n` + chunk.map((p, i) => `[${i + 1}] ${p.text}`).join('\n\n');
}

// Returns an array of length n; entries are the translated text or null when missing.
export function parseChunkAnswer(answer, n) {
  const out = new Array(n).fill(null);
  const re = /^\s*[\[【]\s*(\d+)\s*[\]】]\s*/gm;
  const text = String(answer || '').replace(/\r\n?/g, '\n');
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ idx: Number(m[1]), start: m.index, bodyStart: m.index + m[0].length });
  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].start : text.length;
    const body = text.slice(mk.bodyStart, end).trim();
    if (mk.idx >= 1 && mk.idx <= n && body && out[mk.idx - 1] == null) out[mk.idx - 1] = body;
  });
  if (!marks.length && n === 1 && text.trim()) out[0] = text.trim();
  return out;
}
