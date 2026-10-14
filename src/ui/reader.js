// Reader: PDF or text view on the left, assistant on the right, selection toolbar and popovers.
import { store, paperById } from '../state/store.js';
import { isSingleWordTerm } from '../domain/knowledge.js';
import { dbGet, dbGetTranslation, dbPutTranslation, dbDeleteTranslation } from '../state/db.js';
import { reflowLines, isPageMarker } from '../domain/reflow.js';
import { textKey, translatable } from '../domain/translate.js';
import { translateParagraphs } from './translate.js';
import { aiReady } from '../ai/adapter.js';
import { newNote, newEvent, PAPER_STATUS } from '../state/schema.js';
import { $, $$, html, raw, esc, render, toast, modal, closeModal, choiceDialog, confirmDialog, markdownLite, debounce, fmtDateTime } from './dom.js';
import { PdfView } from './pdfview.js';
import { mountAssistant } from './assistant.js';
import { paragraphize, makeTextAnchor, resolveTextAnchor, marksForParagraph, segmentText, makePdfAnchor, locateQuote, dehyphenate } from '../domain/anchors.js';
import { ensureSession, endSession, touchSession } from '../domain/session.js';
import { editKnowledgeModal } from './knowledge.js';
import { DEMO_TEXT } from '../data/demo-paper.js';
import { editPaperModal } from './paper-edit.js';
import { renderMath } from './math.js';
import { lookupWord, isSingleWord } from './dictionary.js';
import { addToVocab, findVocab, sentenceAround } from '../domain/vocab.js';
import { isShortPhrase } from '../ai/prompts.js';
import { newEvent as mkEvent } from '../state/schema.js';

let R = null;

const notesFor = id => store.state.notes.filter(n => n.paperId === id);
const textOf = paper => paper.excerptText || (paper.demo ? DEMO_TEXT : '');

export async function show(container, { id }) {
  const paper = paperById(id);
  if (!paper) { render(container, html`<div class="page"><div class="empty">找不到这篇论文。<a href="#/library">回到论文库</a></div></div>`); return; }
  const s = store.state;
  s.current.paperId = id;
  paper.lastOpenedAt = new Date().toISOString();
  if (paper.status === 'inbox') paper.status = 'reading';
  ensureSession(s, id);
  store.save();

  // PDF papers always open the PDF; the text view is only for papers that have no PDF (pasted text).
  R = { paper, container, view: paper.demo ? 'text' : paper.hasPdf ? 'pdf' : 'text', pdf: null, sel: null, focus: false, off: [], assistant: null, text: '', paras: [], textSource: 'none', pageParas: {}, tr: { map: {}, meta: null, running: null, loaded: false } };

  render(container, html`<div class="reader">
    <div class="reader-bar">
      <a class="icon-btn" href="#/library" title="回到论文库" aria-label="回到论文库">←</a>
      <div class="title" id="rTitle" title="点击编辑论文信息">${paper.title}<small>${PAPER_STATUS[paper.status]}${paper.demo ? ' · 教学示例' : ''}${paper.noAI ? ' · 不发 AI' : ''}</small></div>
      <div class="pager" id="pager" hidden><button class="icon-btn" data-zoom="-1" title="缩小">−</button><button class="btn btn-sm btn-ghost" data-zoom="auto" title="适应宽度" id="zoomLabel">自动</button><button class="icon-btn" data-zoom="1" title="放大">+</button><span style="width:8px"></span><input id="pageInput" value="1" aria-label="页码"> / <span id="pageTotal">?</span></div>
      <button class="btn btn-sm" id="regionBtn" title="框选图、表或公式，截图发给模型（快捷键 I）" aria-pressed="false">截图提问</button>
      ${paper.demo ? '' : html`<span class="row trans-ctl"><button class="btn btn-sm" id="transBtn" title="把全文逐段翻译成中文，和原文逐页对照显示。译文保存在本机，下次直接显示，不会重复翻译">全文翻译</button><button class="btn btn-sm" id="transStop" hidden>停止</button><button class="icon-btn" id="transMenu" hidden title="译文选项" aria-label="译文选项">⋯</button></span>`}
      <button class="btn btn-sm" id="focusBtn" title="专注模式（F）">专注</button>
      <button class="btn btn-sm btn-primary" id="endBtn">结束本次阅读</button>
    </div>
    <div class="reader-body">
      <div class="doc" id="doc"></div>
      <div class="reader-divider" id="divider" role="separator" aria-orientation="vertical" tabindex="0" aria-label="调整助手宽度"></div>
      <aside class="assistant" id="assistant"></aside>
      <button class="assistant-rail" id="assistantRail" title="展开助手">助手</button>
    </div>
  </div>`);

  applyLayout();
  R.assistant = mountAssistant($('#assistant'), {
    paper,
    getSelection: () => R.sel,
    getDocumentText: async () => {
      if (!R) return { text: '', source: '' };
      if (R.view === 'pdf' && R.pdf) return { text: await R.pdf.allText(), source: 'PDF 全文，' + R.pdf.pageCount + ' 页' };
      return { text: R.text || textOf(R.paper), source: '粘贴的文本' };
    },
    getPageImages: async progress => {
      if (!R || !R.pdf) return [];
      const n = Math.min(R.pdf.pageCount, 30);
      const out = [];
      for (let i = 1; i <= n; i++) { if (progress) progress(i, n); out.push(await R.pdf.renderPageImage(i)); }
      return out;
    },
    onToggle: visible => { s.layout.assistantVisible = visible; store.save(); applyLayout(); },
    onJump: jumpTo,
    onEditNote: n => noteEditor(n),
    onNotesChanged: refreshMarks,
    onRefresh: refreshMarkers,
  });
  wire();
  await showDoc();
  if (location.hash.endsWith('/paste')) pasteModal();
}

export async function destroy() {
  if (!R) return;
  savePosition.flush && savePosition.flush();
  for (const off of R.off) off();
  if (R.pdf) R.pdf.destroy();
  if (R.tr && R.tr.running) R.tr.running.abort();
  if (R.assistant) R.assistant.destroy();
  hideToolbar(); hidePopover();
  document.body.classList.remove('assistant-hidden', 'reader-focus', 'reader-resizing', 'region-mode');
  R = null;
}

function applyLayout() {
  const l = store.state.layout;
  document.documentElement.style.setProperty('--assistant-w', Math.max(320, Math.min(760, l.assistantWidth || 440)) + 'px');
  document.body.classList.toggle('assistant-hidden', l.assistantVisible === false);
  document.body.classList.toggle('reader-focus', !!(R && R.focus));
  const f = $('#focusBtn'); if (f) f.textContent = R && R.focus ? '退出专注' : '专注';
}

