import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRecall, scheduleFirstReview, dueItems, INTERVALS_DAYS, openQuestions } from '../src/domain/review.js';
import { mergeImport, exportJSON } from '../src/domain/export.js';
import { heatmap, lastNDays } from '../src/domain/stats.js';
import { emptyState } from '../src/state/schema.js';

const now = '2026-10-13T08:00:00.000Z';

test('first review is scheduled one day out', () => {
  const k = scheduleFirstReview({ id: 'k', status: 'new', reviewCount: 0 }, now);
  assert.equal(k.status, 'learning');
  assert.equal(k.nextReviewAt, '2026-10-14T08:00:00.000Z');
});

test('recall progression reaches known after all intervals; failure resets', () => {
  let k = scheduleFirstReview({ id: 'k', status: 'new', reviewCount: 0 }, now);
  for (let i = 1; i < INTERVALS_DAYS.length; i++) {
    k = applyRecall(k, true, now);
    assert.equal(k.reviewCount, i);
    assert.equal(k.status, 'learning');
  }
  k = applyRecall(k, true, now);
  assert.equal(k.status, 'known');
  assert.equal(k.nextReviewAt, null);
  const reset = applyRecall(k, false, now);
  assert.equal(reset.reviewCount, 0);
  assert.equal(reset.status, 'learning');
});

test('dueItems only returns items whose time has come', () => {
  const items = [
    { id: 'a', status: 'learning', nextReviewAt: '2026-10-12T00:00:00Z' },
    { id: 'b', status: 'learning', nextReviewAt: '2026-10-20T00:00:00Z' },
    { id: 'c', status: 'known', nextReviewAt: '2026-10-01T00:00:00Z' },
    { id: 'd', status: 'new', nextReviewAt: null },
  ];
  assert.deepEqual(dueItems(items, now).map(x => x.id), ['a']);
});

test('openQuestions collects unclear events and unresolved question notes', () => {
  const s = emptyState();
  s.events.push({ id: 'e', paperId: 'p', feedback: 'unclear', quote: 'what', at: now });
  s.notes.push({ id: 'n', paperId: 'p', type: 'question', text: 'why', resolved: false, at: now });
  s.notes.push({ id: 'n2', paperId: 'p', type: 'question', text: 'done', resolved: true, at: now });
  assert.deepEqual(openQuestions(s).map(q => q.id).sort(), ['e', 'n']);
});

test('mergeImport adds only new records and flags papers without local PDFs', () => {
  const s = emptyState();
  s.papers.push({ id: 'p1', title: 'Mine', hasPdf: true });
  const backup = { schemaVersion: 2, papers: [{ id: 'p1', title: 'Theirs', hasPdf: true }, { id: 'p2', title: 'New', hasPdf: true }], events: [{ id: 'e1', paperId: 'p2', at: now }], notes: [], knowledge: [], sessions: [], reviews: { p2: { human: { summary: 's' } } } };
  const { state, added } = mergeImport(s, backup);
  assert.equal(added.papers, 1);
  assert.equal(added.events, 1);
  assert.equal(added.reviews, 1);
  assert.equal(state.papers.find(p => p.id === 'p1').title, 'Mine');
  assert.equal(state.papers.find(p => p.id === 'p2').hasPdf, false);
});

test('heatmap covers whole weeks and marks future days', () => {
  const h = heatmap({ '2026-10-13': 2, '2026-10-01': 12 }, '2026-10-13', 26);
  assert.equal(h.cells.length, 26 * 7);
  assert.equal(h.end, '2026-10-18');
  assert.equal(h.activeDays, 2);
  assert.ok(h.cells.find(c => c.key === '2026-10-14').future);
  assert.equal(h.cells.find(c => c.key === '2026-10-01').level, 4);
  assert.equal(lastNDays({ '2026-10-13': 1 }, '2026-10-13', 3).map(d => d.key).join(','), '2026-10-11,2026-10-12,2026-10-13');
});

test('exportJSON strips API keys from every provider', () => {
  const s = emptyState();
  s.settings.ai.providers.anthropic.apiKey = 'secret-a';
  s.settings.ai.providers.deepseek.apiKey = 'secret-d';
  const out = exportJSON(s);
  assert.ok(!out.includes('secret-a') && !out.includes('secret-d'));
  assert.ok(JSON.parse(out).settings.ai.providers.deepseek.baseUrl);
});
