import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateV1, migrate, splitTags } from '../src/state/migrate.js';
import { SCHEMA_VERSION } from '../src/state/schema.js';

const v1 = {
  papers: [
    { id: 'demo', title: 'Demo', category: '医学影像', status: 'Reading', doi: '', tags: 'Domain shift, Segmentation', demo: true, created: '2026-10-01T00:00:00Z' },
    { id: 'p1', title: 'Real paper', fileName: 'real.pdf', size: 10, hash: 'abc', category: '未分类', status: 'Completed', doi: '10.1/x', tags: ['a', 'b'], demo: false, created: '2026-10-02T00:00:00Z', excerpt: 'Some pasted text.' },
  ],
  notes: [{ id: 'n1', paperId: 'p1', type: 'highlight', quote: 'pasted', paragraph: 0, anchor: '粘贴片段', text: '', at: '2026-10-02T01:00:00Z' }],
  events: [
    { id: 'e1', paperId: 'demo', action: 'explain', quote: 'q', paragraph: 0, scope: 'selection', at: '2026-10-02T02:00:00Z', response: 'r', feedback: '仍不理解', demo: true, execution: 'demo' },
    { id: 'e2', paperId: 'p1', action: 'translate', quote: 'q2', paragraph: 0, scope: 'selection', at: '2026-10-02T03:00:00Z', response: 'r2', feedback: '未确认', demo: false, execution: 'unavailable' },
    { id: 'e3', paperId: 'p1', action: 'complete', quote: '本次阅读结束', paragraph: 0, scope: 'paper', at: '2026-10-02T04:00:00Z', response: '', feedback: '未确认', demo: false },
    { id: 'e4', paperId: 'gone', action: 'ask', quote: 'x', at: '2026-10-02T05:00:00Z' },
  ],
  reviews: { p1: { ai: null, human: { paper: 'My summary', technical: 'tech text', english: '' }, humanSavedAt: '2026-10-02T06:00:00Z' } },
  current: 'demo', readingCurrent: 'p1',
  profile: { name: 'X', research: 'AI' }, preferences: { theme: 'warm', font: 'large' },
  readerLayout: { assistantWidth: 400, assistantVisible: false, sidebarCollapsed: true },
};

test('splitTags handles strings and arrays', () => {
  assert.deepEqual(splitTags('a, b；c'), ['a', 'b', 'c']);
  assert.deepEqual(splitTags(['x ', '']), ['x']);
});

test('migrateV1 maps papers, statuses and tags', () => {
  const s = migrateV1(v1);
  assert.equal(s.schemaVersion, SCHEMA_VERSION);
  assert.equal(s.papers.length, 2);
  const p1 = s.papers.find(p => p.id === 'p1');
  assert.equal(p1.status, 'read');
  assert.equal(p1.hasPdf, true);
  assert.deepEqual(p1.tags, ['a', 'b']);
  assert.equal(p1.excerptText, 'Some pasted text.');
  assert.equal(s.papers.find(p => p.id === 'demo').status, 'reading');
  assert.deepEqual(s.papers.find(p => p.id === 'demo').tags, ['Domain shift', 'Segmentation']);
  assert.ok(s.papers.find(p => p.id === 'demo').excerptText.includes('Domain shift refers'));
  assert.equal(s.papers.find(p => p.id === 'demo').readerView, 'text');
});

test('migrateV1 maps events, drops orphans and keeps feedback', () => {
  const s = migrateV1(v1);
  assert.equal(s.events.length, 3);
  assert.equal(s.events.find(e => e.id === 'e1').feedback, 'unclear');
  assert.equal(s.events.find(e => e.id === 'e1').status, 'demo');
  assert.equal(s.events.find(e => e.id === 'e2').status, 'unavailable');
  assert.equal(s.events.find(e => e.id === 'e3').action, 'session_end');
});

test('migrateV1 keeps notes with legacy anchors and reviews with legacy text', () => {
  const s = migrateV1(v1);
  assert.equal(s.notes.length, 1);
  assert.equal(s.notes[0].anchor.kind, 'text');
  assert.equal(s.notes[0].anchor.paragraph, 0);
  assert.equal(s.reviews.p1.human.summary, 'My summary');
  assert.equal(s.reviews.p1.legacy.technical, 'tech text');
  assert.equal(s.reviews.p1.savedAt, '2026-10-02T06:00:00Z');
});

test('migrateV1 maps settings, layout and current paper', () => {
  const s = migrateV1(v1);
  assert.equal(s.settings.name, 'X');
  assert.equal(s.settings.theme, 'warm');
  assert.equal(s.settings.fontSize, 'large');
  assert.equal(s.layout.assistantWidth, 400);
  assert.equal(s.layout.assistantVisible, false);
  assert.equal(s.current.paperId, 'p1');
});

test('migrate passes v2 through normalize and rejects newer schemas', () => {
  const s = migrate({ schemaVersion: SCHEMA_VERSION, papers: [{ id: 'a', title: 'A' }], events: [{ id: 'x', paperId: 'zzz' }] });
  assert.equal(s.papers[0].status, 'inbox');
  assert.equal(s.events.length, 0);
  assert.throws(() => migrate({ schemaVersion: 99, papers: [] }));
  assert.equal(migrate(null), null);
});

test('normalize moves the old flat AI settings into the anthropic provider slot', () => {
  const s = migrate({ schemaVersion: SCHEMA_VERSION, papers: [], settings: { ai: { enabled: true, provider: 'anthropic', apiKey: 'k1', model: 'claude-sonnet-5-5', baseUrl: 'http://localhost:8090', effort: 'high' } } });
  assert.equal(s.settings.ai.enabled, true);
  assert.equal(s.settings.ai.effort, 'high');
  assert.equal(s.settings.ai.providers.anthropic.apiKey, 'k1');
  assert.equal(s.settings.ai.providers.anthropic.model, 'claude-sonnet-5-5');
  assert.equal(s.settings.ai.providers.anthropic.baseUrl, 'http://localhost:8090');
  assert.equal(s.settings.ai.providers.deepseek.baseUrl, 'https://api.deepseek.com');
  assert.equal(s.settings.ai.apiKey, undefined);
  const s2 = migrate({ schemaVersion: SCHEMA_VERSION, papers: [], settings: { ai: { enabled: true, provider: 'deepseek', providers: { deepseek: { apiKey: 'd1', model: 'deepseek-reasoner' } } } } });
  assert.equal(s2.settings.ai.provider, 'deepseek');
  assert.equal(s2.settings.ai.providers.deepseek.apiKey, 'd1');
  assert.equal(s2.settings.ai.providers.anthropic.model, 'claude-opus-5-5');
  const s3 = migrate({ schemaVersion: SCHEMA_VERSION, papers: [], settings: { ai: { provider: 'nope' } } });
  assert.equal(s3.settings.ai.provider, 'anthropic');
});