// ---------- document views ----------
async function showDoc() {
  const doc = $('#doc');
  const paper = R.paper;
  if (R.pdf) { R.pdf.destroy(); R.pdf = null; }
  const rb = $('#regionBtn'); if (rb) rb.hidden = !(R.view === 'pdf' && paper.hasPdf);
  if (R.regionMode) setRegionMode(false);
  const pager = $('#pager');
  if (R.view === 'pdf' && paper.hasPdf) {
    doc.className = 'doc';
    render(doc, html`<div class="doc-status"><span>正在加载 PDF…</span></div>`);
    let blob = null;
    try { blob = await dbGet(paper.id); } catch (err) { console.error(err); }
    if (!R || R.paper !== paper || R.view !== 'pdf') return;
    if (!blob) {
      if (textOf(paper)) { R.view = 'text'; R.pdfMissing = true; return showDoc(); }
      render(doc, html`<div class="doc-paste"><div class="empty">这台浏览器里找不到这篇论文的 PDF（可能是清除过浏览器数据，或从备份恢复）。<br><button class="btn btn-primary" style="margin-top:10px" id="reimport">重新导入同一个 PDF</button><div class="hint" style="margin-top:6px">按文件哈希匹配，笔记和记录会自动关联。</div></div></div>`);
      $('#reimport').onclick = () => $('#fileInput').click();
      pager.hidden = true;
      return;
    }
    pager.hidden = false;
    const pos = paper.readerPos || {};
    R.pdf = new PdfView(doc, { onPageChange: n => { $('#pageInput').value = n; savePosition(); } });
    try {
      await R.pdf.load(blob, { zoom: pos.zoom || 'auto', page: pos.page || 1, scrollTop: pos.scrollTop });
    } catch (err) {
      console.error(err);
      render(doc, html`<div class="doc-paste"><div class="empty">PDF 无法渲染：${err && err.message ? err.message : '未知错误'}。可以切换到文本视图，粘贴原文继续。</div></div>`);
      return;
    }
    if (!R || R.pdf === null) return;
    $('#pageTotal').textContent = R.pdf.pageCount;
    $('#pageInput').value = pos.page || 1;
    updateZoomLabel();
    R.pdf.setHighlights(notesFor(paper.id));
    refreshMarkers();
    R.pdf.setSide(renderSidePage);
    await loadTranslation();
    if (!R || R.pdf === null || R.paper !== paper) return;
    updateTransBar();
    if (Object.keys(R.tr.map).length) {
      // Parse all pages in the background so the saved translation can be matched and shown.
      pdfParagraphs().then(() => { if (!R || R.paper !== paper || !R.pdf) return; if (paper.showTranslation && coverage() > 0) R.pdf.showSide(true); updateTransBar(); });
    }
  } else {
    doc.className = 'doc text-mode';
    pager.hidden = true;
    await loadTextSource();
    if (!R || R.paper !== paper || R.view !== 'text') return;
    renderText();
    updateTransBar();
    const pos = paper.readerPos || {};
    if (pos.textScroll) doc.scrollTop = pos.textScroll;
  }
}

function updateZoomLabel() {
  const el = $('#zoomLabel');
  if (el && R.pdf) el.textContent = R.pdf.zoom === 'auto' ? '自动' : Math.round(R.pdf.scale * 100) + '%';
}

// The text view (papers without a PDF) shows the pasted text. Translations are keyed by paragraph
// content, so they survive re-pasting unchanged paragraphs.
async function loadTextSource() {
  R.textSource = textOf(R.paper) ? 'paste' : 'none';
  await loadTranslation();
}

async function loadTranslation() {
  if (R.tr.loaded) return;
  const paper = R.paper;
  try { const t = await dbGetTranslation(paper.id); if (t && t.map && R && R.paper === paper) { R.tr.map = t.map; R.tr.meta = t.meta || null; } } catch (err) { console.error(err); }
  if (R && R.paper === paper) R.tr.loaded = true;
}

function renderText() {
  const doc = $('#doc');
  const paper = R.paper;
  const source = R.textSource === 'paste' ? textOf(paper) : '';
  const { text, paragraphs } = paragraphize(source);
  R.text = text;
  R.paras = paragraphs.map(p => ({ ...p, key: textKey(p.text) }));
  if (!text) {
    render(doc, html`${textBar()}<div class="doc-paste"><div class="empty">这篇论文没有 PDF。把原文粘贴进来后，可以逐句划词、翻译、做笔记，也可以全文翻译对照。<br><button class="btn btn-primary" style="margin-top:10px" id="pasteNow">粘贴原文</button></div></div>`);
    $('#pasteNow').onclick = pasteModal;
    return;
  }
  const notes = notesFor(paper.id).filter(n => n.anchor && n.anchor.kind === 'text');
  const marks = notes.map(n => { const loc = resolveTextAnchor(text, n.anchor); return loc ? { id: n.id, kind: n.type, start: loc.start, end: loc.end } : null; }).filter(Boolean);
  const showZh = !!paper.showTranslation;
  const blocks = R.paras.map(p => {
    if (isPageMarker(p.text)) return `<div class="page-mark" data-start="${p.start}" data-end="${p.end}">${esc(p.text.slice(1, -1))}</div>`;
    const segs = segmentText(p.text, marksForParagraph(p, marks));
    const inner = segs.map(seg => seg.marks.length
      ? `<mark class="${seg.marks.some(m => m.kind === 'question') ? 'question' : seg.marks.some(m => m.kind === 'comment') ? 'comment' : ''} ${seg.marks.length > 1 ? 'multi' : ''}" data-notes="${esc(seg.marks.map(m => m.id).join(','))}">${esc(seg.text)}</mark>`
      : esc(seg.text)).join('');
    const heading = p.text.length < 90 && !/[.。!;:,]$/.test(p.text) && !/\s{2,}/.test(p.text) && p.text.split(' ').length < 12;
    const tag = heading ? 'h3' : 'p';
    const zh = showZh ? R.tr.map[p.key] : '';
    return `<${tag} data-start="${p.start}" data-end="${p.end}" data-key="${esc(p.key)}">${inner}</${tag}>` + (zh ? `<p class="zh" data-zh="${esc(p.key)}">${esc(zh)}</p>` : '');
  }).join('');
  render(doc, html`${textBar()}<article class="article" id="article">${raw(blocks)}</article>`);
}

function textBar() {
  const paper = R.paper;
  const tr = R.tr;
  const total = R.paras.filter(p => translatable(p.text)).length;
  const done = R.paras.filter(p => translatable(p.text) && tr.map[p.key]).length;
  const src = R.textSource === 'paste' ? '粘贴的文本' : '没有文本';
  let trPart = '';
  if (paper.demo || !total) trPart = '';
  else if (tr.running) trPart = html`<span class="muted">翻译中 ${tr.running.done}/${tr.running.total} 段…</span><button class="btn btn-sm" data-tr="stop">停止</button>`;
  else if (!done) trPart = html`<button class="btn btn-sm btn-primary" data-tr="start" title="逐段翻译，用当前平台的快速模型；译文保存在本机，下次直接显示">全文翻译 · ${total} 段</button>`;
  else trPart = html`<label class="checkbox"><input type="checkbox" data-tr="toggle" ${paper.showTranslation ? 'checked' : ''}> 显示译文</label><span class="muted">已翻译 ${done}/${total} 段${tr.meta && tr.meta.model ? ' · ' + tr.meta.model : ''}</span>${done < total ? html`<button class="btn btn-sm" data-tr="start">继续翻译</button>` : html`<button class="btn btn-sm btn-ghost" data-tr="redo" title="丢弃已有译文，重新翻译全文">重新翻译</button>`}`;
  return html`<div class="doc-bar"><span class="muted">${src}</span>${paper.demo ? '' : html`<button class="btn btn-sm btn-ghost" data-src="paste">${R.textSource === 'paste' ? '编辑文本' : '粘贴原文'}</button>`}${R.pdfMissing ? html`<span class="muted">· PDF 不在这台浏览器里</span><button class="btn btn-sm btn-ghost" data-src="reimport" title="按文件哈希匹配，笔记和记录会自动关联">重新导入 PDF</button>` : ''}<span class="spacer"></span>${trPart}</div>`;
}

