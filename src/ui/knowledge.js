// Knowledge page (#/knowledge) and the shared editors: item editor, explanation viewer, glossary import.
import { store } from '../state/store.js';
import { ACTION_NAMES, newKnowledge } from '../state/schema.js';
import { $, $$, html, render, fmtDate, modal, closeModal, confirmDialog, download, toast, markdownLite } from './dom.js';
import { applyRecall, scheduleFirstReview, dueItems } from '../domain/review.js';
import { knowledgeMarkdown } from '../domain/export.js';
import { recentLookups, addToVocab } from '../domain/vocab.js';
import { KINDS, KIND_LABELS, STATUS_LABELS, parseGlossary, findByTerm, isSingleWordTerm } from '../domain/knowledge.js';
import { anchorLabel } from '../domain/anchors.js';
import { renderMath } from './math.js';
import { renderDiagrams } from './mermaid.js';
import { renderSvgFigures } from './figures.js';

const filters = { kind: '', status: '', q: '' };
const EMPTY_HINT = {
  '': '还没有条目。读论文时：解释后点「存为概念」，查词后点「加入生词本」，选中好句子点「存表达」。',
  concept: '还没有概念。在解释或提问的回答下方点「存为概念」，或在导读回答下方点「导入术语表」。',
  word: '生词本是空的。划词翻译后点「加入生词本」。',
  phrase: '还没有表达。选中一句写作时想借用的句式，在选区工具栏点「存表达」。',
};
const FIELD_LABELS = {
  concept: { term: '概念名称', meaning: '定义（它是什么，一两句）', note: '我的理解（为什么重要、和我的研究的关系）', example: '例子（可选）', missing: '还没写定义' },
  word: { term: '单词', meaning: '释义', note: '备注（可选）', example: '例句（可选）', missing: '还没写释义' },
  phrase: { term: '表达 / 句式', meaning: '含义与用法', note: '备注（可选）', example: '我的例句（写作时能直接用）', missing: '还没写含义' },
};

export function kindBadge(kind) { return html`<span class="badge badge-${kind}">${KIND_LABELS[kind] || kind}</span>`; }
export function statusBadge(k, due = false) {
  return due ? html`<span class="badge badge-warn">到期</span>` : html`<span class="badge ${k.status === 'known' ? 'badge-ok' : ''}">${STATUS_LABELS[k.status] || k.status}</span>`;
}

