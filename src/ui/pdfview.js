// PDF.js based page renderer with a selectable text layer and highlight overlays.
import * as pdfjsLib from '../../vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const PADDING = 32;
const ROW_GAP = 12;

export class PdfView {
  constructor(container, { onPageChange = null, onRendered = null } = {}) {
    this.container = container;
    this.onPageChange = onPageChange;
    this.onRendered = onRendered;
    this.doc = null;
    this.pages = [];        // {num, proxy, width, height, el, rendered, task}
    this.zoom = 'auto';
    this.scale = 1;
    this.notes = [];
    this.texts = {};
    this.lines = {};
    this.side = false;        // show a side column (translation) next to each page
    this.sideRender = null;
    this.destroyed = false;
    this.current = 1;
    this._onScroll = () => this._trackPage();
    this._onResize = () => { if (this.zoom === 'auto') this._relayout(); };
    this.observer = null;
  }

  async load(blob, { zoom = 'auto', page = 1, scrollTop = null } = {}) {
    const data = await blob.arrayBuffer();
    this.doc = await pdfjsLib.getDocument({ data }).promise;
    if (this.destroyed) return;
    this.zoom = zoom || 'auto';
    const wrap = document.createElement('div');
    wrap.className = 'pdf-pages';
    this.container.innerHTML = '';
    this.container.append(wrap);
    this.wrap = wrap;
    for (let i = 1; i <= this.doc.numPages; i++) {
      const proxy = await this.doc.getPage(i);
      if (this.destroyed) return;
      const vp = proxy.getViewport({ scale: 1 });
      const el = document.createElement('div');
      el.className = 'pdf-page loading';
      el.dataset.page = String(i);
      el.innerHTML = '<span class="page-num">' + i + '</span>';
      const row = document.createElement('div');
      row.className = 'pdf-row';
      const side = document.createElement('aside');
      side.className = 'pdf-side';
      side.dataset.page = String(i);
      side.hidden = true;
      row.append(el, side);
      wrap.append(row);
      this.pages.push({ num: i, proxy, width: vp.width, height: vp.height, el, row, side, vp1: vp, rendered: false, task: null });
    }
    this._applyScale();
    this.observer = new IntersectionObserver(entries => {
      for (const en of entries) if (en.isIntersecting) this._render(Number(en.target.dataset.page));
    }, { root: this.container, rootMargin: '900px 0px' });
    this.pages.forEach(p => this.observer.observe(p.el));
    this.container.addEventListener('scroll', this._onScroll, { passive: true });
    window.addEventListener('resize', this._onResize);
    // Refit when the reading area itself changes width (assistant collapsed or resized).
    this._lastW = this.container.clientWidth;
    this.ro = new ResizeObserver(() => {
      const w = this.container.clientWidth;
      if (Math.abs(w - this._lastW) < 2 || this.destroyed) return;
      this._lastW = w;
      if (this.zoom === 'auto') { clearTimeout(this._roT); this._roT = setTimeout(() => { if (!this.destroyed) this._relayout(); }, 120); }
    });
    this.ro.observe(this.container);
    if (scrollTop != null && scrollTop > 0) this.container.scrollTop = scrollTop;
    else if (page > 1) this.goTo(page);
    this._trackPage();
  }

  get pageCount() { return this.pages.length; }

  _computeScale() {
    if (typeof this.zoom === 'number') return this.zoom;
    const maxW = Math.max(...this.pages.map(p => p.width), 1);
    const avail = Math.max(320, this.container.clientWidth - PADDING - (this.side ? ROW_GAP : 0));
    return Math.min(2.5, Math.max(0.4, avail / (maxW * (this.side ? 2 : 1))));
  }

  _applyScale() {
    this.scale = this._computeScale();
    for (const p of this.pages) {
      p.el.style.width = Math.floor(p.width * this.scale) + 'px';
      p.el.style.height = Math.floor(p.height * this.scale) + 'px';
      p.el.style.setProperty('--scale-factor', String(this.scale));
      p.side.style.width = Math.floor(p.width * this.scale) + 'px';
      p.side.style.minHeight = Math.floor(p.height * this.scale) + 'px';
      p.side.style.fontSize = Math.max(10.5, Math.min(15, p.width * this.scale * 0.0205)).toFixed(1) + 'px';
    }
  }