function refreshTextBar() {
  const old = $('.doc-bar');
  if (!old) return;
  const holder = document.createElement('div');
  render(holder, textBar());
  old.replaceWith(holder.firstElementChild);
}

function insertTranslations(results) {
  const article = $('#article');
  if (!article || !R.paper.showTranslation) return;
  for (const [key, zh] of results) {
    const el = article.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!el) continue;
    const next = el.nextElementSibling;
    if (next && next.dataset.zh === key) { next.textContent = zh; continue; }
    const z = document.createElement('p'); z.className = 'zh'; z.dataset.zh = key; z.textContent = zh;
    el.after(z);
  }
}

async function persistTranslation() {
  try { await dbPutTranslation(R.paper.id, { map: R.tr.map, meta: R.tr.meta }); } catch (err) { console.error(err); }
}

async function translateAll() {
  const paper = R.paper;
  if (paper.demo) { toast('示例论文不调用模型；导入自己的 PDF 后可用'); return; }
  if (paper.noAI) { toast('这篇论文已设为不发送给 AI', { type: 'error' }); return; }
  if (!aiReady(store.state.settings)) { toast('AI 未配置，请先到设置页填入 API Key', { type: 'error' }); return; }
  startTranslation();
}

// Paragraphs of one PDF page, reflowed from the text lines (cached per page).
function pageParas(n, lines = null) {
  if (R.pageParas[n]) return R.pageParas[n];
  const src = lines || (R.pdf ? R.pdf.pageLines(n) : []);
  if (!src.length) return [];
  const paras = reflowLines(src).map(p => ({ ...p, key: textKey(p.text), page: n }));
  R.pageParas[n] = paras;
  return paras;
}

async function pdfParagraphs() {
  const all = [];
  for (let n = 1; n <= R.pdf.pageCount; n++) {
    const lines = await R.pdf.ensurePageLines(n);
    if (!R || !R.pdf) return all;
    all.push(...pageParas(n, lines));
  }
  return all;
}

async function startTranslation() {
  const paper = R.paper;
  if (R.tr.running) return;
  await loadTranslation();
  let paras;
  if (R.view === 'pdf') { if (!R.pdf) return; paras = await pdfParagraphs(); if (!R || R.paper !== paper) return; }
  else paras = R.paras;
  const seen = new Set();
  const todo = paras.filter(p => translatable(p.text) && !R.tr.map[p.key] && !seen.has(p.key) && seen.add(p.key)).map(p => ({ key: p.key, text: p.text, page: p.page || null }));
  paper.showTranslation = true; store.save();
  if (R.view === 'pdf') R.pdf.showSide(true); else renderText();
  if (!todo.length) { updateTransBar(); toast('全文已经翻译过，直接显示'); return; }
  const pageOf = new Map(todo.map(p => [p.key, p.page]));
  const ctrl = translateParagraphs({
    settings: store.state.settings, paragraphs: todo,
    onResult: results => {
      if (!R || R.paper !== paper) return;
      const pages = new Set();
      for (const [k, zh] of results) { R.tr.map[k] = zh; if (pageOf.get(k)) pages.add(pageOf.get(k)); }
      R.tr.running.done += results.length;
      if (R.view === 'pdf') { if (R.pdf) R.pdf.refreshSide([...pages]); } else { insertTranslations(results); refreshTextBar(); }
      updateTransBar(); persistTranslation();
    },
  });
  R.tr.running = { done: 0, total: todo.length, abort: ctrl.abort };
  if (R.view === 'pdf') R.pdf.refreshSide(); else renderText();
  updateTransBar();
  const res = await ctrl.promise;
  if (!R || R.paper !== paper) return;
  R.tr.running = null;
  if (res.model) R.tr.meta = { model: res.model, provider: res.provider, at: new Date().toISOString() };
  await persistTranslation();
  if (res.ok) toast(`全文翻译完成：${res.done} 段`, { type: 'ok' });
  else if (res.aborted) toast(`已停止，保留了 ${res.done} 段译文`);
  else toast('翻译中断：' + res.error, { type: 'error', sticky: true });
  if (R.view === 'text') renderText(); else if (R.pdf) R.pdf.refreshSide();
  updateTransBar();
}

// Translation column next to a PDF page: each translated paragraph sits at the height of its source.
function renderSidePage(num, el, page) {
  if (!R || !R.pdf) return;
  const paras = pageParas(num);
  const W = page.width, H = page.height;
  el.innerHTML = '';
  const running = R.tr.running;
  const blocks = [];
  for (const p of paras) {
    if (!translatable(p.text)) continue;
    const zh = R.tr.map[p.key];
    if (!zh && !running) continue;
    const d = document.createElement('div');
    d.className = 'zh-para' + (p.heading ? ' heading' : '') + (zh ? '' : ' pending');
    d.textContent = zh || '…';
    d.style.top = (p.lines[0].y / H * 100).toFixed(2) + '%';
    d._rects = p.lines.map(l => ({ x: l.x / W, y: l.y / H, w: l.w / W, h: l.h / H }));
    el.append(d); blocks.push(d);
  }
  let bottom = 0;
  for (const d of blocks) { const top = Math.max(d.offsetTop, bottom); d.style.top = top + 'px'; bottom = top + d.offsetHeight + 4; }
  if (!blocks.length) el.innerHTML = `<div class="zh-status">${running ? '翻译中…' : paras.some(p => translatable(p.text)) ? '这一页还没有译文' : '这一页没有可翻译的文字'}</div>`;
  if (!el._wired) {
    el._wired = true;
    el.addEventListener('mouseover', e => { const d = e.target.closest('.zh-para'); if (!d || d === el._hover) return; clearSourceMarks(el); el._hover = d; for (const r of d._rects || []) { const b = document.createElement('div'); b.className = 'zh-src'; b.style.left = (r.x * 100) + '%'; b.style.top = (r.y * 100) + '%'; b.style.width = (r.w * 100) + '%'; b.style.height = (r.h * 100) + '%'; page.el.append(b); } });
    el.addEventListener('mouseleave', () => clearSourceMarks(el));
  }
}
function clearSourceMarks(el) { el._hover = null; document.querySelectorAll('.zh-src').forEach(b => b.remove()); }

// Paragraphs of the current document that already have a translation.
function coverage() {
  const paras = R.view === 'pdf' ? Object.values(R.pageParas).flat() : R.paras;
  let n = 0;
  for (const p of paras) if (R.tr.map[p.key]) n++;
  return n;
}

