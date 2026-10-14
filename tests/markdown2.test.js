import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownLite } from '../src/ui/dom.js';

test('math delimiters become placeholders with escaped TeX', () => {
  const out = String(markdownLite('记作 \\(G=(V,E)\\) 和 $z_T$，以及 $$p(T\\mid z_T)$$ 价格 $5 和 $6 不是公式'));
  assert.ok(out.includes('<span class="math" data-tex="G=(V,E)">G=(V,E)</span>'));
  assert.ok(out.includes('data-tex="z_T"'));
  assert.ok(out.includes('class="math math-display" data-tex="p(T\\mid z_T)"'));
  assert.ok(out.includes('$5 和 $6'), 'currency should stay as text: ' + out);
});

test('nested lists, numbered items, blockquote and rule render structurally', () => {
  const md = '解码分两阶段：\n\n1. 用 tree decoder 生成树\n2. 用 graph decoder 组装\n   - 词汇表 780\n   - 潜表示\n\n> 注意：不是 Murcko scaffold\n\n---\n\n结束';
  const out = String(markdownLite(md));
  assert.ok(out.includes('<ol><li>用 tree decoder 生成树</li><li>用 graph decoder 组装<ul><li>词汇表 780</li><li>潜表示</li></ul></li></ol>'), out);
  assert.ok(out.includes('<blockquote>注意：不是 Murcko scaffold</blockquote>'));
  assert.ok(out.includes('<hr>'));
  assert.ok(out.endsWith('<p>结束</p>'));
});

test('headings map to h3/h4, links only allow http(s), html is escaped', () => {
  const out = String(markdownLite('## 核心思想\n### 细节\n看 [论文](https://arxiv.org/abs/1802.04364) 和 [坏](javascript:alert(1)) <img src=x onerror=1>'));
  assert.ok(out.includes('<h3>核心思想</h3><h4>细节</h4>'));
  assert.ok(out.includes('<a href="https://arxiv.org/abs/1802.04364" target="_blank" rel="noopener">论文</a>'));
  assert.ok(!out.includes('href="javascript'));
  assert.ok(out.includes('&lt;img src=x onerror=1&gt;'));
});

test('mermaid fences inside answers survive math extraction', () => {
  const out = String(markdownLite('文字 $x$\n```mermaid\nflowchart TD\n  A[$] --> B\n```'));
  assert.ok(out.includes('<div class="mermaid-block" data-mermaid="flowchart TD\n  A[$] --&gt; B">'));
  assert.ok(out.includes('data-tex="x"'));
});

test('svg fences become sanitizable figure blocks', () => {
  const out = String(markdownLite('图：\n```svg\n<svg viewBox="0 0 10 10"><circle r="3"/><script>x()</script></svg>\n```'));
  assert.ok(out.includes('<div class="svg-block" data-svg="&lt;svg viewBox=&quot;0 0 10 10&quot;'));
  assert.ok(!out.includes('<script'));
});
