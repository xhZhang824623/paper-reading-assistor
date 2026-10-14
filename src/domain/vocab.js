// Vocabulary book helpers. Pure module. English knowledge items are the vocabulary book; each item
// keeps every sentence it was met in (contexts) so a word can be traced back to its papers.
import { newKnowledge } from '../state/schema.js';
import { scheduleFirstReview } from './review.js';
import { isSingleWordTerm } from './knowledge.js';

// The sentence inside `context` that contains `quote` (falls back to a window around it).
export function sentenceAround(context, quote) {
  const ctx = String(context || '').replace(/\s+/g, ' ').trim();
  const q = String(quote || '').trim();
  if (!ctx) return q;
  const parts = ctx.split(/(?<=[.!?。！？])\s+(?=[A-Z0-9("\[])/);
  const hit = parts.find(p => q && p.toLowerCase().includes(q.toLowerCase()));
  if (hit && hit.length <= 400) return hit.trim();
  const i = q ? ctx.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i === -1) return ctx.slice(0, 200);
  return ctx.slice(Math.max(0, i - 120), Math.min(ctx.length, i + q.length + 120)).trim();
}

export function findVocab(state, term) {
  const t = String(term || '').trim().toLowerCase();
  return state.knowledge.find(k => (k.kind === 'word' || k.kind === 'phrase' || k.kind === 'english') && String(k.term || '').trim().toLowerCase() === t) || null;
}

// Add a word (or phrase) to the vocabulary book, or attach a new context to the existing entry.
// Returns { item, created }.
export function addToVocab(state, { term, meaning = '', phonetic = '', paperId, sentence = '', page = null, sourceEventId = null, schedule = true, now = new Date().toISOString() }) {
  const t = String(term || '').trim();
  if (!t) return { item: null, created: false };
  const ctx = sentence ? { paperId, sentence: sentence.slice(0, 400), page, at: now } : null;
  const existing = findVocab(state, t);
  if (existing) {
    existing.contexts = Array.isArray(existing.contexts) ? existing.contexts : [];
    if (ctx && !existing.contexts.some(c => c.sentence === ctx.sentence)) existing.contexts.push(ctx);
    if (!existing.meaning && meaning) existing.meaning = meaning;
    if (!existing.phonetic && phonetic) existing.phonetic = phonetic;
    return { item: existing, created: false };
  }
  let item = newKnowledge({ kind: isSingleWordTerm(t) ? 'word' : 'phrase', term: t, meaning, phonetic, paperId, sourceEventId, sourceQuote: sentence.slice(0, 400), example: '', contexts: ctx ? [ctx] : [], createdAt: now });
  if (schedule) item = scheduleFirstReview(item, now);
  state.knowledge.push(item);
  return { item, created: true };
}

// Words looked up recently that are not in the vocabulary book yet, most frequent first.
export function recentLookups(state, limit = 40) {
  const counts = new Map();
  for (const e of state.events) {
    if (e.action !== 'translate' || !e.quote) continue;
    const q = e.quote.trim();
    if (q.length > 40 || q.split(/\s+/).length > 4) continue;
    const key = q.toLowerCase();
    if (state.knowledge.some(k => String(k.term || '').trim().toLowerCase() === key)) continue;
    const cur = counts.get(key) || { term: q, count: 0, paperId: e.paperId, at: e.at, meaning: '' };
    cur.count++; if (e.at > cur.at) { cur.at = e.at; cur.paperId = e.paperId; }
    if (!cur.meaning && e.response) cur.meaning = String(e.response).split('\n')[0].slice(0, 80);
    counts.set(key, cur);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || b.at.localeCompare(a.at)).slice(0, limit);
}
