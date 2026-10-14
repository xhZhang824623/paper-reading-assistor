// DOM helpers: safe HTML templates, toast, modal, light markdown rendering.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Raw { constructor(s) { this.s = String(s); } toString() { return this.s; } }
export const raw = s => new Raw(s);

// Tagged template: every interpolation is escaped unless it is a Raw (or an array of Raw/strings).
export function html(strings, ...values) {
  let out = '';
  strings.forEach((str, i) => {
    out += str;
    if (i < values.length) out += part(values[i]);
  });
  return new Raw(out);
}
function part(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}

export function render(el, content) { el.innerHTML = part(content); return el; }

export const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
export const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '';
export const fmtDateTime = iso => iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
export function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + ' 分钟前';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.round(h / 24);
  if (d < 30) return d + ' 天前';
  return fmtDate(iso);
}

// Toasts. Errors stay until dismissed.
export function toast(message, { type = 'info', sticky = false } = {}) {
  const root = $('#toasts');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  render(el, html`<span>${message}</span>${(sticky || type === 'error') ? html`<button class="toast-close" aria-label="关闭">×</button>` : ''}`);
  root.append(el);
  const remove = () => { el.classList.add('hide'); setTimeout(() => el.remove(), 200); };
  el.querySelector('.toast-close')?.addEventListener('click', remove);
  if (!sticky && type !== 'error') setTimeout(remove, 3200);
  return el;
}

// Modal dialog. `body` is a Raw/html result. Returns the dialog element.
export function modal({ title = '', body = '', wide = false, onClose = null }) {
  const dlg = $('#modal');
  dlg.classList.toggle('wide', wide);
  render(dlg, html`<div class="modal-head"><h2>${title}</h2><button class="icon-btn modal-close" aria-label="关闭">×</button></div><div class="modal-body">${body}</div>`);
  dlg.querySelector('.modal-close').onclick = () => dlg.close();
  dlg.onclose = () => { if (onClose) onClose(); dlg.onclose = null; };
  if (!dlg.open) dlg.showModal();
  return dlg;
}
export function closeModal() { const dlg = $('#modal'); if (dlg.open) dlg.close(); }

export function confirmDialog({ title, message, confirmText = '确定', cancelText = '取消', danger = false }) {
  return new Promise(resolve => {
    let done = false;
    const dlg = modal({ title, body: html`<p class="modal-text">${message}</p><div class="modal-actions"><button class="btn" data-cancel>${cancelText}</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${confirmText}</button></div>`, onClose: () => { if (!done) resolve(false); } });
    dlg.querySelector('[data-ok]').onclick = () => { done = true; dlg.close(); resolve(true); };
    dlg.querySelector('[data-cancel]').onclick = () => { done = true; dlg.close(); resolve(false); };
  });
}

// Choice dialog: choices = [{id, label, desc}] ; resolves to id or null.
export function choiceDialog({ title, message = '', choices }) {
  return new Promise(resolve => {
    let done = false;
    const dlg = modal({ title, body: html`${message ? html`<p class="modal-text">${message}</p>` : ''}<div class="choice-list">${choices.map(c => html`<button class="choice" data-choice="${c.id}"><b>${c.label}</b><small>${c.desc || ''}</small></button>`)}</div>`, onClose: () => { if (!done) resolve(null); } });
    $$('[data-choice]', dlg).forEach(b => b.onclick = () => { done = true; dlg.close(); resolve(b.dataset.choice); });
  });
}