function updateTransBar() {
  const b = $('#transBtn'); if (!b || !R) return;
  const paper = R.paper;
  const has = coverage() > 0;
  const run = R.tr.running;
  const shown = !!paper.showTranslation && (has || !!run);
  b.textContent = run ? `翻译中 ${run.done}/${run.total}` : has ? '对照译文' : '全文翻译';
  b.classList.toggle('active', shown);
  b.setAttribute('aria-pressed', String(shown));
  $('#transStop').hidden = !run;
  $('#transMenu').hidden = !has || !!run;
}

async function onTransBtn() {
  const paper = R.paper;
  const has = coverage() > 0;
  if (!has && !R.tr.running) return translateAll();
  paper.showTranslation = !paper.showTranslation; store.save();
  if (R.view === 'pdf' && R.pdf) R.pdf.showSide(paper.showTranslation); else renderText();
  updateTransBar();
}

async function onTransMenu() {
  const paper = R.paper;
  const choice = await choiceDialog({ title: '译文', message: R.tr.meta ? `已有译文：${R.tr.meta.model || ''} · ${fmtDateTime(R.tr.meta.at)}。鼠标放在译文段落上会标出对应的原文。` : '', choices: [
    { id: 'continue', label: '继续翻译', desc: '只翻译还没有译文的段落' },
    { id: 'redo', label: '重新翻译', desc: '丢弃已有译文，重新调用模型' },
    { id: 'clear', label: '删除译文', desc: '从本机删除这篇论文的译文' },
  ] });
  if (!choice) return;
  if (choice === 'continue') return translateAll();
  if (choice === 'redo' && !await confirmDialog({ title: '重新翻译全文？', message: '已有的译文会被丢弃，重新调用模型翻译。', confirmText: '重新翻译', danger: true })) return;
  R.tr.map = {}; R.tr.meta = null;
  try { await dbDeleteTranslation(paper.id); } catch (err) { console.error(err); }
  if (choice === 'redo') return translateAll();
  paper.showTranslation = false; store.save();
  if (R.view === 'pdf' && R.pdf) R.pdf.showSide(false); else renderText();
  updateTransBar();
  toast('已删除译文');
}

async function onTextBarClick(b) {
  const paper = R.paper;
  if (b.dataset.src === 'paste') return pasteModal();
  if (b.dataset.src === 'reimport') return $('#fileInput').click();
  const act = b.dataset.tr;
  if (act === 'toggle') { paper.showTranslation = b.checked; store.save(); renderText(); updateTransBar(); }
  else if (act === 'start') translateAll();
  else if (act === 'stop') { if (R.tr.running) R.tr.running.abort(); }
  else if (act === 'redo') {
    if (!await confirmDialog({ title: '重新翻译全文？', message: '已有的译文会被丢弃，重新调用模型翻译。', confirmText: '重新翻译', danger: true })) return;
    R.tr.map = {}; R.tr.meta = null;
    try { await dbDeleteTranslation(paper.id); } catch (err) { console.error(err); }
    translateAll();
  }
}

function refreshMarks() {
  if (!R) return;
  if (R.view === 'pdf' && R.pdf) R.pdf.setHighlights(notesFor(R.paper.id));
  else if (R.view === 'text') { const top = $('#doc').scrollTop; renderText(); $('#doc').scrollTop = top; }
  refreshMarkers();
  if (R.assistant) R.assistant.refresh();
}

const AI_ACTIONS = ['translate', 'explain', 'summarize', 'ask'];

// Note markers on PDF pages: one small tag right after the text a comment or question belongs to.
// Highlights are visible on their own and translations are not notes, so neither gets a marker.
function refreshMarkers() {
  if (!R || !R.pdf || R.view !== 'pdf') return;
  const items = [];
  for (const n of notesFor(R.paper.id)) {
    if (!n.text || !n.anchor || n.anchor.kind !== 'pdf' || !(n.anchor.rects || []).length) continue;
    const rects = n.anchor.rects;
    const last = rects[rects.length - 1];
    items.push({ id: n.id, kind: 'note', page: n.anchor.page, x: last.x + last.w, y: last.y, title: (n.type === 'question' ? '疑问' : '笔记') + '：' + n.text.slice(0, 60) });
  }
  R.pdf.setMarkers(items);
}

// Card shown when a highlight, mark or margin marker is clicked: the note itself, in place.
function noteCard(n, rect) {
  const pop = $('#popover');
  const label = { highlight: '高亮', comment: '笔记', question: '疑问' };
  render(pop, html`<div class="pop-head"><span class="badge ${n.type === 'question' ? 'badge-warn' : 'badge-accent'}">${label[n.type]}${n.type === 'question' && n.resolved ? ' · 已解决' : ''}</span><span class="muted">${fmtDateTime(n.at)}</span><button class="icon-btn" data-close aria-label="关闭">×</button></div>
    ${n.quote ? html`<div class="quote" style="margin:4px 0 8px">${dehyphenate(n.quote).slice(0, 300)}</div>` : ''}
    <div class="pop-body">${n.text ? n.text : html`<span class="muted">这条高亮还没有说明，点「编辑」可以补一句。</span>`}</div>
    <div class="pop-actions"><button class="btn btn-sm" data-edit>编辑</button>${n.type === 'question' && !n.resolved ? html`<button class="btn btn-sm" data-resolve>标为已解决</button>` : ''}<button class="btn btn-sm btn-ghost" data-side>在侧栏查看</button><span style="flex:1"></span><button class="btn btn-sm btn-ghost" data-delete>删除</button></div>`);
  placePopover(rect);
  pop.querySelector('[data-close]').onclick = hidePopover;
  pop.querySelector('[data-edit]').onclick = () => noteEditor(n, rect);
  pop.querySelector('[data-side]').onclick = () => { hidePopover(); R.assistant.showNote(n.id); };
  pop.querySelector('[data-delete]').onclick = () => { store.state.notes = store.state.notes.filter(x => x.id !== n.id); store.save(); hidePopover(); refreshMarks(); toast('已删除'); };
  const res = pop.querySelector('[data-resolve]'); if (res) res.onclick = () => { n.resolved = true; store.save(); hidePopover(); refreshMarks(); };
}

// A margin marker may hold several notes and answers; list them, or open directly when there is one.
function markerPopover(ids, rect) {
  const notes = ids.map(id => store.state.notes.find(x => x.id === id)).filter(Boolean);
  const events = ids.map(id => store.state.events.find(x => x.id === id)).filter(Boolean);
  if (notes.length === 1 && !events.length) return noteCard(notes[0], rect);
  if (events.length === 1 && !notes.length) { R.assistant.showEvent(events[0].id); return; }
  const pop = $('#popover');
  const names = { translate: '翻译', explain: '解释', summarize: '总结', ask: '提问' };
  render(pop, html`<div class="pop-head"><span class="badge badge-accent">这一处的记录</span><span class="muted">${notes.length + events.length} 条</span><button class="icon-btn" data-close aria-label="关闭">×</button></div>
    <div class="pop-body stack">
      ${notes.map(n => html`<button class="choice" data-note-id="${n.id}"><b>${n.type === 'highlight' ? '高亮' : n.type === 'question' ? '疑问' : '笔记'}</b><small>${(n.text || n.quote || '').slice(0, 90)}</small></button>`)}
      ${events.map(e => html`<button class="choice" data-event-id="${e.id}"><b>✦ ${names[e.action] || e.action}</b><small>${(e.question || e.quote || '').slice(0, 90)}</small></button>`)}
    </div>`);
  placePopover(rect);
  pop.querySelector('[data-close]').onclick = hidePopover;
  pop.querySelectorAll('[data-note-id]').forEach(b => b.onclick = () => { const n = store.state.notes.find(x => x.id === b.dataset.noteId); if (n) noteCard(n, rect); });
  pop.querySelectorAll('[data-event-id]').forEach(b => b.onclick = () => { hidePopover(); R.assistant.showEvent(b.dataset.eventId); });
}

