import test from 'node:test';
import assert from 'node:assert/strict';
import { sentenceAround, addToVocab, findVocab, recentLookups } from '../src/domain/vocab.js';
import { emptyState } from '../src/state/schema.js';

test('sentenceAround picks the sentence containing the word', () => {
  const ctx = 'We seek to automate design. Deviating from prior work, we build graphs. This is the end.';
  assert.equal(sentenceAround(ctx, 'Deviating'), 'Deviating from prior work, we build graphs.');
  assert.equal(sentenceAround('', 'x'), 'x');
});

test('addToVocab creates once and appends contexts afterwards', () => {
  const s = emptyState();
  const a = addToVocab(s, { term: 'scaffold', meaning: 'n. 脚手架', phonetic: 'x', paperId: 'p1', sentence: 'a tree-structured scaffold', page: 1, now: '2026-10-13T00:00:00.000Z' });
  assert.equal(a.created, true);
  assert.equal(a.item.status, 'learning');
  assert.equal(a.item.contexts.length, 1);
  const b = addToVocab(s, { term: 'Scaffold', paperId: 'p2', sentence: 'another scaffold sentence', page: 3 });
  assert.equal(b.created, false);
  assert.equal(s.knowledge.length, 1);
  assert.equal(b.item.contexts.length, 2);
  assert.equal(findVocab(s, 'SCAFFOLD').term, 'scaffold');
});

test('recentLookups counts short translate events not yet in the book', () => {
  const s = emptyState();
  s.events.push({ action: 'translate', quote: 'coarse', paperId: 'p1', at: '2026-10-13T01:00:00Z', response: '粗糙的' });
  s.events.push({ action: 'translate', quote: 'coarse', paperId: 'p2', at: '2026-10-13T02:00:00Z', response: '粗糙的' });
  s.events.push({ action: 'translate', quote: 'a long sentence that is clearly not a word at all here', paperId: 'p1', at: '2026-10-13T03:00:00Z' });
  s.events.push({ action: 'translate', quote: 'scaffold', paperId: 'p1', at: '2026-10-13T04:00:00Z' });
  addToVocab(s, { term: 'scaffold', paperId: 'p1' });
  const r = recentLookups(s);
  assert.deepEqual(r.map(x => [x.term, x.count, x.paperId]), [['coarse', 2, 'p2']]);
});