  _relayout() {
    const ratio = this.container.scrollTop / Math.max(1, this.container.scrollHeight);
    for (const p of this.pages) this._clearPage(p);
    this._applyScale();
    this.container.scrollTop = ratio * this.container.scrollHeight;
    for (const p of this.pages) if (this._visible(p.el)) this._render(p.num);
  }

  _visible(el) {
    const r = el.getBoundingClientRect(), c = this.container.getBoundingClientRect();
    return r.bottom > c.top - 900 && r.top < c.bottom + 900;
  }

  _clearPage(p) {
    if (p.task) { try { p.task.cancel(); } catch {} p.task = null; }
    p.rendered = false;
    p.el.querySelectorAll('canvas, .textLayer, .pdf-hl, .pdf-marker').forEach(n => n.remove());
    p.el.classList.add('loading');
  }

  async _render(num) {
    const p = this.pages[num - 1];
    if (!p || p.rendered || p.task || this.destroyed) return;
    const vp = p.proxy.getViewport({ scale: this.scale });
    const canvas = document.createElement('canvas');
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(vp.width * ratio);
    canvas.height = Math.floor(vp.height * ratio);
    canvas.style.width = Math.floor(vp.width) + 'px';
    canvas.style.height = Math.floor(vp.height) + 'px';
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    const task = p.proxy.render({ canvasContext: ctx, viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null });
    p.task = task;
    try {
      await task.promise;
    } catch (err) {
      p.task = null;
      return; // cancelled or failed; a later layout pass retries
    }
    if (this.destroyed || p.task !== task) return;
    p.task = null;
    p.el.prepend(canvas);
    p.el.classList.remove('loading');
    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'textLayer';
    p.el.append(textLayerDiv);
    try {
      const textContent = await p.proxy.getTextContent();
      if (this.destroyed) return;
      this.texts[num] = textContent.items.map(it => it.str + (it.hasEOL ? '\n' : '')).join('');
      this.lines[num] = linesFromContent(textContent, p);
      // PDF.js lays the text layer out with a generic font (serif / sans-serif) and stretches each run to
      // the right total width, so characters mid-line drift from the rendered glyphs. The embedded fonts
      // are already loaded into the document under their loadedName (same as the style key), so prefer
      // them: widths then match the canvas and selections land on the right characters.
      for (const [name, style] of Object.entries(textContent.styles || {})) {
        if (style && style.fontFamily && !String(style.fontFamily).includes(name)) style.fontFamily = name + ', ' + style.fontFamily;
      }
      const layer = new pdfjsLib.TextLayer({ textContentSource: textContent, container: textLayerDiv, viewport: vp });
      await layer.render();
      const end = document.createElement('div');
      end.className = 'endOfContent';
      textLayerDiv.append(end);
    } catch (err) {
      console.warn('text layer failed on page', num, err);
    }
    p.rendered = true;
    try { this._inkFit(p, canvas); } catch (err) { console.warn('ink fit skipped', err); }
    this._drawHighlights(p);
    this._drawMarkers(p);
    this._renderSide(p);
    if (this.onRendered) this.onRendered(num);
  }