// ---------- selection ----------
function readSelection() {
  if (!R) return null;
  if (R.view === 'pdf' && R.pdf) {
    const info = R.pdf.selectionInfo();
    if (!info) return null;
    const anchor = makePdfAnchor({ page: info.page, quote: info.quote, pageText: info.pageText, rects: info.rects });
    const loc = locateQuote(info.pageText, info.quote);
    const context = loc ? info.pageText.slice(Math.max(0, loc.start - 500), loc.end + 500) : info.pageText.slice(0, 1000);
    return { quote: info.quote, quoteClean: dehyphenate(info.quote), anchor, context: dehyphenate(context.replace(/\s+/g, ' ').trim()), bounding: info.bounding };
  }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const article = $('#article');
  if (!article || !article.contains(range.startContainer) || !article.contains(range.endContainer)) return null;
  const blockOf = node => (node.nodeType === 1 ? node : node.parentElement).closest('[data-start]');
  const sb = blockOf(range.startContainer), eb = blockOf(range.endContainer);
  if (!sb || !eb) return null;
  const offsetIn = (block, node, offset) => { const r = document.createRange(); r.setStart(block, 0); r.setEnd(node, offset); return r.toString().length; };
  const start = Number(sb.dataset.start) + offsetIn(sb, range.startContainer, range.startOffset);
  const end = Number(eb.dataset.start) + offsetIn(eb, range.endContainer, range.endOffset);
  if (end <= start) return null;
  const quote = R.text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (!quote) return null;
  return { quote, quoteClean: quote, anchor: makeTextAnchor(R.text, start, end), context: R.text.slice(Math.max(0, start - 400), end + 400).replace(/\s+/g, ' ').trim(), bounding: range.getBoundingClientRect() };
}



function showToolbar(rect) {
  const tb = $('#selToolbar');
  tb.hidden = false;
  const w = tb.offsetWidth || 360;
  tb.style.left = Math.max(8, Math.min(rect.left + rect.width / 2 - w / 2, window.innerWidth - w - 8)) + 'px';
  tb.style.top = Math.max(8, (rect.top < 60 ? rect.bottom + 8 : rect.top - 44)) + 'px';
}
function hideToolbar() { const tb = $('#selToolbar'); if (tb) tb.hidden = true; }

// Selection handles (touch), shift+arrow extension and double-click all change the selection without a
// mouseup; keep the stored selection and the toolbar in step with what is actually selected.
const onSelectionChange = debounce(() => {
  if (!R) return;
  if ($('#modal').open) return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;
  const info = readSelection();
  if (info) { R.sel = info; showToolbar(info.bounding); }
}, 120);

function onMouseUp(e) {
  if (!e.target || e.target.nodeType !== 1) return;
  if (!R) return;
  if (e.target.closest('#selToolbar, #popover, dialog, .assistant, .reader-bar')) return;
  setTimeout(() => {
    if (!R) return;
    const sel = readSelection();
    if (sel) { R.sel = sel; showToolbar(sel.bounding); touchSession(store.state, R.paper.id); }
    else { R.sel = null; hideToolbar(); }
  }, 0);
}

// ---------- actions ----------
async function act(action) {
  // Always prefer the live selection: handles dragged on touch screens or keyboard-extended selections
  // change the selection without another mouseup.
  const live = readSelection();
  if (live) R.sel = live;
  const sel = R.sel;
  if (!sel && action !== 'ask') { toast('先在原文中选中一段文字'); return; }
  const paper = R.paper;
  hideToolbar();
  if (action === 'translate') return translatePopover(sel);
  if (action === 'explain' || action === 'summarize') { ensureAssistant(); R.assistant.runAction(action, sel); return; }
  if (action === 'ask') { ensureAssistant(); R.assistant.focusAsk(sel); return; }
  if (action === 'highlight') {
    addNote('highlight', sel, '');
    R.sel = null;
    window.getSelection().removeAllRanges();
    toast('已高亮', { type: 'ok' });
    return;
  }
  if (action === 'note') return notePopover(sel);
  if (action === 'english') {
    const term = (sel.quoteClean || sel.quote).replace(/\s+/g, ' ').trim().slice(0, 240);
    const sentence = sentenceAround(sel.context, term);
    editKnowledgeModal(null, () => R && R.assistant.refresh(), { kind: isSingleWordTerm(term) ? 'word' : 'phrase', paperId: paper.id, term, sourceQuote: sentence && sentence !== term ? sentence : '', contexts: sentence && sentence !== term ? [{ paperId: paper.id, sentence, page: sel.anchor && sel.anchor.page || null, at: new Date().toISOString() }] : [] });
  }
}

function ensureAssistant() {
  if (store.state.layout.assistantVisible === false) { store.state.layout.assistantVisible = true; store.save(); applyLayout(); }
}

function addNote(type, sel, text) {
  const n = newNote({ paperId: R.paper.id, type, anchor: sel.anchor, quote: sel.quoteClean || sel.quote, text });
  store.state.notes.push(n);
  store.state.events.push(newEvent({ paperId: R.paper.id, action: type === 'highlight' ? 'highlight' : 'note', scope: 'selection', quote: sel.quote, anchor: sel.anchor, response: text, status: 'done' }));
  touchSession(store.state, R.paper.id);
  const r = store.save();
  refreshMarks();
  return r.ok ? n : null;
}

// ---------- popovers ----------
function placePopover(rect) {
  const pop = $('#popover');
  pop.hidden = false;
  const w = pop.offsetWidth || 440, h = pop.offsetHeight || 200;
  let top = rect.bottom + 10;
  if (top + h > window.innerHeight - 10) top = Math.max(10, rect.top - h - 10);
  pop.style.top = top + 'px';
  pop.style.left = Math.max(10, Math.min(rect.left, window.innerWidth - w - 10)) + 'px';
}
function hidePopover() { const pop = $('#popover'); if (pop) { pop.hidden = true; pop.innerHTML = ''; } }

