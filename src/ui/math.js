// Lazy KaTeX rendering for LaTeX in model answers. Library is vendored (vendor/katex) and only loaded
// the first time an answer contains math.
const BASE = new URL('../../vendor/katex/', import.meta.url);
let loading = null;

export function loadKatex() {
  if (globalThis.__katex) return Promise.resolve(globalThis.__katex);
  if (!loading) {
    loading = (async () => {
      if (!document.querySelector('link[data-katex]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = new URL('katex.min.css', BASE).href; link.dataset.katex = '1';
        document.head.append(link);
      }
      const m = await import(new URL('katex.mjs', BASE).href);
      globalThis.__katex = m.default || m;
      return globalThis.__katex;
    })();
  }
  return loading;
}

// Replace every un-rendered .math span inside root with KaTeX output. Failures keep the raw TeX.
export async function renderMath(root) {
  const nodes = Array.from((root || document).querySelectorAll('.math:not([data-rendered])'));
  if (!nodes.length) return;
  let katex;
  try { katex = await loadKatex(); } catch (err) { console.warn('KaTeX 加载失败', err); nodes.forEach(n => { n.dataset.rendered = 'error'; }); return; }
  for (const n of nodes) {
    if (!n.isConnected) continue;
    try {
      n.innerHTML = katex.renderToString(n.dataset.tex || '', { throwOnError: false, displayMode: n.classList.contains('math-display'), strict: 'ignore', trust: false });
      n.dataset.rendered = 'ok';
    } catch (err) {
      n.dataset.rendered = 'error';
    }
  }
}
