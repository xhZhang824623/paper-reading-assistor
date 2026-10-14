// Assistant panel: discussion thread, notes and knowledge for the current paper.
import { store } from '../state/store.js';
import { newEvent, ACTION_NAMES, FEEDBACK } from '../state/schema.js';
import { KINDS, KIND_LABELS, STATUS_LABELS, extractDefinition, parseGlossary, conceptTerm, findByTerm, isSingleWordTerm } from '../domain/knowledge.js';
import { addToVocab } from '../domain/vocab.js';
import { aiReady, streamAnswer } from '../ai/adapter.js';
import { userPrompt, translatorPrompt, imagePrompt, PAGE_IMAGES_NOTE, isShortPhrase } from '../ai/prompts.js';
import { dbPutThumb, dbGetThumb } from '../state/db.js';
import { demoAnswer } from '../data/demo-paper.js';
import { $, $$, html, render, markdownLite, fmtTime, toast, confirmDialog, relTime } from './dom.js';
import { diagramMarkup, initDiagram } from './diagram.js';
import { renderDiagrams } from './mermaid.js';
import { renderSvgFigures } from './figures.js';
import { renderMath } from './math.js';
import { anchorLabel, dehyphenate } from '../domain/anchors.js';
import { editKnowledgeModal, explanationModal, glossaryModal, kindBadge } from './knowledge.js';
import { touchSession, activeSession } from '../domain/session.js';

const AI_ACTIONS = ['translate', 'explain', 'summarize', 'ask'];