async function translatePopover(sel) {
  const pop = $('#popover');
  // Single words: offline dictionary first (instant), AI only on request or when the word is unknown.
  if (isSingleWord(sel.quoteClean || sel.quote)) {
    render(pop, html`<div class="pop-head"><span class="badge badge-accent">词典</span><span>查询中…</span><button class="icon-btn" data-close aria-label="关闭">×</button></div>`);
    placePopover(sel.bounding);
    pop.querySelector('[data-close]').onclick = hidePopover;
    let entry = null;
    try { entry = await lookupWord(sel.quoteClean || sel.quote); } catch (err) { console.warn(err); }
    if (!R || pop.hidden) return;
    if (entry) {
      const inBook = !!findVocab(store.state, entry.word) || !!findVocab(store.state, entry.input);
      const sentence = sentenceAround(sel.context, sel.quoteClean || sel.quote);
      const ev = mkEvent({ paperId: R.paper.id, action: 'translate', scope: 'selection', quote: sel.quoteClean || sel.quote, anchor: sel.anchor, response: entry.translation, provider: 'dictionary', model: '词典', status: 'done', latencyMs: 0 });
      store.state.events.push(ev); touchSession(store.state, R.paper.id);
      let autoAdded = false;
      if (store.state.settings.autoVocab && !inBook) { addToVocab(store.state, { term: entry.word, meaning: entry.translation.split('\n')[0], phonetic: entry.phonetic, paperId: R.paper.id, sentence, page: sel.anchor && sel.anchor.page, sourceEventId: ev.id, schedule: false }); autoAdded = true; }
      store.save(); R.assistant.refresh();
      const renderDict = added => render(pop, html`<div class="pop-head"><span class="badge badge-accent">词典</span><span><b>${entry.word}</b>${entry.phonetic ? html` <span class="muted">/${entry.phonetic}/</span>` : ''}${entry.tags.length ? html` · <span class="muted">${entry.tags.join(' ')}</span>` : ''}</span><button class="icon-btn" data-close aria-label="关闭">×</button></div>
        <div class="pop-body dict-body">${entry.translation.split('\n').map(l => html`<div>${l}</div>`)}</div>
        <div class="pop-actions"><button class="btn btn-sm ${added ? '' : 'btn-primary'}" data-vocab ${added ? 'disabled' : ''}>${added ? (autoAdded ? '已自动加入生词本' : '已在生词本') : '加入生词本'}</button><button class="btn btn-sm" data-ai>AI 看语境</button><span style="flex:1"></span><span class="hint">离线词典</span></div>`);
      renderDict(inBook || autoAdded);
      placePopover(sel.bounding);
      const wire = () => {
        pop.querySelector('[data-close]').onclick = hidePopover;
        pop.querySelector('[data-ai]').onclick = () => aiTranslatePopover(sel);
        const vb = pop.querySelector('[data-vocab]');
        if (vb) vb.onclick = () => {
          const r = addToVocab(store.state, { term: entry.word, meaning: entry.translation.split('\n')[0], phonetic: entry.phonetic, paperId: R.paper.id, sentence, page: sel.anchor && sel.anchor.page, sourceEventId: ev.id });
          store.save(); R.assistant.refresh();
          toast(r.created ? `「${entry.word}」已加入生词本，明天开始复习` : `「${entry.word}」已在生词本，补充了这条出处`, { type: 'ok' });
          renderDict(true); wire();
        };
      };
      wire();
      return;
    }
  }
  return aiTranslatePopover(sel);
}

function aiTranslatePopover(sel) {
  const pop = $('#popover');
  const short = isShortPhrase(sel.quoteClean || sel.quote);
  render(pop, html`<div class="pop-head"><span class="badge badge-accent">翻译</span><span id="popMeta">准备中…</span><button class="icon-btn" data-close aria-label="关闭">×</button></div><div class="pop-body md streaming-dot" id="popBody"></div><div class="pop-actions"><button class="btn btn-sm" data-english>${short ? '加入生词本' : '存为表达'}</button><button class="btn btn-sm btn-ghost" data-explain>继续解释</button></div>`);
  placePopover(sel.bounding);
  ensureAssistant();
  let current = null;
  R.assistant.runAction('translate', sel, {
    onUpdate: ev => {
      current = ev;
      const body = $('#popBody'); const meta = $('#popMeta');
      if (!body) return;
      if (ev.status === 'unavailable') { render(body, html`<span class="muted">${ev.error}</span>`); body.classList.remove('streaming-dot'); meta.textContent = '未调用 AI'; }
      else if (ev.status === 'error') { render(body, html`<span class="muted">${ev.error}</span>`); body.classList.remove('streaming-dot'); meta.textContent = '失败'; }
      else { if (ev.response) { render(body, markdownLite(ev.response)); renderMath(body); } else if (ev.thinking) render(body, html`<span class="muted">模型思考中…</span>`); if (ev.status !== 'streaming') { body.classList.remove('streaming-dot'); meta.textContent = (ev.status === 'demo' ? '示例译文' : ev.model) + (ev.latencyMs ? ' · ' + (ev.latencyMs / 1000).toFixed(1) + 's' : ''); } else meta.textContent = ev.thinking && !ev.response ? '思考中…' : '生成中…'; }
    },
  });
  pop.querySelector('[data-close]').onclick = hidePopover;
  pop.querySelector('[data-english]').onclick = () => {
    const term = (sel.quoteClean || sel.quote).slice(0, 240);
    const meaning = current && ['done', 'demo'].includes(current.status) ? current.response.replace(/\*\*/g, '').split('\n')[0].replace(/^本句中的意思[：:]\s*/, '').slice(0, 200) : '';
    if (short) {
      const r = addToVocab(store.state, { term, meaning, paperId: R.paper.id, sentence: sentenceAround(sel.context, term), page: sel.anchor && sel.anchor.page, sourceEventId: current ? current.id : null });
      store.save(); R.assistant.refresh();
      toast(r.created ? `「${term}」已加入生词本，明天开始复习` : `「${term}」已在生词本，补充了这条出处`, { type: 'ok' });
      return;
    }
    hidePopover(); editKnowledgeModal(null, () => R && R.assistant.refresh(), { kind: 'phrase', paperId: R.paper.id, term, meaning, sourceQuote: sentenceAround(sel.context, term) || '', sourceEventId: current ? current.id : null });
  };
  pop.querySelector('[data-explain]').onclick = () => { hidePopover(); R.assistant.runAction('explain', sel); };
}

function notePopover(sel) {
  const pop = $('#popover');
  render(pop, html`<div class="pop-head"><span class="badge badge-accent">笔记</span><span class="truncate">${sel.quote.slice(0, 80)}</span><button class="icon-btn" data-close aria-label="关闭">×</button></div>
    <textarea id="noteText" placeholder="我的理解、疑问，或和我的研究的关系…"></textarea>
    <div class="pop-actions"><label class="checkbox"><input type="radio" name="ntype" value="comment" checked> 笔记</label><label class="checkbox"><input type="radio" name="ntype" value="question"> 疑问（会进入待解决）</label><span style="flex:1"></span><button class="btn btn-sm btn-primary" data-save>保存</button></div>`);
  placePopover(sel.bounding);
  const ta = $('#noteText'); ta.focus();
  const save = () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    const type = pop.querySelector('input[name=ntype]:checked').value;
    addNote(type, sel, text);
    R.sel = null;
    hidePopover();
    window.getSelection().removeAllRanges();
    toast('笔记已保存', { type: 'ok' });
  };
  pop.querySelector('[data-save]').onclick = save;
  ta.onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); };
  pop.querySelector('[data-close]').onclick = hidePopover;
}