export function show(container) {
  const s = store.state;
  const now = new Date().toISOString();
  const dueIds = new Set(dueItems(s.knowledge, now).map(k => k.id));
  const q = filters.q.toLowerCase();
  const items = s.knowledge.filter(k => (!filters.kind || k.kind === filters.kind)
    && (!filters.status || (filters.status === 'due' ? dueIds.has(k.id) : k.status === filters.status))
    && (!q || [k.term, k.meaning, k.note, k.example].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => (dueIds.has(b.id) - dueIds.has(a.id)) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  const paperTitle = id => s.papers.find(p => p.id === id)?.title || '已删除的论文';
  const count = kind => s.knowledge.filter(k => k.kind === kind).length;
  const eventOf = k => k.sourceEventId ? s.events.find(e => e.id === k.sourceEventId) : null;
  const lookups = recentLookups(s, 30);

  const card = k => {
    const ev = eventOf(k);
    const ctxs = k.contexts || [];
    const page = (ctxs[0] && ctxs[0].page) || (ev && ev.anchor && ev.anchor.page) || null;
    return html`<div class="item k-item" data-k="${k.id}">
      <div class="item-main">
        <div class="item-title">${kindBadge(k.kind)} ${k.term}${k.kind === 'word' && k.phonetic ? html` <span class="muted small">/${k.phonetic}/</span>` : ''} ${statusBadge(k, dueIds.has(k.id))}</div>
        <div class="k-def">${k.meaning || html`<span class="muted">${FIELD_LABELS[k.kind].missing}</span>`}</div>
        ${k.note ? html`<div class="k-note"><span class="k-label">我的理解</span>${k.note}</div>` : ''}
        ${k.example ? html`<div class="k-note"><span class="k-label">${k.kind === 'phrase' ? '我的例句' : '例子'}</span>${k.example}</div>` : ''}
        ${ctxs.length ? ctxs.slice(0, 3).map(c => html`<div class="quote">${c.sentence}<div class="small muted k-src"><a href="#/read/${c.paperId}">${paperTitle(c.paperId)}</a>${c.page ? ` · 第 ${c.page} 页` : ''}</div></div>`) : k.sourceQuote ? html`<div class="quote">${k.sourceQuote.slice(0, 220)}</div>` : ''}
        ${ctxs.length > 3 ? html`<div class="small muted">还有 ${ctxs.length - 3} 处出处</div>` : ''}
        <div class="item-meta"><a href="#/read/${k.paperId}">${paperTitle(k.paperId)}</a>${page && !ctxs.length ? ` · 第 ${page} 页` : ''} · ${fmtDate(k.createdAt)}${k.nextReviewAt && k.status !== 'known' ? ` · 下次复习 ${fmtDate(k.nextReviewAt)}` : ''}${k.reviewCount ? ` · 已复习 ${k.reviewCount} 次` : ''}</div>
      </div>
      <div class="item-actions k-actions">
        <span class="row">${k.status === 'new' ? html`<button class="btn btn-sm" data-schedule="${k.id}">排入复习</button>` : k.status === 'known' ? '' : html`<button class="btn btn-sm" data-recall="${k.id}" data-ok="1">记得</button><button class="btn btn-sm" data-recall="${k.id}" data-ok="0">不记得</button>`}</span>
        <span class="row">${ev && ev.response ? html`<button class="btn btn-sm btn-ghost" data-explain="${k.id}">${k.kind === 'concept' ? '查看解释' : '查看出处'}</button>` : ''}<button class="icon-btn" data-edit="${k.id}" aria-label="编辑">✎</button><button class="icon-btn" data-delete="${k.id}" aria-label="删除">×</button></span>
      </div></div>`;
  };

  render(container, html`<div class="page">
    <div class="page-head"><div><h1>知识</h1><p>概念 ${count('concept')} · 生词 ${count('word')} · 表达 ${count('phrase')}${dueIds.size ? html` · <b>${dueIds.size} 条到期待复习</b>` : ''}</p></div>
      <div class="page-actions"><button class="btn" data-add>＋ 添加</button><button class="btn" data-export>导出 Markdown</button></div></div>
    <div class="lib-toolbar">
      <input type="search" id="kSearch" placeholder="搜索条目" value="${filters.q}" aria-label="搜索">
      <div class="seg"><button data-kind="" class="${filters.kind === '' ? 'active' : ''}">全部</button>${KINDS.map(x => html`<button data-kind="${x}" class="${filters.kind === x ? 'active' : ''}">${KIND_LABELS[x]}</button>`)}</div>
      <select id="kStatus" aria-label="状态"><option value="">所有状态</option><option value="due" ${filters.status === 'due' ? 'selected' : ''}>到期</option><option value="learning" ${filters.status === 'learning' ? 'selected' : ''}>学习中</option><option value="new" ${filters.status === 'new' ? 'selected' : ''}>未排期</option><option value="known" ${filters.status === 'known' ? 'selected' : ''}>已掌握</option></select>
    </div>
    ${items.length ? html`<div class="card">${items.map(card)}</div>` : html`<div class="empty">${s.knowledge.length && (filters.q || filters.status) ? '没有匹配的条目。' : EMPTY_HINT[filters.kind]}</div>`}
    ${(filters.kind === '' || filters.kind === 'word') && lookups.length ? html`<section class="section"><div class="section-head"><h2>最近查过、还没加入生词本的词</h2><small class="muted">查过两次以上的词排在前面；加入后才会进入复习</small></div>
      <div class="card">${lookups.map(l => html`<div class="item"><div class="item-main"><div class="item-title">${l.term} ${l.count > 1 ? html`<span class="badge badge-warn">查过 ${l.count} 次</span>` : ''}</div><div class="item-meta">${l.meaning ? l.meaning + ' · ' : ''}<a href="#/read/${l.paperId}">${paperTitle(l.paperId)}</a> · ${fmtDate(l.at)}</div></div><div class="item-actions"><button class="btn btn-sm" data-add-lookup="${l.term}">${isSingleWordTerm(l.term) ? '加入生词本' : '存为表达'}</button></div></div>`)}</div></section>` : ''}
  </div>`);

  $('#kSearch').oninput = e => { filters.q = e.target.value; const pos = e.target.selectionStart; show(container); const i = $('#kSearch'); i.focus(); i.setSelectionRange(pos, pos); };
  $('#kStatus').onchange = e => { filters.status = e.target.value; show(container); };
  container.onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const again = () => show(container);
    if (b.dataset.kind !== undefined) { filters.kind = b.dataset.kind; again(); }
    if (b.dataset.add !== undefined) editKnowledgeModal(null, again, { kind: filters.kind || 'concept' });
    if (b.dataset.addLookup) {
      const l = lookups.find(x => x.term === b.dataset.addLookup);
      const ev = s.events.filter(x => x.action === 'translate' && x.quote && x.quote.trim().toLowerCase() === b.dataset.addLookup.toLowerCase()).pop();
      const r = addToVocab(s, { term: b.dataset.addLookup, meaning: l ? l.meaning : '', paperId: l ? l.paperId : null, sentence: ev && ev.anchor && ev.anchor.quote ? ev.anchor.quote : '', page: ev && ev.anchor ? ev.anchor.page : null, sourceEventId: ev ? ev.id : null });
      store.save(); toast(r.created ? `「${b.dataset.addLookup}」已加入生词本` : '已在生词本', { type: 'ok' }); again();
    }
    if (b.dataset.export !== undefined) download(knowledgeMarkdown(s), 'knowledge.md', 'text/markdown');
    if (b.dataset.explain) { const k = s.knowledge.find(x => x.id === b.dataset.explain); const ev = k && eventOf(k); if (k && ev) explanationModal(k, ev); }
    if (b.dataset.schedule) { const i = s.knowledge.findIndex(k => k.id === b.dataset.schedule); if (i > -1) { s.knowledge[i] = scheduleFirstReview(s.knowledge[i]); store.save(); again(); } }
    if (b.dataset.recall) { const i = s.knowledge.findIndex(k => k.id === b.dataset.recall); if (i > -1) { s.knowledge[i] = applyRecall(s.knowledge[i], b.dataset.ok === '1'); store.save(); again(); } }
    if (b.dataset.edit) editKnowledgeModal(b.dataset.edit, again);
    if (b.dataset.delete) { if (await confirmDialog({ title: '删除这条知识？', message: '删除后无法恢复。', confirmText: '删除', danger: true })) { s.knowledge = s.knowledge.filter(k => k.id !== b.dataset.delete); store.save(); again(); } }
  };
}

// Read the stored answer a concept came from, without leaving the page.
export function explanationModal(k, ev) {
  const s = store.state;
  const paper = s.papers.find(p => p.id === ev.paperId);
  const dlg = modal({ title: k.term, wide: true, body: html`
    <div class="small muted" style="margin-bottom:8px">${ACTION_NAMES[ev.action] || ev.action}${ev.model ? ' · ' + ev.model : ''} · ${fmtDate(ev.at)}${paper ? html` · <a href="#/read/${paper.id}" data-close-modal>${paper.title}</a>` : ''}${ev.anchor ? ' · ' + anchorLabel(ev.anchor) : ''}</div>
    ${ev.question ? html`<div class="k-q">${ev.question}</div>` : ''}
    ${ev.quote ? html`<div class="quote">${ev.quote.slice(0, 400)}</div>` : ''}
    <div class="md k-explain">${markdownLite(ev.response || '')}</div>
    <div class="modal-actions">${paper ? html`<a class="btn" href="#/read/${paper.id}" data-close-modal>回到论文</a>` : ''}<button class="btn btn-primary" data-cancel>关闭</button></div>` });
  dlg.querySelector('[data-cancel]').onclick = () => closeModal();
  $$('[data-close-modal]', dlg).forEach(a => a.addEventListener('click', () => closeModal()));
  renderMath(dlg); renderSvgFigures(dlg); renderDiagrams(dlg);
}

// Batch-create concepts from the glossary section of a whole-paper summary.
export function glossaryModal(ev, onDone) {
  const s = store.state;
  const entries = parseGlossary(ev.response);
  if (!entries.length) { toast('这条回答里没有找到术语表'); return; }
  const existing = t => findByTerm(s, t, ['concept']);
  const dlg = modal({ title: '导入术语表', wide: true, body: html`<form id="gForm">
    <p class="small muted">勾选要存为概念的术语，定义之后可以再改；已有同名概念的不会重复导入。每个概念都会记住它来自这条导读，可以随时「查看解释」。</p>
    <div class="g-list">${entries.map((g, i) => { const have = existing(g.term); return html`<label class="g-row ${have ? 'muted' : ''}"><input type="checkbox" name="g" value="${i}" ${have ? 'disabled' : 'checked'}><span><b>${g.term}</b>${have ? html` <span class="badge">已有</span>` : ''}<div class="small">${g.meaning}</div></span></label>`; })}</div>
    <label class="checkbox" style="margin-top:10px"><input type="checkbox" name="schedule"> 排入复习计划（1、3、7、14、30 天）</label>
    <div class="modal-actions"><button type="button" class="btn" data-cancel>取消</button><button class="btn btn-primary">导入所选</button></div></form>` });
  const form = $('#gForm', dlg);
  form.querySelector('[data-cancel]').onclick = () => closeModal();
  form.onsubmit = e => {
    e.preventDefault();
    const picked = $$('input[name=g]:checked', form).map(i => entries[Number(i.value)]);
    const schedule = form.elements.schedule.checked;
    let n = 0;
    for (const g of picked) {
      if (existing(g.term)) continue;
      let item = newKnowledge({ kind: 'concept', term: g.term, meaning: g.meaning, paperId: ev.paperId, sourceEventId: ev.id });
      if (schedule) item = scheduleFirstReview(item);
      s.knowledge.push(item); n++;
    }
    store.save(); closeModal();
    toast(n ? `已导入 ${n} 个概念` : '没有新的术语需要导入', { type: n ? 'ok' : undefined });
    if (onDone) onDone();
  };
}

export function editKnowledgeModal(id, onSaved, defaults = {}) {
  const s = store.state;
  const k = id ? s.knowledge.find(x => x.id === id) : null;
  if (id && !k) return;
  const v = f => (k ? k[f] : defaults[f]) || '';
  let kind = KINDS.includes(k ? k.kind : defaults.kind) ? (k ? k.kind : defaults.kind) : 'concept';
  const paperId = k ? k.paperId : defaults.paperId || s.current.paperId || (s.papers[0] && s.papers[0].id);
  const srcId = k ? k.sourceEventId : defaults.sourceEventId;
  const ev = srcId ? s.events.find(e => e.id === srcId) : null;
  const dlg = modal({ title: k ? '编辑条目' : '新建条目', body: html`<form id="kForm">
    <div class="field"><label>类型</label><div class="seg" id="kKind">${KINDS.map(x => html`<button type="button" data-kind="${x}" class="${x === kind ? 'active' : ''}">${KIND_LABELS[x]}</button>`)}</div></div>
    <div class="field"><label data-l="term"></label><input name="term" required value="${v('term')}"></div>
    <div class="field" data-f="phonetic"><label>音标（可选）</label><input name="phonetic" value="${v('phonetic')}"></div>
    <div class="field"><label data-l="meaning"></label><textarea name="meaning">${v('meaning')}</textarea></div>
    <div class="field"><label data-l="note"></label><textarea name="note" style="min-height:56px">${v('note')}</textarea></div>
    <div class="field"><label data-l="example"></label><textarea name="example" style="min-height:56px">${v('example')}</textarea></div>
    ${ev ? html`<p class="hint" style="margin:-4px 0 12px">关联了一条${ACTION_NAMES[ev.action] || ''}回答（${fmtDate(ev.at)}），保存后可以在条目上「查看解释」。</p>` : ''}
    ${!k ? html`<div class="field"><label>所属论文</label><select name="paperId">${s.papers.map(p => html`<option value="${p.id}" ${p.id === paperId ? 'selected' : ''}>${p.title}</option>`)}</select></div>` : ''}
    <label class="checkbox"><input type="checkbox" name="schedule" ${k ? (k.status === 'learning' ? 'checked' : '') : (defaults.schedule === false ? '' : 'checked')}> 排入复习计划（1、3、7、14、30 天后各复习一次）</label>
    <div class="modal-actions"><button type="button" class="btn" data-cancel>取消</button><button class="btn btn-primary">保存</button></div></form>` });
  const form = $('#kForm', dlg);
  const applyKind = () => {
    $$('#kKind button', form).forEach(b => b.classList.toggle('active', b.dataset.kind === kind));
    const L = FIELD_LABELS[kind];
    for (const f of ['term', 'meaning', 'note', 'example']) form.querySelector(`[data-l="${f}"]`).textContent = L[f];
    form.querySelector('[data-f="phonetic"]').hidden = kind !== 'word';
  };
  $$('#kKind button', form).forEach(b => b.onclick = () => { kind = b.dataset.kind; applyKind(); });
  applyKind();
  form.querySelector('[data-cancel]').onclick = () => closeModal();
  form.onsubmit = e => {
    e.preventDefault();
    const f = form.elements;
    const patch = { kind, term: f.term.value.trim(), meaning: f.meaning.value.trim(), note: f.note.value.trim(), example: f.example.value.trim(), phonetic: kind === 'word' ? f.phonetic.value.trim() : (k ? k.phonetic : '') };
    if (!patch.term) return;
    if (k) {
      Object.assign(k, patch);
      if (f.schedule.checked && k.status === 'new') Object.assign(k, scheduleFirstReview(k));
    } else {
      let item = newKnowledge({ paperId: f.paperId.value, sourceEventId: defaults.sourceEventId || null, sourceQuote: defaults.sourceQuote || '', contexts: defaults.contexts || [], ...patch });
      if (f.schedule.checked) item = scheduleFirstReview(item);
      s.knowledge.push(item);
    }
    const r = store.save();
    closeModal();
    if (r.ok) toast(k ? '已保存' : `已存为${KIND_LABELS[kind]}`, { type: 'ok' });
    if (onSaved) onSaved();
  };
  form.elements.term.focus();
}