export function mountAssistant(root, ctx) {
  const state = { tab: 'thread', askContext: null, parent: null, image: null, controllers: new Map(), destroyed: false };
  const paper = () => ctx.paper;

  function shell() {
    render(root, html`
      <div class="assistant-tabs">
        <button data-tab="thread" class="active">讨论 <em id="cntThread"></em></button>
        <button data-tab="notes">笔记 <em id="cntNotes"></em></button>
        <button data-tab="knowledge">知识 <em id="cntK"></em></button>
        <button class="icon-btn" data-close title="收起助手" aria-label="收起助手">×</button>
      </div>
      <div class="assistant-body" id="assistantBody"></div>
      <div class="assistant-foot">
        <div class="ask-attach" id="askAttach" hidden></div>
        <textarea id="askBox" placeholder="提问，或针对上一条回答追问…（Enter 发送，Shift+Enter 换行）" rows="2"></textarea>
        <div class="row"><span class="ctx" id="askCtx"></span><button class="btn btn-sm btn-ghost" id="askClear" hidden>清除</button><button class="btn btn-sm" id="askSummary" title="把整篇论文发给模型，生成全文概要">总结全文</button><button class="btn btn-sm btn-primary" id="askSend">发送</button></div>
      </div>`);
    $$('[data-tab]', root).forEach(b => b.onclick = () => setTab(b.dataset.tab));
    $('[data-close]', root).onclick = () => ctx.onToggle && ctx.onToggle(false);
    const box = $('#askBox', root);
    box.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };
    $('#askSend', root).onclick = send;
    $('#askClear', root).onclick = () => { state.askContext = null; state.parent = null; updateAskCtx(); };
    $('#askAttach', root).addEventListener('click', e => {
      const b = e.target.closest('[data-img]');
      if (!b) return;
      if (b.dataset.img === 'clear') { state.image = null; updateAskCtx(); return; }
      sendImage(b.dataset.img, '');
    });
    $('#askSummary', root).onclick = () => runAction('summarize', null);
    $('#assistantBody', root).addEventListener('click', onBodyClick);
    $('#assistantBody', root).addEventListener('change', e => { const cb = e.target.closest('[data-show-hl]'); if (cb) { state.showHighlights = cb.checked; refresh(); } });
  }

  function setTab(tab) {
    state.tab = tab;
    $$('[data-tab]', root).forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    refresh();
  }

  function counts() {
    const id = paper().id;
    $('#cntThread', root).textContent = store.state.events.filter(e => e.paperId === id && AI_ACTIONS.includes(e.action)).length || '';
    $('#cntNotes', root).textContent = store.state.notes.filter(n => n.paperId === id && !(n.type === 'highlight' && !n.text)).length || '';
    $('#cntK', root).textContent = store.state.knowledge.filter(k => k.paperId === id).length || '';
  }

  function refresh() {
    if (state.destroyed) return;
    counts();
    const body = $('#assistantBody', root);
    if (state.tab === 'thread') renderThread(body);
    else if (state.tab === 'notes') renderNotes(body);
    else renderKnowledge(body);
    if (ctx.onRefresh) { try { ctx.onRefresh(); } catch (err) { console.warn(err); } }
  }

  // Bring a thread card or note card into view and flash it (used by the markers on the PDF).
  function reveal(tab, selector) {
    if (ctx.onToggle) ctx.onToggle(true);
    setTab(tab);
    const el = root.querySelector(selector);
    if (!el) return false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
    return true;
  }

  function renderThread(body) {
    const id = paper().id;
    const events = store.state.events.filter(e => e.paperId === id && AI_ACTIONS.includes(e.action));
    if (!events.length) {
      const p = paper();
      render(body, html`<div class="empty" style="margin-top:8px">${p.demo ? '选中一段原文，试试「解释」。示例论文使用预置回答。' : p.noAI ? '这篇论文已设为不发送给 AI。可以高亮和记笔记。' : aiReady(store.state.settings) ? '选中原文后点翻译、解释，或在下面提问。' : html`AI 还没配置。<a href="#/settings">去设置</a>填入 API Key 后，这里会显示真实回答。现在仍可高亮和记笔记。`}</div>`);
      return;
    }
    render(body, events.slice(-40).map(card));
    $$('[data-shift-diagram]', body).forEach(initDiagram);
    loadThumbs(body);
    body.scrollTop = body.scrollHeight;
    renderMath(body);
    renderSvgFigures(body);
    renderDiagrams(body).then(() => { body.scrollTop = body.scrollHeight; });
  }

  const thumbUrls = new Map();
  async function loadThumbs(body) {
    for (const img of $$('img[data-thumb]', body)) {
      const id = img.dataset.thumb;
      if (thumbUrls.has(id)) { img.src = thumbUrls.get(id); continue; }
      try { const blob = await dbGetThumb(id); if (blob) { const url = URL.createObjectURL(blob); thumbUrls.set(id, url); img.src = url; } else img.closest('.answer-thumb-wrap').querySelector('img').remove(); } catch { /* no thumbnail */ }
    }
  }

  function card(e) {
    const statusBadge = e.status === 'demo' ? html`<span class="badge">示例回答</span>` : e.status === 'unavailable' ? html`<span class="badge badge-warn">未调用 AI</span>` : e.status === 'error' ? html`<span class="badge badge-danger">失败</span>` : e.status === 'streaming' ? html`<span class="badge badge-accent">生成中</span>` : e.model ? html`<span class="badge">${e.model.replace('claude-', '')}</span>` : '';
    const answered = ['done', 'demo'].includes(e.status);
    return html`<article class="answer ${e.status}" data-event="${e.id}">
      <div class="answer-head"><span class="badge badge-accent">${ACTION_NAMES[e.action]}</span>${statusBadge}<span>${fmtTime(e.at)}${e.latencyMs ? ' · ' + (e.latencyMs / 1000).toFixed(1) + 's' : ''}</span><span class="spacer"></span><button class="icon-btn" data-del="${e.id}" title="删除这条记录" aria-label="删除">×</button></div>
      ${answered ? html`<div class="feedback">${['unclear', 'understood', 'review'].map(f => html`<button data-fb="${f}" data-event="${e.id}" class="${e.feedback === f ? 'active ' + f : ''}">${FEEDBACK[f]}</button>`)}</div>` : ''}
      ${e.hasImage && e.scope === 'image' ? html`<div class="answer-thumb-wrap"><img class="answer-thumb" data-thumb="${e.id}" alt="框选区域" title="点击回到原文位置" data-jump="${e.id}"><div class="small muted">第 ${e.anchor ? e.anchor.page : '?'} 页的框选区域截图已发送</div></div>` : ''}
      ${e.quote ? html`<div class="answer-quote collapsed" title="点击展开">${e.quote}</div>` : e.docChars ? html`<div class="answer-quote">整篇论文 · ${e.docSource || '全文'} · 约 ${Math.round(e.docChars / 1000)} 千字符${e.imagePages ? ' + ' + e.imagePages + ' 页截图' : ''}已发送</div>` : ''}
      ${e.action === 'ask' && e.question ? html`<div class="answer-q">${e.question}</div>` : ''}
      <div class="answer-body md ${e.status === 'unavailable' ? 'unavailable' : ''} ${e.status === 'streaming' ? 'streaming-dot' : ''}">${e.status === 'unavailable' ? e.error : e.status === 'error' ? html`<span class="muted">${e.error || '请求失败'}</span>${e.response ? markdownLite(e.response) : ''}` : markdownLite(e.response)}</div>
      ${e.status === 'demo' && ['explain', 'ask'].includes(e.action) ? html`<details class="block" style="margin-top:8px"><summary>互动图解 · Domain shift</summary>${diagramMarkup()}</details>` : ''}
      <div class="answer-tools">
        ${e.status === 'streaming' ? html`<button class="btn btn-sm" data-stop="${e.id}">停止</button>` : ''}
        ${e.status === 'error' ? html`<button class="btn btn-sm" data-retry="${e.id}">重试</button>` : ''}
        ${answered && e.truncated ? html`<button class="btn btn-sm btn-primary" data-continue="${e.id}">继续生成</button>` : ''}
        ${answered ? html`${saveButton(e)}<button class="btn btn-sm" data-follow="${e.id}">追问</button>` : ''}
        ${e.anchor ? html`<button class="btn btn-sm btn-ghost" data-jump="${e.id}">回到原文 · ${anchorLabel(e.anchor)}</button>` : ''}
      </div>
    </article>`;
  }

  // What an answer can be saved as: a concept (explain/ask), a word or phrase (short translation),
  // or a batch of concepts from the glossary of a whole-paper summary.
  function saveButton(e) {
    if (e.action === 'translate') {
      const t = (e.quote || '').replace(/\s+/g, ' ').trim();
      if (!t || !isShortPhrase(t)) return '';
      if (findByTerm(store.state, t, ['word', 'phrase'])) return html`<button class="btn btn-sm" disabled>已在生词本</button>`;
      return html`<button class="btn btn-sm" data-vocab="${e.id}">${isSingleWordTerm(t) ? '加入生词本' : '存为表达'}</button>`;
    }
    if (e.action === 'summarize' && !e.quote) {
      const n = parseGlossary(e.response).length;
      return n ? html`<button class="btn btn-sm" data-glossary="${e.id}">导入术语表 · ${n}</button>` : '';
    }
    return html`<button class="btn btn-sm" data-concept="${e.id}">存为概念</button>`;
  }

  function renderNotes(body) {
    const all = store.state.notes.filter(n => n.paperId === paper().id).slice().reverse();
    const highlights = all.filter(n => n.type === 'highlight' && !n.text);
    const notes = state.showHighlights ? all : all.filter(n => !(n.type === 'highlight' && !n.text));
    const label = { highlight: '高亮', comment: '笔记', question: '疑问' };
    const header = html`<div class="row-between" style="margin-bottom:8px"><span class="small muted">${notes.length} 条笔记与疑问</span><label class="checkbox small"><input type="checkbox" data-show-hl ${state.showHighlights ? 'checked' : ''}> 显示高亮（${highlights.length}）</label></div>`;
    if (!notes.length) { render(body, html`${header}<div class="empty" style="margin-top:8px">${all.length ? '只有高亮，还没有写过笔记。选中原文按 B 记笔记。' : '还没有笔记。选中原文后按 B 记笔记，H 高亮。'}</div>`); return; }
    render(body, html`${header}${notes.map(n => html`<div class="note-card" data-note="${n.id}">
      <div class="row-between"><span><span class="badge ${n.type === 'question' ? 'badge-warn' : n.type === 'comment' ? 'badge-accent' : ''}">${label[n.type]}${n.type === 'question' && n.resolved ? ' · 已解决' : ''}</span> <span class="small muted">${anchorLabel(n.anchor)} · ${relTime(n.at)}</span></span><span class="row"><button class="icon-btn" data-edit-note="${n.id}" title="编辑" aria-label="编辑">✎</button><button class="icon-btn" data-del-note="${n.id}" title="删除" aria-label="删除">×</button></span></div>
      ${n.quote ? html`<div class="quote">${dehyphenate(n.quote).slice(0, 300)}</div>` : ''}
      ${n.text ? html`<div>${n.text}</div>` : ''}
      <div class="row"><button class="btn btn-sm btn-ghost" data-jump-note="${n.id}">回到原文</button>${n.type === 'question' && !n.resolved ? html`<button class="btn btn-sm btn-ghost" data-resolve="${n.id}">标为已解决</button>` : ''}</div>
    </div>`)}`);
  }

  function renderKnowledge(body) {
    const s = store.state;
    const items = s.knowledge.filter(k => k.paperId === paper().id);
    const groups = KINDS.map(kind => ({ kind, items: items.filter(k => k.kind === kind).slice().reverse() })).filter(g => g.items.length);
    const glossaryEv = s.events.filter(e => e.paperId === paper().id && e.action === 'summarize' && !e.quote && ['done', 'demo'].includes(e.status) && parseGlossary(e.response).length).pop();
    const row = k => {
      const ev = k.sourceEventId ? s.events.find(e => e.id === k.sourceEventId) : null;
      const page = (k.contexts && k.contexts[0] && k.contexts[0].page) || (ev && ev.anchor && ev.anchor.page) || null;
      return html`<div class="k-row" data-k="${k.id}">
        <div class="k-row-main">
          <div class="k-row-title"><b>${k.term}</b>${k.kind === 'word' && k.phonetic ? html`<span class="muted small">/${k.phonetic}/</span>` : ''}<span class="k-dot ${k.status}" title="${STATUS_LABELS[k.status]}"></span></div>
          ${k.meaning ? html`<div class="k-row-def clamp-2">${k.meaning}</div>` : html`<div class="k-row-def muted">还没写${k.kind === 'concept' ? '定义' : '释义'}</div>`}
          ${k.note ? html`<div class="k-row-note clamp-2">${k.note}</div>` : ''}
          ${k.kind === 'phrase' && k.example ? html`<div class="k-row-note clamp-2">例：${k.example}</div>` : ''}
        </div>
        <div class="k-row-actions">
          ${ev && ev.response ? html`<button class="k-link" data-show-k="${k.id}" title="查看它来自哪条回答">解释</button>` : ''}
          ${(ev && ev.anchor) || page ? html`<button class="k-link" data-jump-k="${k.id}" title="回到原文位置">原文${page ? ' · ' + page : ''}</button>` : ''}
          <button class="icon-btn" data-edit-k="${k.id}" title="编辑" aria-label="编辑">✎</button>
        </div></div>`;
    };
    render(body, html`<div class="row-between" style="margin-bottom:8px"><span class="small muted">${items.length ? KINDS.filter(x => items.some(k => k.kind === x)).map(x => `${KIND_LABELS[x]} ${items.filter(k => k.kind === x).length}`).join(' · ') : '本篇还没有条目'}</span><span class="row" style="gap:4px">${glossaryEv ? html`<button class="btn btn-sm btn-ghost" data-glossary="${glossaryEv.id}" title="把导读回答里的术语表批量存为概念">导入术语表</button>` : ''}<button class="btn btn-sm" data-add-k>＋ 添加</button></span></div>
      ${groups.length ? groups.map(g => html`<section class="k-group"><h4 class="k-group-head">${kindBadge(g.kind)}<span class="muted small">${g.items.length}</span></h4>${g.items.map(row)}</section>`) : html`<div class="empty">还没有条目。<br><span class="small">解释后点「存为概念」；查词后点「加入生词本」；选中好句子点「存表达」。</span></div>`}`);
  }

  async function onBodyClick(e) {
    const thumbImg = e.target.closest('img[data-jump]');
    if (thumbImg) { const ev = store.state.events.find(x => x.id === thumbImg.dataset.jump); if (ev && ctx.onJump) ctx.onJump(ev.anchor, ev.quote); return; }
    const q = e.target.closest('.answer-quote');
    if (q) { q.classList.toggle('collapsed'); return; }
    const b = e.target.closest('button');
    if (!b) return;
    const s = store.state;
    if (b.dataset.fb) {
      const ev = s.events.find(x => x.id === b.dataset.event);
      if (!ev) return;
      ev.feedback = ev.feedback === b.dataset.fb ? 'none' : b.dataset.fb;
      ev.feedbackAt = new Date().toISOString();
      store.save();
      refresh();
      if (ev.feedback === 'review' && !s.knowledge.some(k => k.sourceEventId === ev.id)) saveConcept(ev);
    }
    if (b.dataset.concept) { const ev = s.events.find(x => x.id === b.dataset.concept); if (ev) saveConcept(ev); }
    if (b.dataset.vocab) {
      const ev = s.events.find(x => x.id === b.dataset.vocab);
      if (!ev) return;
      const term = ev.quote.replace(/\s+/g, ' ').trim();
      const meaning = (ev.response || '').replace(/\*\*/g, '').split('\n')[0].replace(/^本句中的意思[：:]\s*/, '').slice(0, 200);
      if (isSingleWordTerm(term)) {
        const r = addToVocab(s, { term, meaning, paperId: ev.paperId, sentence: '', page: ev.anchor && ev.anchor.page, sourceEventId: ev.id });
        store.save(); refresh(); toast(r.created ? `「${term}」已加入生词本` : '已在生词本', { type: 'ok' });
      } else editKnowledgeModal(null, refresh, { kind: 'phrase', paperId: ev.paperId, term, meaning, sourceQuote: ev.quote, sourceEventId: ev.id });
    }
    if (b.dataset.glossary) { const ev = s.events.find(x => x.id === b.dataset.glossary); if (ev) glossaryModal(ev, refresh); }
    if (b.dataset.showK) {
      const k = s.knowledge.find(x => x.id === b.dataset.showK);
      const ev = k && s.events.find(x => x.id === k.sourceEventId);
      if (!k || !ev) return;
      const shown = s.events.filter(x => x.paperId === paper().id && AI_ACTIONS.includes(x.action)).slice(-40).some(x => x.id === ev.id);
      if (!shown || !reveal('thread', `[data-event="${ev.id}"]`)) explanationModal(k, ev);
    }
    if (b.dataset.jumpK) {
      const k = s.knowledge.find(x => x.id === b.dataset.jumpK);
      const ev = k && s.events.find(x => x.id === k.sourceEventId);
      const page = k && k.contexts && k.contexts[0] && k.contexts[0].page;
      if (ev && ev.anchor && ctx.onJump) ctx.onJump(ev.anchor, ev.quote);
      else if (page && ctx.onJump) ctx.onJump({ kind: 'pdf', page, rects: [] }, k.term);
    }
    if (b.dataset.continue) {
      const ev = s.events.find(x => x.id === b.dataset.continue);
      if (ev) runAction('ask', null, { question: '继续', parentId: ev.id, continuation: true });
    }
    if (b.dataset.follow) {
      const ev = s.events.find(x => x.id === b.dataset.follow);
      if (ev) { state.parent = ev; state.askContext = ev.quote ? { quote: ev.quote, anchor: ev.anchor, context: '' } : null; updateAskCtx(); $('#askBox', root).focus(); }
    }
    if (b.dataset.jump) { const ev = s.events.find(x => x.id === b.dataset.jump); if (ev && ctx.onJump) ctx.onJump(ev.anchor, ev.quote); }
    if (b.dataset.stop) { const c = state.controllers.get(b.dataset.stop); if (c) c.abort(); }
    if (b.dataset.retry) {
      const ev = s.events.find(x => x.id === b.dataset.retry);
      if (ev) { s.events = s.events.filter(x => x.id !== ev.id); store.save(); runAction(ev.action, ev.anchor || ev.quote ? { quote: ev.quote, anchor: ev.anchor, context: '' } : null, { question: ev.question, parentId: ev.parentId }); }
    }
    if (b.dataset.del) {
      if (await confirmDialog({ title: '删除这条记录？', message: '回答和你的反馈都会删除。', confirmText: '删除', danger: true })) { s.events = s.events.filter(x => x.id !== b.dataset.del); store.save(); refresh(); }
    }
    if (b.dataset.jumpNote) { const n = s.notes.find(x => x.id === b.dataset.jumpNote); if (n && ctx.onJump) ctx.onJump(n.anchor, n.quote); }
    if (b.dataset.editNote) { const n = s.notes.find(x => x.id === b.dataset.editNote); if (n && ctx.onEditNote) ctx.onEditNote(n); }
    if (b.dataset.delNote) {
      if (await confirmDialog({ title: '删除这条笔记？', message: '高亮和文字都会删除。', confirmText: '删除', danger: true })) { s.notes = s.notes.filter(x => x.id !== b.dataset.delNote); store.save(); refresh(); if (ctx.onNotesChanged) ctx.onNotesChanged(); }
    }
    if (b.dataset.resolve) { const n = s.notes.find(x => x.id === b.dataset.resolve); if (n) { n.resolved = true; store.save(); refresh(); } }
    if (b.dataset.addK !== undefined) editKnowledgeModal(null, refresh, { paperId: paper().id });
    if (b.dataset.editK) editKnowledgeModal(b.dataset.editK, refresh);
  }

  function saveConcept(ev) {
    editKnowledgeModal(null, refresh, { kind: 'concept', paperId: ev.paperId, term: conceptTerm(ev), meaning: extractDefinition(ev.response), sourceEventId: ev.id, sourceQuote: ev.quote || '' });
  }

  function updateAskCtx() {
    const el = $('#askCtx', root);
    const clear = $('#askClear', root);
    const att = $('#askAttach', root);
    const box = $('#askBox', root);
    if (state.image) {
      att.hidden = false;
      render(att, html`<img src="${state.image.thumb || state.image.dataUrl}" alt="截图"><div class="ask-attach-main"><div class="small"><b>第 ${state.image.page} 页的截图</b> · 会和本页文字一起发给模型</div><div class="row" style="margin-top:4px"><button class="btn btn-sm btn-primary" data-img="explain">解释这张图</button><button class="btn btn-sm" data-img="translate">翻译图中文字</button><span class="small muted">或在下面输入问题</span></div></div><button class="icon-btn" data-img="clear" title="移除截图" aria-label="移除截图">×</button>`);
      box.placeholder = '针对这块截图提问…（Enter 发送）';
      el.textContent = '截图提问：问题会针对上面的截图'; clear.hidden = true;
      return;
    }
    att.hidden = true; att.innerHTML = '';
    box.placeholder = '提问，或针对上一条回答追问…（Enter 发送，Shift+Enter 换行）';
    if (state.parent) { el.textContent = '追问：' + (state.parent.question || state.parent.quote || ACTION_NAMES[state.parent.action]).slice(0, 60); clear.hidden = false; }
    else if (state.askContext && state.askContext.quote) { el.textContent = '选区：' + state.askContext.quote.slice(0, 60); clear.hidden = false; }
    else { el.textContent = '没有选区：会把整篇论文发给模型，按全文提问'; clear.hidden = true; }
  }

  function sendImage(mode, question) {
    const im = state.image;
    if (!im) return;
    state.image = null; state.parent = null; updateAskCtx();
    runAction(mode === 'translate' ? 'translate' : mode === 'ask' ? 'ask' : 'explain', null, { images: [im.dataUrl], imageAnchor: im.anchor, imageMode: mode, question, pageText: im.pageText, thumb: im.thumb });
  }

  function attachImage(im) {
    state.image = im; state.parent = null;
    if (ctx.onToggle) ctx.onToggle(true);
    updateAskCtx();
    $('#askBox', root).focus();
  }

  function send() {
    const box = $('#askBox', root);
    const question = box.value.trim();
    if (!question) return;
    if (state.image) { box.value = ''; sendImage('ask', question); return; }
    const sel = state.askContext || (ctx.getSelection ? ctx.getSelection() : null);
    runAction('ask', sel, { question, parentId: state.parent ? state.parent.id : null });
    box.value = '';
    state.parent = null; state.askContext = null;
    updateAskCtx();
  }

  // Runs translate / explain / summarize / ask. sel = {quote, anchor, context} or null.
  async function runAction(action, sel, { question = '', parentId = null, onUpdate = null, continuation = false, images = [], imageAnchor = null, imageMode = null, pageText = '', thumb = null } = {}) {
    const p = paper();
    const s = store.state;
    const session = activeSession(s, p.id);
    const ev = newEvent({ paperId: p.id, sessionId: session ? session.id : null, action, scope: images.length && imageAnchor ? 'image' : sel && sel.quote ? 'selection' : 'paper', quote: sel ? sel.quoteClean || sel.quote || '' : '', anchor: imageAnchor || (sel ? sel.anchor || null : null), question, parentId, status: 'streaming', hasImage: images.length > 0 });
    if (thumb) { try { const blob = await (await fetch(thumb)).blob(); await dbPutThumb(ev.id, blob); } catch (err) { console.warn('缩略图保存失败', err); } }
    if (p.demo) { ev.response = demoAnswer(action, ev.quote, question); ev.status = 'demo'; ev.provider = 'demo'; ev.model = 'demo'; }
    else if (p.noAI) { ev.status = 'unavailable'; ev.error = '这篇论文已设置为不发送给 AI。可以在论文信息里修改。'; }
    else if (!aiReady(s.settings)) { ev.status = 'unavailable'; ev.error = 'AI 未配置。到设置页填入 API Key 后，这里会调用模型。'; }
    s.events.push(ev);
    touchSession(s, p.id);
    store.save();
    setTab('thread');
    if (onUpdate) onUpdate(ev);
    if (ev.status !== 'streaming') return ev;

    const controller = new AbortController();
    state.controllers.set(ev.id, controller);
    const parent = parentId ? s.events.find(x => x.id === parentId) : null;
    // No selection: send the whole document so "整篇论文" questions and summaries have something to read.
    let document = '';
    let pageImages = [];
    if (continuation) {
      const parentEv = s.events.find(x => x.id === parentId);
      if (parentEv && parentEv.docChars && ctx.getDocumentText) { try { document = (await ctx.getDocumentText()).text || ''; } catch {} }
      ev.question = '继续上一条被截断的回答';
    } else if (!images.length && !ev.quote && ['ask', 'summarize'].includes(action) && ctx.getDocumentText) {
      try { const d = await ctx.getDocumentText(); document = d.text || ''; ev.docSource = d.source || ''; ev.docChars = document.length; } catch (err) { console.warn('全文提取失败', err); }
      if (!document) { ev.status = 'unavailable'; ev.error = '没有可发送的论文内容：PDF 还没加载完成，或者这篇论文没有文字层（扫描件）。可以先切到文本视图粘贴原文。'; store.save(); refresh(); return ev; }
      store.save(); refresh();
      if (s.settings.attachPageImages && ctx.getPageImages) {
        const bodyEl = () => root.querySelector(`[data-event="${ev.id}"] .answer-body`);
        try {
          pageImages = await ctx.getPageImages((k, n) => { const b = bodyEl(); if (b) b.innerHTML = '<span class="muted">正在生成页面截图 ' + k + ' / ' + n + '…</span>'; });
          ev.imagePages = pageImages.length;
        } catch (err) { console.warn('页面截图失败', err); }
      }
    }
    const user = images.length && imageMode
      ? imagePrompt({ mode: imageMode, title: p.title, page: imageAnchor ? imageAnchor.page : '', pageText, question })
      : userPrompt({ action, quote: ev.quote, context: sel ? sel.context || '' : '', title: p.title, question, parent, document, continuation }) + (pageImages.length ? PAGE_IMAGES_NOTE : '');
    const allImages = images.length ? images : pageImages;
    const effort = action === 'translate' ? 'low' : (images.length && s.settings.ai.effort !== 'high') ? 'low' : s.settings.ai.effort;
    let buffer = '';
    const result = await streamAnswer({
      settings: s.settings, user, effort, signal: controller.signal, fast: action === 'translate' && !allImages.length, images: allImages,
      system: action === 'translate' && !allImages.length ? translatorPrompt(s.settings) : null,
      onStatus: st => {
        const bodyEl = root.querySelector(`[data-event="${ev.id}"] .answer-body`);
        if (bodyEl && st === 'thinking' && !ev.response) bodyEl.innerHTML = '<span class="muted">模型思考中…</span>';
        ev.thinking = st === 'thinking';
        if (onUpdate) onUpdate(ev);
      },
      onDelta: t => {
        buffer += t; ev.response = buffer;
        const bodyEl = root.querySelector(`[data-event="${ev.id}"] .answer-body`);
        if (bodyEl) { render(bodyEl, markdownLite(buffer)); renderMath(bodyEl); bodyEl.parentElement.parentElement.scrollTop = bodyEl.parentElement.parentElement.scrollHeight; }
        if (onUpdate) onUpdate(ev);
      },
    });
    state.controllers.delete(ev.id);
    ev.response = result.text || buffer;
    ev.model = result.model || ''; ev.provider = result.provider || s.settings.ai.provider; ev.latencyMs = result.latencyMs;
    if (result.ok) { ev.status = 'done'; if (result.truncated) { ev.truncated = true; ev.response += '\n\n（输出达到长度上限，已截断，可点「继续生成」）'; } }
    else if (result.aborted) { ev.status = 'done'; ev.response += '\n\n（已停止）'; }
    else { ev.status = 'error'; ev.error = result.error || '请求失败'; }
    store.save();
    refresh();
    if (onUpdate) onUpdate(ev);
    return ev;
  }

  function focusAsk(sel) {
    state.askContext = sel; state.parent = null; updateAskCtx();
    $('#askBox', root).focus();
  }

  shell();
  updateAskCtx();
  refresh();

  return {
    runAction, refresh, setTab, focusAsk, attachImage,
    showEvent: id => reveal('thread', `[data-event="${id}"]`),
    showNote: id => reveal('notes', `[data-note="${id}"]`),
    destroy() { state.destroyed = true; for (const c of state.controllers.values()) c.abort(); },
  };
}