function noteEditor(n, rect) {
  const pop = $('#popover');
  const label = { highlight: '高亮', comment: '笔记', question: '疑问' };
  render(pop, html`<div class="pop-head"><span class="badge badge-accent">${label[n.type]}</span><span class="truncate">${n.quote.slice(0, 80)}</span><button class="icon-btn" data-close aria-label="关闭">×</button></div>
    <textarea id="noteText" placeholder="${n.type === 'highlight' ? '给这条高亮加一句说明（可选）' : ''}">${n.text}</textarea>
    <div class="pop-actions"><button class="btn btn-sm btn-primary" data-save>保存</button>${n.type === 'question' && !n.resolved ? html`<button class="btn btn-sm" data-resolve>标为已解决</button>` : ''}<span style="flex:1"></span><button class="btn btn-sm btn-ghost" data-delete>删除</button></div>`);
  placePopover(rect || { left: window.innerWidth / 2 - 220, top: 120, bottom: 120, width: 0 });
  const ta = $('#noteText'); ta.focus();
  pop.querySelector('[data-save]').onclick = () => { n.text = ta.value.trim(); if (n.type === 'highlight' && n.text) n.type = 'comment'; store.save(); hidePopover(); refreshMarks(); };
  pop.querySelector('[data-delete]').onclick = () => { store.state.notes = store.state.notes.filter(x => x.id !== n.id); store.save(); hidePopover(); refreshMarks(); toast('已删除'); };
  const res = pop.querySelector('[data-resolve]'); if (res) res.onclick = () => { n.resolved = true; store.save(); hidePopover(); refreshMarks(); };
  pop.querySelector('[data-close]').onclick = hidePopover;
}

function pasteModal() {
  const p = R.paper;
  const dlg = modal({ title: '粘贴原文片段', wide: true, body: html`<p class="small muted">从 PDF 复制一段原文贴在这里。文本视图适合逐句翻译和精读；已有的高亮会按原文内容重新定位。</p><textarea id="pasteText" style="min-height:260px;font-family:var(--font-article)">${p.excerptText}</textarea><div class="modal-actions"><button class="btn" data-cancel>取消</button><button class="btn btn-primary" data-ok>使用这段文本</button></div>` });
  dlg.querySelector('[data-cancel]').onclick = closeModal;
  dlg.querySelector('[data-ok]').onclick = () => {
    if (p.demo) { toast('示例文本固定，请导入自己的 PDF 后再粘贴', { type: 'error' }); return; }
    p.excerptText = $('#pasteText').value.replace(/\r\n?/g, '\n').trim();
    p.readerView = 'text'; R.view = 'text';
    store.save(); closeModal(); showDoc();
  };
  $('#pasteText').focus();
}

// ---------- navigation inside the document ----------
function jumpTo(anchor, quote) {
  if (!anchor) { toast('这条记录没有原文位置'); return; }
  if (anchor.kind === 'pdf') {
    if (R.view !== 'pdf') { toast('这条位置在 PDF 里，这篇论文现在没有 PDF'); return; }
    if (R.pdf && !R.pdf.showAnchor(anchor)) { toast('找不到对应页面'); return; }
    if (anchor.region && anchor.rects && anchor.rects[0]) flashRegion(anchor.page, anchor.rects[0]);
    return;
  }
  if (anchor.kind === 'text') {
    if (R.view !== 'text') { toast('这条标注是在旧的文本视图里做的，PDF 里无法定位'); return; }
    jumpText(anchor, quote);
  }
}
function flashRegion(page, rect) {
  const pageEl = document.querySelector(`.pdf-page[data-page="${page}"]`);
  if (!pageEl) return;
  const box = document.createElement('div'); box.className = 'region-box region-flash';
  box.style.left = (rect.x * 100) + '%'; box.style.top = (rect.y * 100) + '%'; box.style.width = (rect.w * 100) + '%'; box.style.height = (rect.h * 100) + '%';
  pageEl.append(box);
  setTimeout(() => box.remove(), 2200);
}

function jumpText(anchor, quote) {
  const loc = resolveTextAnchor(R.text, anchor) || (quote ? locateQuote(R.text, quote) : null);
  if (!loc) { toast('原文片段已变化，请按引用内容查找'); return; }
  const block = $$('#article [data-start]').find(b => Number(b.dataset.start) <= loc.start && Number(b.dataset.end) >= loc.start);
  if (!block) return;
  block.scrollIntoView({ block: 'center', behavior: 'smooth' });
  block.style.transition = 'background .3s'; block.style.background = 'var(--accent-soft)';
  setTimeout(() => { block.style.background = ''; }, 1200);
}

// ---------- region capture (figure / formula screenshot) ----------
function setRegionMode(on) {
  if (!R) return;
  if (on && (R.view !== 'pdf' || !R.pdf)) { toast('截图提问只在 PDF 视图里可用'); return; }
  R.regionMode = !!on;
  document.body.classList.toggle('region-mode', R.regionMode);
  const b = $('#regionBtn'); if (b) { b.setAttribute('aria-pressed', String(R.regionMode)); b.classList.toggle('active', R.regionMode); }
  if (R.regionMode) { hideToolbar(); hidePopover(); window.getSelection().removeAllRanges(); toast('在 PDF 上拖一个框，框住图、表或公式'); }
  else if (R.regionBox) { R.regionBox.remove(); R.regionBox = null; }
}