// Markdown renderer for model answers. Escapes everything first, then adds structure:
// headings, paragraphs, nested lists, blockquotes, rules, tables, code fences (mermaid), links,
// bold / italic / inline code, and LaTeX math placeholders rendered later by src/ui/math.js.
export function markdownLite(text) {
  const math = [];
  const stash = (tex, display) => { math.push({ tex: tex.trim(), display }); return '\u0000M' + (math.length - 1) + '\u0000'; };
  let src = String(text || '').replace(/\r\n?/g, '\n');
  // Protect code fences from math extraction by stashing them first.
  const fences = [];
  src = src.replace(/```([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g, (m, lang, body) => { fences.push({ lang: (lang || '').toLowerCase(), body: body.replace(/\n$/, '') }); return '\u0000F' + (fences.length - 1) + '\u0000'; });
  src = src.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => stash(tex, true));
  src = src.replace(/\\\[([\s\S]+?)\\\]/g, (m, tex) => stash(tex, true));
  src = src.replace(/\\\(([\s\S]+?)\\\)/g, (m, tex) => stash(tex, false));
  src = src.replace(/(^|[^\\$\w])\$([^\s$][^$\n]{0,200}?[^\s$\\]|[^\s$\\])\$(?![\w$])/g, (m, pre, tex) => pre + stash(tex, false));

  const lines = src.split('\n');
  const out = [];
  let para = [], table = null, quote = [];
  const listStack = []; // { indent, tag }
  const closeLists = (toIndent = -1) => { while (listStack.length && listStack[listStack.length - 1].indent > toIndent) { out.push('</li></' + listStack.pop().tag + '>'); } };
  const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join(' '), math) + '</p>'); para = []; } };
  const flushQuote = () => { if (quote.length) { out.push('<blockquote>' + inline(quote.join(' '), math) + '</blockquote>'); quote = []; } };
  const flushTable = () => { if (table) { out.push('<table><thead><tr>' + table.head.map(c => '<th>' + inline(c, math) + '</th>').join('') + '</tr></thead><tbody>' + table.rows.map(r => '<tr>' + r.map(c => '<td>' + inline(c, math) + '</td>').join('') + '</tr>').join('') + '</tbody></table>'); table = null; } };
  const flushAll = () => { flushPara(); flushQuote(); flushTable(); closeLists(); };
  const splitRow = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const isSep = line => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
  const fenceBlock = f => f.lang === 'mermaid'
    ? '<div class="mermaid-block" data-mermaid="' + esc(f.body) + '"><pre class="mermaid-src">' + esc(f.body) + '</pre></div>'
    : f.lang === 'svg'
      ? '<div class="svg-block" data-svg="' + esc(f.body) + '"><pre class="mermaid-src">' + esc(f.body.slice(0, 400)) + (f.body.length > 400 ? '…' : '') + '</pre></div>'
      : '<pre>' + esc(f.body) + '</pre>';

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const line = raw.replace(/\t/g, '    ');
    const fenceRef = /^\s*\u0000F(\d+)\u0000\s*$/.exec(line);
    if (fenceRef) { flushPara(); flushQuote(); flushTable(); const f = fences[Number(fenceRef[1])]; if (listStack.length) out.push(fenceBlock(f)); else { closeLists(); out.push(fenceBlock(f)); } continue; }
    if (!line.trim()) { flushPara(); flushQuote(); flushTable(); continue; }
    // table start
    if (!table && /\|/.test(line) && idx + 1 < lines.length && isSep(lines[idx + 1])) { flushPara(); flushQuote(); closeLists(); table = { head: splitRow(line), rows: [] }; idx++; continue; }
    if (table) { if (/\|/.test(line)) { table.rows.push(splitRow(line)); continue; } flushTable(); }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { flushAll(); const level = h[1].length; out.push(level <= 2 ? '<h3>' + inline(h[2], math) + '</h3>' : '<h4>' + inline(h[2], math) + '</h4>'); continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flushAll(); out.push('<hr>'); continue; }
    const bq = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (bq) { flushPara(); flushTable(); closeLists(); quote.push(bq[1]); continue; }
    const li = /^(\s*)(?:[-*+•]|(\d+)[.、)])\s+(.*)$/.exec(line);
    if (li) {
      flushPara(); flushQuote(); flushTable();
      const indent = li[1].length;
      const tag = li[2] !== undefined ? 'ol' : 'ul';
      const top = listStack[listStack.length - 1];
      if (!top || indent > top.indent + 1) { listStack.push({ indent, tag }); out.push('<' + tag + '><li>'); }
      else { closeLists(indent); const cur = listStack[listStack.length - 1]; if (cur && cur.indent >= indent - 1) out.push('</li><li>'); else { listStack.push({ indent, tag }); out.push('<' + tag + '><li>'); } }
      out.push(inline(li[3], math));
      continue;
    }
    // continuation of a list item (indented text under an item)
    if (listStack.length && /^\s{2,}\S/.test(line) && !para.length) { out.push(' ' + inline(line.trim(), math)); continue; }
    if (listStack.length && !para.length && /^\S/.test(line)) closeLists();
    flushQuote();
    para.push(line.trim());
  }
  flushAll();
  return new Raw(out.join(''));
}

function inline(s, math = []) {
  const codes = [];
  let t = String(s).replace(/`([^`\n]+)`/g, (m, c) => { codes.push(c); return '\u0000C' + (codes.length - 1) + '\u0000'; });
  t = esc(t);
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?![\w*])/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) => '<a href="' + url.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener">' + label + '</a>');
  t = t.replace(/\u0000C(\d+)\u0000/g, (m, i) => '<code>' + esc(codes[Number(i)]) + '</code>');
  t = t.replace(/\u0000M(\d+)\u0000/g, (m, i) => { const x = math[Number(i)]; if (!x) return ''; return '<span class="math' + (x.display ? ' math-display' : '') + '" data-tex="' + esc(x.tex) + '">' + esc(x.tex) + '</span>'; });
  return t;
}

export function download(content, name, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...args); }, ms); };
  wrapped.flush = (...args) => { if (t) { clearTimeout(t); t = null; fn(...args); } };
  wrapped.pending = () => t !== null;
  return wrapped;
}

export function pluralCN(n, unit) { return n + ' ' + unit; }