  // PDF.js sizes each text run from the PDF's advance widths, which in justified text come out one
  // to two percent short of the painted glyphs, so selections miss the last letters of a line.
  // Widen line-final runs so their right edge meets the rightmost ink on the canvas.
  _inkFit(p, canvas) {
    const spans = Array.from(p.el.querySelectorAll('.textLayer span')).filter(s => s.textContent.trim().length >= 12);
    if (!spans.length) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pr = p.el.getBoundingClientRect();
    const dpr = canvas.width / pr.width;
    const rects = spans.map(s => s.getBoundingClientRect());
    let adjusted = 0;
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i], r = rects[i];
      if (r.width < 60 || r.height < 4) continue;
      const tf = s.style.transform || '';
      if (tf && !/^scaleX\([\d.]+\)$/.test(tf)) continue;
      // skip runs that are followed by another run on the same line
      const next = rects.some((o, j) => j !== i && Math.abs(o.top - r.top) < r.height * 0.5 && o.left >= r.right - 2 && o.left < r.right + 40);
      if (next) continue;
      const window = Math.min(14, Math.max(6, r.width * 0.03));
      const x0 = Math.max(0, Math.floor((r.right - pr.left - 2) * dpr)), x1 = Math.min(canvas.width, Math.ceil((r.right - pr.left + window) * dpr));
      const y0 = Math.max(0, Math.floor((r.top - pr.top + r.height * 0.15) * dpr)), y1 = Math.min(canvas.height, Math.ceil((r.bottom - pr.top - r.height * 0.1) * dpr));
      if (x1 - x0 < 2 || y1 - y0 < 2) continue;
      const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      const w = x1 - x0;
      let maxX = -1, hasInkAtStart = false;
      for (let y = 0; y < y1 - y0; y++) {
        for (let x = 0; x < w; x++) {
          const k = (y * w + x) * 4;
          const lum = 0.299 * img[k] + 0.587 * img[k + 1] + 0.114 * img[k + 2];
          if (lum < 160) { if (x > maxX) maxX = x; if (x <= 2 * dpr + 1) hasInkAtStart = true; }
        }
      }
      if (maxX < 0 || !hasInkAtStart) continue;
      const inkRight = (x0 + maxX + 1) / dpr + pr.left;
      const delta = inkRight - r.right;
      if (delta < 0.5 || delta > window) continue;
      const cur = Number((/scaleX\(([\d.]+)\)/.exec(tf) || [])[1] || 1);
      const factor = (r.width + delta) / r.width;
      if (factor > 1.06) continue;
      s.style.transform = 'scaleX(' + (cur * factor).toFixed(5) + ')';
      adjusted++;
    }
    return adjusted;
  }

  pageText(num) { return this.texts[num] || ''; }

  async ensurePageText(num) {
    if (this.texts[num] != null) return this.texts[num];
    const p = this.pages[num - 1];
    if (!p) return '';
    const tc = await p.proxy.getTextContent();
    this.texts[num] = tc.items.map(it => it.str + (it.hasEOL ? '\n' : '')).join('');
    this.lines[num] = linesFromContent(tc, p);
    return this.texts[num];
  }

  // Text lines with geometry (page points, y = top), for paragraph reflow and the side column.
  pageLines(num) { return this.lines[num] || []; }
  async ensurePageLines(num) { if (!this.lines[num]) await this.ensurePageText(num); return this.lines[num] || []; }

  // A side column next to every page (used for the translation), filled by render(num, el, page).
  setSide(render) { this.sideRender = render; }
  showSide(on) {
    on = !!on;
    if (on === this.side) { if (on) this.refreshSide(); return; }
    this.side = on;
    if (this.wrap) this.wrap.classList.toggle('with-side', on);
    for (const p of this.pages) p.side.hidden = !on;
    if (this.zoom === 'auto') this._relayout();
    else this.refreshSide();
  }
  refreshSide(nums = null) {
    for (const p of this.pages) if (p.rendered && (!nums || nums.includes(p.num))) this._renderSide(p);
  }
  _renderSide(p) {
    if (!this.side || !this.sideRender) return;
    try { this.sideRender(p.num, p.side, p); } catch (err) { console.warn('side render failed', err); }
  }

  // Text of every page, extracted on demand and cached. Pages are separated with a page marker so the
  // model can cite page numbers.
  async allText() {
    if (this.fullText) return this.fullText;
    const parts = [];
    for (let n = 1; n <= this.pages.length; n++) {
      if (this.destroyed) return '';
      const t = (await this.ensurePageText(n)).replace(/[ \t]+\n/g, '\n').trim();
      if (t) parts.push('[第 ' + n + ' 页]\n' + t);
    }
    this.fullText = parts.join('\n\n');
    return this.fullText;
  }

  async _renderOffscreen(num, scale) {
    const p = this.pages[num - 1];
    if (!p) return null;
    const vp = p.proxy.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    await p.proxy.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: vp }).promise;
    return canvas;
  }

  // Crop a region (normalized page coordinates) to a PNG data URL, rendered sharp enough for a model.
  async renderRegion(num, rect, { targetWidth = 1200 } = {}) {
    const p = this.pages[num - 1];
    if (!p) return null;
    const scale = Math.min(4, Math.max(1.5, targetWidth / Math.max(1, p.width * rect.w)));
    const canvas = await this._renderOffscreen(num, scale);
    const sx = Math.max(0, Math.floor(rect.x * canvas.width)), sy = Math.max(0, Math.floor(rect.y * canvas.height));
    const sw = Math.max(1, Math.min(canvas.width - sx, Math.ceil(rect.w * canvas.width))), sh = Math.max(1, Math.min(canvas.height - sy, Math.ceil(rect.h * canvas.height)));
    const out = document.createElement('canvas'); out.width = sw; out.height = sh;
    out.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return out.toDataURL('image/png');
  }

  // Whole page as a JPEG data URL (for "send page images with whole-paper questions").
  async renderPageImage(num, { maxWidth = 1100, quality = 0.72 } = {}) {
    const p = this.pages[num - 1];
    if (!p) return null;
    const canvas = await this._renderOffscreen(num, Math.min(2, maxWidth / p.width));
    return canvas.toDataURL('image/jpeg', quality);
  }

  setZoom(zoom) {
    this.zoom = zoom;
    this._relayout();
  }

  zoomStep(dir) {
    const cur = this.scale;
    const steps = [0.5, 0.65, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5];
    let next = dir > 0 ? steps.find(s => s > cur + 0.01) : [...steps].reverse().find(s => s < cur - 0.01);
    if (!next) return;
    this.setZoom(next);
  }

  goTo(num) {
    const p = this.pages[num - 1];
    if (!p) return;
    this.container.scrollTop = p.el.offsetTop - 8;
  }

  _trackPage() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      const c = this.container.getBoundingClientRect();
      const mid = c.top + c.height * 0.4;
      let best = 1, bestDist = Infinity;
      for (const p of this.pages) {
        const r = p.el.getBoundingClientRect();
        if (r.bottom < c.top || r.top > c.bottom) continue;
        const d = Math.abs((r.top + r.bottom) / 2 - mid);
        if (d < bestDist) { bestDist = d; best = p.num; }
      }
      if (best !== this.current) { this.current = best; if (this.onPageChange) this.onPageChange(best); }
    });
  }

  setHighlights(notes) {
    this.notes = (notes || []).filter(n => n.anchor && n.anchor.kind === 'pdf');
    for (const p of this.pages) if (p.rendered) this._drawHighlights(p);
  }

  // Note markers: items = [{id, kind, page, x, y, title}] placed at normalized page coordinates
  // (right after the annotated text); items at nearly the same spot share one marker.
  setMarkers(items) {
    this.markers = (items || []).filter(m => m && m.page && typeof m.y === 'number' && typeof m.x === 'number');
    for (const p of this.pages) if (p.rendered) this._drawMarkers(p);
  }

  _drawMarkers(p) {
    p.el.querySelectorAll('.pdf-marker').forEach(n => n.remove());
    const items = (this.markers || []).filter(m => m.page === p.num).sort((a, b) => a.y - b.y || a.x - b.x);
    const groups = [];
    for (const m of items) {
      const g = groups.find(g => Math.abs(m.y - g.y) < 0.012 && Math.abs(m.x - g.x) < 0.03);
      if (g) { g.items.push(m); continue; }
      groups.push({ x: m.x, y: m.y, items: [m] });
    }
    for (const g of groups) {
      const el = document.createElement('button');
      el.className = 'pdf-marker note';
      el.dataset.ids = g.items.map(m => m.id).join(',');
      el.style.left = (Math.min(0.985, g.x) * 100) + '%';
      el.style.top = (g.y * 100) + '%';
      el.title = g.items.map(m => m.title).join('\n');
      el.innerHTML = '✎' + (g.items.length > 1 ? '<b>' + g.items.length + '</b>' : '');
      p.el.append(el);
    }
  }

  _drawHighlights(p) {
    p.el.querySelectorAll('.pdf-hl').forEach(n => n.remove());
    for (const n of this.notes) {
      if (n.anchor.page !== p.num) continue;
      for (const r of n.anchor.rects || []) {
        const d = document.createElement('div');
        d.className = 'pdf-hl ' + (n.type === 'highlight' ? '' : n.type);
        d.dataset.note = n.id;
        d.title = n.text ? n.text.slice(0, 120) : '高亮';
        d.style.left = (r.x * 100) + '%';
        d.style.top = (r.y * 100) + '%';
        d.style.width = (r.w * 100) + '%';
        d.style.height = (r.h * 100) + '%';
        p.el.append(d);
      }
    }
  }

  // Scroll a note's first rect into view.
  showAnchor(anchor) {
    if (!anchor || anchor.kind !== 'pdf') return false;
    const p = this.pages[anchor.page - 1];
    if (!p) return false;
    const rect = (anchor.rects || [])[0];
    const y = p.el.offsetTop + (rect ? rect.y * p.el.offsetHeight : 0);
    this.container.scrollTop = Math.max(0, y - this.container.clientHeight * 0.3);
    return true;
  }

  // Build selection info from the current DOM selection, or null if it is not inside a page.
  selectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const pageEl = startEl && startEl.closest('.pdf-page');
    if (!pageEl || !this.container.contains(pageEl)) return null;
    const num = Number(pageEl.dataset.page);
    const pr = pageEl.getBoundingClientRect();
    const rects = [];
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      if (r.bottom < pr.top || r.top > pr.bottom) continue;
      const x = (Math.max(r.left, pr.left) - pr.left) / pr.width;
      const y = (Math.max(r.top, pr.top) - pr.top) / pr.height;
      const w = (Math.min(r.right, pr.right) - Math.max(r.left, pr.left)) / pr.width;
      const h = (Math.min(r.bottom, pr.bottom) - Math.max(r.top, pr.top)) / pr.height;
      if (w <= 0 || h <= 0) continue;
      const last = rects[rects.length - 1];
      if (last && Math.abs(last.y - y) < 0.002 && Math.abs(last.h - h) < 0.002 && x <= last.x + last.w + 0.01) {
        last.w = Math.max(last.w, x + w - last.x); continue;
      }
      rects.push({ x, y, w, h });
    }
    const quote = sel.toString().replace(/\s+/g, ' ').trim();
    if (!quote) return null;
    const bounding = range.getBoundingClientRect();
    return { page: num, quote, rects, bounding, pageText: this.texts[num] || '' };
  }

  destroy() {
    this.destroyed = true;
    if (this.observer) this.observer.disconnect();
    this.container.removeEventListener('scroll', this._onScroll);
    window.removeEventListener('resize', this._onResize);
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    clearTimeout(this._roT);
    for (const p of this.pages) { if (p.task) { try { p.task.cancel(); } catch {} } }
    if (this.doc) { try { this.doc.destroy(); } catch {} }
    this.pages = [];
    this.container.innerHTML = '';
  }
}


// Group text items into lines with positions in page points (origin top-left, y = line top).
function linesFromContent(tc, p) {
  const vp = p.vp1 || p.proxy.getViewport({ scale: 1 });
  const lines = [];
  let cur = null;
  const push = () => { if (cur && cur.text.trim()) lines.push(cur); cur = null; };
  for (const it of tc.items) {
    if (typeof it.str !== 'string') continue;
    const t = it.transform || [1, 0, 0, 1, 0, 0];
    const h = Math.abs(it.height || t[3] || t[0]) || 10;
    const [vx, vy] = vp.convertToViewportPoint(t[4], t[5]);
    const w = it.width || 0;
    if (cur && Math.abs(vy - cur.base) > cur.h * 0.5) push();
    if (!cur) cur = { text: '', x: vx, right: vx + w, base: vy, h };
    cur.text += it.str;
    cur.x = Math.min(cur.x, vx); cur.right = Math.max(cur.right, vx + w); cur.h = Math.max(cur.h, h);
    if (it.hasEOL) push();
  }
  push();
  return lines.map(l => ({ text: l.text, x: l.x, y: l.base - l.h * 0.85, w: Math.max(0, l.right - l.x), h: l.h * 1.1 }));
}