function regionPointerDown(e) {
  if (!R || !R.regionMode || e.button !== 0) return;
  const pageEl = e.target.closest('.pdf-page');
  if (!pageEl) return;
  e.preventDefault();
  const pr = pageEl.getBoundingClientRect();
  const box = document.createElement('div'); box.className = 'region-box';
  pageEl.append(box);
  if (R.regionBox) R.regionBox.remove();
  R.regionBox = box;
  const start = { x: e.clientX - pr.left, y: e.clientY - pr.top };
  const update = ev => {
    const x = Math.max(0, Math.min(pr.width, ev.clientX - pr.left)), y = Math.max(0, Math.min(pr.height, ev.clientY - pr.top));
    const l = Math.min(start.x, x), t = Math.min(start.y, y), w = Math.abs(x - start.x), h = Math.abs(y - start.y);
    box.style.left = l + 'px'; box.style.top = t + 'px'; box.style.width = w + 'px'; box.style.height = h + 'px';
    return { x: l / pr.width, y: t / pr.height, w: w / pr.width, h: h / pr.height, px: { l, t, w, h } };
  };
  update(e);
  const move = ev => update(ev);
  const up = async ev => {
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
    const rect = update(ev);
    if (rect.px.w < 12 || rect.px.h < 12) { box.remove(); R.regionBox = null; return; }
    setRegionMode(false);
    R.regionBox = box;
    await attachRegion(Number(pageEl.dataset.page), rect, box);
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
}

// A framed region becomes an attachment in the assistant's ask box; the question is typed there.
async function attachRegion(page, rect, box) {
  let dataUrl = null;
  try { dataUrl = await R.pdf.renderRegion(page, rect); } catch (err) { console.error(err); }
  box.remove(); if (R) R.regionBox = null;
  if (!R) return;
  if (!dataUrl) { toast('截图失败', { type: 'error' }); return; }
  const thumb = await makeThumb(dataUrl, 360);
  const anchor = { kind: 'pdf', page, quote: '', prefix: '', suffix: '', rects: [{ x: rect.x, y: rect.y, w: rect.w, h: rect.h }], region: true };
  ensureAssistant();
  R.assistant.attachImage({ dataUrl, thumb, anchor, page, pageText: R.pdf.pageText(page) });
  flashRegion(page, rect);
}

function makeThumb(dataUrl, maxW) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// ---------- session end ----------
async function endReading() {
  const paper = R.paper;
  const choice = await choiceDialog({ title: '结束本次阅读', message: '这次读到哪一步？会记入阅读会话，并决定论文状态。', choices: [
    { id: 'finished', label: '读完了', desc: '论文标为「已读完」，接着去写复盘' },
    { id: 'partial', label: '读了一部分', desc: '保持「阅读中」，下次从这里继续' },
    { id: 'parked', label: '先放着', desc: '标为「搁置」，从首页移到论文库' },
  ] });
  if (!choice) return;
  const s = store.state;
  endSession(s, paper.id, choice);
  paper.status = choice === 'finished' ? 'read' : choice === 'parked' ? 'parked' : 'reading';
  s.events.push(newEvent({ paperId: paper.id, action: 'session_end', scope: 'paper', response: choice, status: 'done' }));
  savePosition.flush();
  store.save();
  location.hash = choice === 'finished' ? '#/review/' + paper.id : '#/home';
}

// ---------- position persistence ----------
const savePosition = debounce(() => {
  if (!R) return;
  const doc = $('#doc');
  if (!doc) return;
  const pos = R.paper.readerPos || (R.paper.readerPos = {});
  if (R.view === 'pdf' && R.pdf) { pos.page = R.pdf.current; pos.scrollTop = doc.scrollTop; pos.zoom = R.pdf.zoom; }
  else pos.textScroll = doc.scrollTop;
  touchSession(store.state, R.paper.id);
  store.save();
}, 900);

// ---------- wiring ----------
function wire() {
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); R.off.push(() => target.removeEventListener(type, fn, opts)); };
  on(document, 'mouseup', onMouseUp);
  on(document, 'selectionchange', onSelectionChange);
  on(document, 'mousedown', e => { if (!e.target.closest('#selToolbar')) { /* keep popover unless clicking outside it */ if (!e.target.closest('#popover') && !e.target.closest('dialog')) { const pop = $('#popover'); if (!pop.hidden && !pop.querySelector('textarea')) hidePopover(); } } });
  on($('#selToolbar'), 'mousedown', e => e.preventDefault());
  on($('#selToolbar'), 'click', e => { const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act); });
  on(document, 'keydown', onKey);
  on($('#doc'), 'scroll', () => savePosition(), { passive: true });
  on($('#doc'), 'click', e => {
    const bar = e.target.closest('[data-tr], [data-src]');
    if (bar) { onTextBarClick(bar); return; }
    const marker = e.target.closest('.pdf-marker');
    if (marker) { e.preventDefault(); markerPopover(marker.dataset.ids.split(','), marker.getBoundingClientRect()); return; }
    const mark = e.target.closest('mark[data-notes]');
    if (mark) { const ids = mark.dataset.notes.split(','); if (ids.length > 1) markerPopover(ids, mark.getBoundingClientRect()); else { const n = store.state.notes.find(x => x.id === ids[0]); if (n) noteCard(n, mark.getBoundingClientRect()); } return; }
    const hl = e.target.closest('.pdf-hl');
    if (hl) { const n = store.state.notes.find(x => x.id === hl.dataset.note); if (n) noteCard(n, hl.getBoundingClientRect()); }
  });
  $('#rTitle').onclick = () => editPaperModal(R.paper.id, p => { const t = $('#rTitle'); if (t) render(t, html`${p.title}<small>${PAPER_STATUS[p.status]}${p.noAI ? ' · 不发 AI' : ''}</small>`); });
  $('#regionBtn').onclick = () => setRegionMode(!R.regionMode);
  on($('#doc'), 'pointerdown', regionPointerDown);
  $('#focusBtn').onclick = () => { R.focus = !R.focus; applyLayout(); };
  $('#assistantRail').onclick = () => { store.state.layout.assistantVisible = true; store.save(); applyLayout(); };
  const tb = $('#transBtn'); if (tb) { tb.onclick = onTransBtn; $('#transStop').onclick = () => { if (R.tr.running) R.tr.running.abort(); }; $('#transMenu').onclick = onTransMenu; }
  $('#endBtn').onclick = endReading;
  $('#pager').onclick = e => { const b = e.target.closest('[data-zoom]'); if (!b || !R.pdf) return; if (b.dataset.zoom === 'auto') R.pdf.setZoom('auto'); else R.pdf.zoomStep(Number(b.dataset.zoom)); updateZoomLabel(); savePosition(); };
  $('#pageInput').onchange = e => { const n = Number(e.target.value); if (R.pdf && n >= 1 && n <= R.pdf.pageCount) R.pdf.goTo(n); };
  $('#pageInput').onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
  // divider drag
  const divider = $('#divider');
  let dragging = false;
  divider.onpointerdown = e => { if (e.button !== 0) return; dragging = true; divider.setPointerCapture(e.pointerId); document.body.classList.add('reader-resizing'); e.preventDefault(); };
  divider.onpointermove = e => { if (!dragging) return; const box = $('.reader-body').getBoundingClientRect(); store.state.layout.assistantWidth = Math.round(Math.max(320, Math.min(760, box.right - e.clientX))); applyLayout(); };
  const stop = () => { if (!dragging) return; dragging = false; document.body.classList.remove('reader-resizing'); store.save(); };
  divider.onpointerup = stop; divider.onpointercancel = stop; divider.onlostpointercapture = stop;
  divider.onkeydown = e => { if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); store.state.layout.assistantWidth = Math.max(320, Math.min(760, (store.state.layout.assistantWidth || 440) + (e.key === 'ArrowLeft' ? 20 : -20))); store.save(); applyLayout(); };
}

function onKey(e) {
  if (!R) return;
  if (e.key === 'Escape') { hidePopover(); hideToolbar(); if (R.regionMode) setRegionMode(false); if (R.regionBox) { R.regionBox.remove(); R.regionBox = null; } if (R.focus) { R.focus = false; applyLayout(); } return; }
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  if (e.target.closest('input, textarea, select, [contenteditable]') || $('#modal').open) return;
  const k = e.key.toLowerCase();
  if (k === '/') { e.preventDefault(); ensureAssistant(); R.assistant.focusAsk(R.sel); return; }
  if (k === 'f') { e.preventDefault(); R.focus = !R.focus; applyLayout(); return; }
  if (k === 'i') { e.preventDefault(); setRegionMode(!R.regionMode); return; }
  const map = { t: 'translate', e: 'explain', q: 'ask', h: 'highlight', b: 'note', s: 'summarize' };
  if (map[k]) { if (!R.sel && k !== 'q') return; e.preventDefault(); act(map[k]); }
}
