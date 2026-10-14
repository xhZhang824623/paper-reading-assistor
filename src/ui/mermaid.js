// Lazy Mermaid rendering for diagrams in model answers. The library (vendor/mermaid) is only loaded
// the first time an answer contains a mermaid block. securityLevel "strict" keeps labels as plain text.
let loading = null;
const SRC = new URL('../../vendor/mermaid/mermaid.min.js', import.meta.url).href;

function getGlobal() {
  const g = globalThis.mermaid || (globalThis.__esbuild_esm_mermaid_nm && (globalThis.__esbuild_esm_mermaid_nm.mermaid?.default || globalThis.__esbuild_esm_mermaid_nm.mermaid));
  return g && typeof g.render === 'function' ? g : null;
}

export function loadMermaid() {
  if (getGlobal()) return Promise.resolve(getGlobal());
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = SRC; sc.async = true;
      sc.onload = () => {
        const m = getGlobal();
        if (!m) { reject(new Error('Mermaid 加载后没有找到全局对象')); return; }
        try {
          m.initialize({
            startOnLoad: false, securityLevel: 'strict', theme: 'base',
            themeVariables: { fontFamily: 'system-ui, "PingFang SC", "Noto Sans SC", sans-serif', fontSize: '14px', primaryColor: '#e8f1f3', primaryBorderColor: '#1d6b75', primaryTextColor: '#1e2a30', secondaryColor: '#fff4dc', secondaryBorderColor: '#c08a2e', tertiaryColor: '#e9f5ec', tertiaryBorderColor: '#2f7a4f', lineColor: '#5d6d76', edgeLabelBackground: '#ffffff', clusterBkg: '#f6f8f9', clusterBorder: '#c5d0d6', noteBkgColor: '#fff4dc', noteBorderColor: '#c08a2e', actorBkg: '#e8f1f3', actorBorder: '#1d6b75' },
            flowchart: { htmlLabels: false, curve: 'basis', padding: 10, nodeSpacing: 26, rankSpacing: 34, useMaxWidth: true },
            sequence: { useMaxWidth: true, mirrorActors: false },
          });
        } catch (err) { console.warn(err); }
        resolve(m);
      };
      sc.onerror = () => reject(new Error('Mermaid 脚本加载失败'));
      document.head.append(sc);
    });
  }
  return loading;
}

import { enlargeSvg } from './figures.js';
let seq = 0;

// Render every un-rendered mermaid block inside root. Failures keep the source visible with a note.
export async function renderDiagrams(root) {
  const blocks = Array.from((root || document).querySelectorAll('.mermaid-block:not([data-rendered])'));
  if (!blocks.length) return;
  let m;
  try { m = await loadMermaid(); } catch (err) { for (const b of blocks) { b.dataset.rendered = 'error'; b.insertAdjacentHTML('beforeend', '<div class="hint">图无法渲染：' + String(err.message).replace(/</g, '&lt;') + '</div>'); } return; }
  for (const b of blocks) {
    if (!b.isConnected) continue;
    // Models like to chain classDef/class/style statements with semicolons, which Mermaid rejects.
    const src = (b.dataset.mermaid || '').replace(/;\s*(?=(classDef|class|style|linkStyle)\s)/g, '\n  ').replace(/;\s*$/gm, '');
    try {
      const { svg } = await m.render('mmd-' + (++seq) + '-' + Date.now().toString(36), src);
      const holder = document.createElement('div');
      holder.className = 'mermaid-svg';
      holder.title = '点击放大';
      holder.innerHTML = svg;
      b.replaceChildren(holder);
      b.dataset.rendered = 'ok';
      holder.addEventListener('click', () => enlargeSvg(svg));
    } catch (err) {
      b.dataset.rendered = 'error';
      b.insertAdjacentHTML('beforeend', '<div class="hint">这张图的语法模型写错了，无法渲染；上面是原始代码。</div>');
      // mermaid may leave a stray error element in body
      document.querySelectorAll('body > [id^="dmmd-"], body > svg[id^="mmd-"]').forEach(n => n.remove());
    }
  }
}
