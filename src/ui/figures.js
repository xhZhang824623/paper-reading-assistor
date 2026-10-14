// Model-drawn SVG illustrations (```svg blocks) rendered after sanitizing with DOMPurify, plus the
// shared "enlarge" modal used by Mermaid diagrams too.
const PURIFY_URL = new URL('../../vendor/dompurify/purify.es.mjs', import.meta.url).href;
let purifyPromise = null;

function loadPurify() {
  if (!purifyPromise) purifyPromise = import(PURIFY_URL).then(m => m.default || m);
  return purifyPromise;
}

export function sanitizeSvg(DOMPurify, src) {
  const clean = DOMPurify.sanitize(String(src || ''), {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'image', 'use', 'a', 'iframe', 'object', 'embed', 'video', 'audio', 'animate', 'set'],
    FORBID_ATTR: ['href', 'xlink:href', 'src', 'style'],
  });
  return /<svg[\s>]/i.test(clean) ? clean : '';
}

function fitSvg(holder) {
  const svg = holder.querySelector('svg');
  if (!svg) return;
  if (!svg.getAttribute('viewBox')) {
    const w = parseFloat(svg.getAttribute('width')) || 600, h = parseFloat(svg.getAttribute('height')) || 300;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.style.width = '100%'; svg.style.height = 'auto'; svg.style.maxHeight = '420px';
}

// Full-size figure viewer: starts at a readable size (never below the diagram's natural size when it
// is wide), with zoom buttons, Ctrl+wheel zoom and drag-to-pan.
export async function enlargeSvg(svgMarkup) {
  const { modal } = await import('./dom.js');
  const dlg = modal({ title: '图解', wide: true, body: '' });
  dlg.classList.add('figure-modal');
  const body = dlg.querySelector('.modal-body');
  body.innerHTML = '<div class="figure-tools"><button class="btn btn-sm" data-zoom="-" title="缩小">−</button><span class="figure-zoom">100%</span><button class="btn btn-sm" data-zoom="+" title="放大">+</button><button class="btn btn-sm" data-zoom="fit">适应窗口</button><button class="btn btn-sm" data-zoom="1">原始大小</button><span class="hint">Ctrl + 滚轮缩放，按住拖动平移</span></div><div class="figure-scroll"><div class="figure-stage"></div></div>';
  const stage = body.querySelector('.figure-stage');
  stage.innerHTML = svgMarkup;
  const svg = stage.querySelector('svg');
  if (!svg) return;
  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const natW = vb.length === 4 && vb[2] > 0 ? vb[2] : parseFloat(svg.getAttribute('width')) || 800;
  const natH = vb.length === 4 && vb[3] > 0 ? vb[3] : parseFloat(svg.getAttribute('height')) || 400;
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${natW} ${natH}`);
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.style.maxWidth = 'none'; svg.style.maxHeight = 'none';
  const scroll = body.querySelector('.figure-scroll');
  let zoom = 1;
  const apply = () => { svg.style.width = Math.round(natW * zoom) + 'px'; svg.style.height = Math.round(natH * zoom) + 'px'; body.querySelector('.figure-zoom').textContent = Math.round(zoom * 100) + '%'; };
  const boxH = Math.max(300, Math.floor(window.innerHeight * 0.8) - 28);
  // Fit the whole figure in the viewer, enlarged at most 2x; if it would have to shrink a lot, keep
  // it readable at 100% and let the user scroll.
  const fitZoom = () => { const z = Math.min((scroll.clientWidth - 28) / natW, boxH / natH); return z < 0.8 ? 1 : Math.min(2, z); };
  zoom = fitZoom();
  apply();
  body.querySelector('.figure-tools').addEventListener('click', e => {
    const b = e.target.closest('[data-zoom]'); if (!b) return;
    if (b.dataset.zoom === '+') zoom = Math.min(5, zoom * 1.25);
    else if (b.dataset.zoom === '-') zoom = Math.max(0.2, zoom / 1.25);
    else if (b.dataset.zoom === 'fit') zoom = fitZoom();
    else zoom = 1;
    apply();
  });
  scroll.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoom = Math.max(0.2, Math.min(5, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    apply();
  }, { passive: false });
  let drag = null;
  scroll.addEventListener('pointerdown', e => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, sl: scroll.scrollLeft, st: scroll.scrollTop }; scroll.setPointerCapture(e.pointerId); scroll.classList.add('dragging'); });
  scroll.addEventListener('pointermove', e => { if (!drag) return; scroll.scrollLeft = drag.sl - (e.clientX - drag.x); scroll.scrollTop = drag.st - (e.clientY - drag.y); });
  const stop = () => { drag = null; scroll.classList.remove('dragging'); };
  scroll.addEventListener('pointerup', stop); scroll.addEventListener('pointercancel', stop);
}

export async function renderSvgFigures(root) {
  const blocks = Array.from((root || document).querySelectorAll('.svg-block:not([data-rendered])'));
  if (!blocks.length) return;
  let DOMPurify;
  try { DOMPurify = await loadPurify(); } catch (err) { console.warn('DOMPurify 加载失败', err); blocks.forEach(b => { b.dataset.rendered = 'error'; }); return; }
  for (const b of blocks) {
    if (!b.isConnected) continue;
    const clean = sanitizeSvg(DOMPurify, b.dataset.svg || '');
    if (!clean) { b.dataset.rendered = 'error'; b.insertAdjacentHTML('beforeend', '<div class="hint">这张图的 SVG 无法安全渲染，上面是原始代码。</div>'); continue; }
    const holder = document.createElement('div');
    holder.className = 'svg-figure';
    holder.title = '点击放大';
    holder.innerHTML = clean;
    fitSvg(holder);
    b.replaceChildren(holder);
    b.dataset.rendered = 'ok';
    holder.addEventListener('click', () => enlargeSvg(clean));
  }
}
