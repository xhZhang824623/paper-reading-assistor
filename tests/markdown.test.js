import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownLite } from '../src/ui/dom.js';

test('markdownLite renders GFM tables with escaped cells', () => {
  const out = String(markdownLite('前言\n\n| 方案 | 特点 |\n|---|---|\n| SMILES | 线性 <b>x</b> |\n| 图 | 节点 |\n\n后记'));
  assert.ok(out.includes('<table><thead><tr><th>方案</th><th>特点</th></tr></thead>'));
  assert.ok(out.includes('<td>线性 &lt;b&gt;x&lt;/b&gt;</td>'));
  assert.ok(out.includes('<p>后记</p>'));
});

test('markdownLite turns mermaid fences into diagram blocks and keeps other code as pre', () => {
  const out = String(markdownLite('```mermaid\nflowchart LR\n  A["x"] --> B\n```\n```python\nprint(1)\n```'));
  assert.ok(out.includes('<div class="mermaid-block" data-mermaid="flowchart LR\n  A[&quot;x&quot;] --&gt; B">'));
  assert.ok(out.includes('<pre class="mermaid-src">'));
  assert.ok(out.includes('<pre>print(1)</pre>'));
  assert.ok(!out.includes('<script'));
});
