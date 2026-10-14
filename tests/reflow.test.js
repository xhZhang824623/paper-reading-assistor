import test from 'node:test';
import assert from 'node:assert/strict';
import { reflowPage, composePages, reflowLines } from '../src/domain/reflow.js';
import { textKey, translatable, chunkParagraphs, parseChunkAnswer, chunkPrompt } from '../src/domain/translate.js';

test('reflowPage joins wrapped lines, keeps headings and breaks on short final lines', () => {
  const page = ['2 Related Work', 'We seek to automate the design of molecules based on', 'specific chemical properties. In computational terms, this', 'task involves continuous embedding and generation of molec-', 'ular graphs. Our contribution is novel.', '3', 'Prior work on drug design formulated the graph genera-', 'tion task as a string generation problem.'].join('\n');
  const paras = reflowPage(page);
  assert.deepEqual(paras, ['2 Related Work', 'We seek to automate the design of molecules based on specific chemical properties. In computational terms, this task involves continuous embedding and generation of molecular graphs. Our contribution is novel.', 'Prior work on drug design formulated the graph generation task as a string generation problem.']);
  assert.equal(composePages(['Abstract\nOne line.', '']), '[第 1 页]\n\nAbstract\n\nOne line.');
});

test('translation helpers: keys, filtering, chunking and parsing', () => {
  assert.equal(textKey('a  b'), textKey('a b'));
  assert.notEqual(textKey('ab'), textKey('abc'));
  assert.ok(translatable('We seek to automate the design of molecules.'));
  assert.ok(!translatable('[第 3 页]'));
  assert.ok(!translatable('12 34'));
  assert.ok(!translatable('这是中文'));
  const paras = [{ key: 'a', text: 'x'.repeat(1500) }, { key: 'b', text: 'y'.repeat(1000) }, { key: 'c', text: 'z' }];
  assert.deepEqual(chunkParagraphs(paras, 2200).map(c => c.length), [1, 2]);
  assert.match(chunkPrompt(paras.slice(0, 2)), /\[1\] x+\n\n\[2\] y+/);
  assert.deepEqual(parseChunkAnswer('[1] 第一段\n\n[2] 第二段\n继续\n\n【3】第三段', 3), ['第一段', '第二段\n继续', '第三段']);
  assert.deepEqual(parseChunkAnswer('[1] 只有一段\n\n[3] 多余', 2), ['只有一段', null]);
  assert.deepEqual(parseChunkAnswer('没有编号的译文', 1), ['没有编号的译文']);
});

test('reflowLines uses indents, gaps and font size when geometry is present', () => {
  const L = (text, x, y, h = 10) => ({ text, x, y, w: 200, h });
  const lines = [
    L('Junction Tree Variational Autoencoder', 100, 40, 16), L('for Molecular Graph Generation', 110, 58, 16),
    L('1. Introduction', 50, 100, 12),
    L('We seek to automate the design of molecules based on specific', 62, 120), L('chemical properties and this line keeps going on and on.', 50, 132), L('It ends here.', 50, 144),
    L('Prior work on drug design formulated the graph generation', 62, 156), L('task as a string generation problem and continued here', 50, 168),
    L('and in the right column the paragraph goes on and on and', 330, 100), L('finally ends.', 330, 112),
    L('A new paragraph after a blank gap starts without indent.', 330, 140),
  ];
  const paras = reflowLines(lines);
  assert.deepEqual(paras.map(p => p.text), [
    'Junction Tree Variational Autoencoder for Molecular Graph Generation',
    '1. Introduction',
    'We seek to automate the design of molecules based on specific chemical properties and this line keeps going on and on. It ends here.',
    'Prior work on drug design formulated the graph generation task as a string generation problem and continued here and in the right column the paragraph goes on and on and finally ends.',
    'A new paragraph after a blank gap starts without indent.',
  ]);
  assert.equal(paras[0].heading, true);
  assert.equal(paras[2].lines.length, 3);
});
