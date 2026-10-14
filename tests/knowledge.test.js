import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDefinition, parseGlossary, migrateKind, isSingleWordTerm, conceptTerm, findByTerm } from '../src/domain/knowledge.js';
import { migrate } from '../src/state/migrate.js';
import { SCHEMA_VERSION } from '../src/state/schema.js';

test('extractDefinition prefers the 一句话 section and strips markdown', () => {
  const r = '## 一句话\n**Scaffold** 是生成分子时先搭出来的 $T$ 骨架（第 2 页）。\n\n## 直观理解\n很长的内容';
  assert.equal(extractDefinition(r), 'Scaffold 是生成分子时先搭出来的 T 骨架（第 2 页）。');
  assert.equal(extractDefinition('第一段很短。\n\n第二段'), '第一段很短。');
});

test('parseGlossary reads the glossary section of a summary', () => {
  const r = '## 实验\n- 数字\n## 术语表\n- **junction tree**：把分子拆成簇后连成的树。\n- SMILES: 线性字符串表示。\n* **junction tree**：重复项\n## 读完检验\n1. 问题';
  assert.deepEqual(parseGlossary(r), [{ term: 'junction tree', meaning: '把分子拆成簇后连成的树。' }, { term: 'SMILES', meaning: '线性字符串表示。' }]);
  assert.deepEqual(parseGlossary('没有术语表'), []);
});

test('old english items split into word and phrase on migration', () => {
  assert.equal(migrateKind({ kind: 'english', term: 'scaffold' }).kind, 'word');
  assert.equal(migrateKind({ kind: 'english', term: 'is chosen to be' }).kind, 'phrase');
  assert.ok(isSingleWordTerm("state-of-the-art"));
  const s = migrate({ schemaVersion: SCHEMA_VERSION, papers: [{ id: 'p', title: 'P' }], knowledge: [{ id: 'k1', paperId: 'p', kind: 'english', term: 'coarse' }, { id: 'k2', paperId: 'p', kind: 'english', term: 'in this sense' }, { id: 'k3', paperId: 'p', kind: 'concept', term: 'VAE' }] });
  assert.deepEqual(s.knowledge.map(k => k.kind), ['word', 'phrase', 'concept']);
  assert.equal(s.knowledge[0].note, '');
});

test('parseGlossary also reads tables and bold terms with parentheses', () => {
  const r = '## 术语表\n| 术语 | 解释 |\n|---|---|\n| VAE | 变分自编码器 |\n- **junction tree（联结树）**：把分子拆成簇后连成的树。\n- scaffold — 骨架。\n这一行没有分隔符\n## 下一节\n- x: y';
  assert.deepEqual(parseGlossary(r), [{ term: 'VAE', meaning: '变分自编码器' }, { term: 'junction tree（联结树）', meaning: '把分子拆成簇后连成的树。' }, { term: 'scaffold', meaning: '骨架。' }]);
});

test('conceptTerm prefers a short quote, then the first bold term, then the question', () => {
  assert.equal(conceptTerm({ action: 'explain', quote: 'junction tree.', response: '**Scaffold** is' }), 'junction tree');
  assert.equal(conceptTerm({ action: 'explain', quote: 'a'.repeat(80), response: '## 一句话\n**teacher forcing** 是…' }), 'teacher forcing');
  assert.equal(conceptTerm({ action: 'ask', quote: 'short', question: '什么是 KL？', response: '**KL 散度**：…' }), 'KL 散度');
  assert.equal(conceptTerm({ action: 'ask', question: '什么是 KL？', response: 'no bold' }), '什么是 KL？');
  assert.equal(conceptTerm({ action: 'ask', question: 'q'.repeat(70), response: '' }), '');
});

test('findByTerm ignores case, spacing and a trailing parenthetical', () => {
  const state = { knowledge: [{ kind: 'concept', term: 'Junction Tree' }, { kind: 'word', term: 'scaffold' }] };
  assert.ok(findByTerm(state, 'junction tree（联结树）', ['concept']));
  assert.ok(findByTerm(state, 'junction  tree'));
  assert.equal(findByTerm(state, 'scaffold', ['concept']), null);
  assert.equal(findByTerm(state, ''), null);
});
