// Interactive teaching diagram for the demo paper only. Hand-made SVG, not model output.
import { html } from './dom.js';

export function diagramMarkup() {
  return html`<section class="diagram" data-shift-diagram>
    <svg viewBox="0 0 360 200" role="img" aria-label="源域与目标域数据分布示意">
      <line x1="20" y1="165" x2="340" y2="165" stroke="#c9d3d8"/>
      <line x1="175" y1="30" x2="175" y2="165" stroke="#8a979f" stroke-dasharray="5 5"/>
      <text x="181" y="23" font-size="12" fill="#5f6f78">固定模型边界</text>
      <g data-source-dots></g><g data-target-dots></g>
      <text x="20" y="188" font-size="11" fill="#5f6f78">抽象特征坐标 →</text>
    </svg>
    <div class="diagram-controls"><label>偏移程度 <input type="range" min="0" max="100" value="40" data-shift-range aria-label="域偏移程度"></label><output data-shift-value>40</output></div>
    <div class="diagram-legend"><span><i style="background:#3f7d5a"></i> 源域 / 医院 A</span><span><i style="background:#c08a4a"></i> 目标域 / 医院 B</span></div>
    <p class="muted small">教学示意，不是论文实验数据；滑块数值不代表性能。想一想：分布变化一定导致性能下降吗？需要什么实验来验证？</p>
  </section>`;
}

export function initDiagram(root) {
  const range = root.querySelector('[data-shift-range]');
  if (!range) return;
  const update = () => {
    const shift = Number(range.value);
    root.querySelector('[data-shift-value]').textContent = shift;
    const points = kind => Array.from({ length: 34 }, (_, i) => {
      const base = i % 2 === 0 ? 100 : 205;
      const x = base + Math.sin(i * 2.3) * 25 + (kind === 'target' ? shift * 0.75 : 0);
      const y = 93 + Math.cos(i * 1.7) * 40;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${kind === 'target' ? 3.5 : 4}" fill="${kind === 'target' ? '#c08a4a' : '#3f7d5a'}" opacity=".65"/>`;
    }).join('');
    root.querySelector('[data-source-dots]').innerHTML = points('source');
    root.querySelector('[data-target-dots]').innerHTML = points('target');
  };
  range.oninput = update;
  update();
}
