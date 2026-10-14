// Per-paper review: evidence on the left, structured write-up on the right. Drafts autosave.
import { store, reviewFor } from '../state/store.js';
import { KINDS, KIND_LABELS, STATUS_LABELS } from '../domain/knowledge.js';
import { PAPER_STATUS, ACTION_NAMES, FEEDBACK, newEvent } from '../state/schema.js';
import { $, $$, html, render, toast, download, debounce, fmtDateTime, markdownLite, relTime } from './dom.js';
import { paperEvidence, formatDuration, sessionDurationMs } from '../domain/review.js';
import { reviewMarkdown, fileSafe } from '../domain/export.js';
import { anchorLabel } from '../domain/anchors.js';
import { editKnowledgeModal } from './knowledge.js';
import { aiReady, streamAnswer } from '../ai/adapter.js';
import { reviewDraftPrompt } from '../ai/prompts.js';
import { renderDiagrams } from './mermaid.js';
import { renderMath } from './math.js';
import { renderSvgFigures } from './figures.js';

const NOTION_URL = 'https://app.notion.com/p/3f709d6e364e812a9181c4dcd9fb4da0';
let autosave = null;

export function destroy() { if (autosave) autosave.flush(); }

export function show(container, { id }) {
  const s = store.state;
  const p = s.papers.find(x => x.id === id);
  if (!p) { render(container, html`<div class="page"><div class="empty">找不到这篇论文。<a href="#/library">回到论文库</a></div></div>`); return; }
  const r = reviewFor(id);
  const ev = paperEvidence(s, id);
  const byKind = kind => ev.knowledge.filter(k => k.kind === kind);
  const outcomeLabel = { finished: '读完', partial: '读了一部分', parked: '先放着' };
  const KIND_HINT = { concept: '读的时候在回答下方点「存为概念」，或从导读的术语表批量导入。', word: '划词翻译后点「加入生词本」。', phrase: '选中写作时能借用的句式，点「存表达」。' };
  const kItem = k => html`<div class="item"><div class="item-main"><div class="k-term">${k.term}${k.kind === 'word' && k.phonetic ? html` <span class="muted small" style="font-weight:400">/${k.phonetic}/</span>` : ''} <span class="badge ${k.status === 'known' ? 'badge-ok' : k.status === 'learning' ? 'badge-accent' : ''}">${STATUS_LABELS[k.status]}</span></div><div class="small">${k.meaning || html`<span class="muted">${k.kind === 'concept' ? '还没写定义' : '还没写释义'}</span>`}</div>${k.note ? html`<div class="small muted">我的理解：${k.note}</div>` : ''}${k.example ? html`<div class="small muted">例：${k.example}</div>` : ''}</div><div class="item-actions"><button class="icon-btn" data-edit-k="${k.id}" aria-label="编辑">✎</button></div></div>`;

  render(container, html`<div class="page">
    <div class="page-head"><div><div class="row"><a href="#/library" class="small">论文库</a><span class="muted small">/</span><span class="small muted">复盘</span></div><h1 style="font-family:var(--font-article)">${p.title}</h1><p>${PAPER_STATUS[p.status]}${r.savedAt ? ` · 上次标记复盘 ${fmtDateTime(r.savedAt)}` : ''}${p.demo ? ' · 教学示例' : ''}</p></div>
      <div class="page-actions"><a class="btn" href="#/read/${p.id}">回到阅读</a><button class="btn" id="exportMd">导出 Markdown</button><button class="btn" id="copyNotion">复制并打开 Notion</button><button class="btn btn-primary" id="markReviewed">${p.status === 'reviewed' ? '已复盘 ✓' : '标记为已复盘'}</button></div></div>
    <div class="review-layout">
      <aside class="evidence">
        <div class="card">
          <h2>阅读证据</h2>
          <p class="small muted">写复盘时对照自己真实做过的事，而不是凭印象。</p>
          <h3>会话 · ${ev.sessions.length}</h3>
          ${ev.sessions.length ? ev.sessions.slice().reverse().slice(0, 6).map(x => html`<div class="small">${fmtDateTime(x.startedAt)} · ${formatDuration(sessionDurationMs(x))} · ${x.endedAt ? outcomeLabel[x.outcome] || '结束' : '进行中'}</div>`) : html`<div class="small muted">还没有阅读会话</div>`}
          <h3>仍不理解 · ${ev.unclear.length}</h3>
          ${ev.unclear.length ? ev.unclear.map(e => html`<div class="item"><div class="item-main"><div class="clamp-3">${e.question || e.quote}</div><div class="item-meta">${ACTION_NAMES[e.action]} · ${anchorLabel(e.anchor)}</div></div></div>`) : html`<div class="small muted">没有标记。没有标记不等于都懂了。</div>`}
          <h3>待复习 · ${ev.toReview.length} ｜ 我理解了 · ${ev.understood.length}</h3>
          ${ev.toReview.map(e => html`<div class="item"><div class="item-main"><div class="clamp-2">${e.question || e.quote}</div></div></div>`)}
          <h3>高亮 · ${ev.highlights.length}</h3>
          ${ev.highlights.slice(0, 12).map(n => html`<div class="quote">${n.quote.slice(0, 240)}</div>`)}
          <h3>笔记与疑问 · ${ev.comments.length + ev.questions.length}</h3>
          ${[...ev.questions, ...ev.comments].map(n => html`<div class="item"><div class="item-main">${n.quote ? html`<div class="quote">${n.quote.slice(0, 160)}</div>` : ''}<div>${n.type === 'question' ? html`<span class="badge badge-warn">疑问${n.resolved ? ' · 已解决' : ''}</span> ` : ''}${n.text}</div><div class="item-meta">${anchorLabel(n.anchor)} · ${relTime(n.at)}</div></div></div>`)}
          <h3>提问与解释 · ${ev.aiEvents.length}</h3>
          <div class="small muted">${ev.aiEvents.filter(e => e.status === 'done').length} 条真实回答，${ev.aiEvents.filter(e => e.status === 'demo').length} 条示例，${ev.aiEvents.filter(e => e.status === 'unavailable').length} 条未调用。</div>
        </div>
      </aside>
      <div>
        <div class="card">
          <div class="row-between"><h2>AI 草稿</h2><span class="row"><button class="btn btn-sm" id="genAi">${r.ai ? '重新生成' : '生成草稿'}</button></span></div>
          <div id="aiDraft">${r.ai ? html`<div class="small muted" style="margin-bottom:6px">${r.ai.status === 'demo' ? '示例草稿' : r.ai.model} · ${fmtDateTime(r.ai.generatedAt)} · 草稿只依据下方证据，不会覆盖你写的内容</div><div class="md" id="aiDraftBody">${markdownLite(r.ai.summary)}</div>` : html`<p class="small muted">根据高亮、笔记和提问生成一份论文总结草稿。证据不足的地方会标注，不会替你写结论。</p>`}</div>
        </div>
        <div class="card">
          <div class="row-between"><h2>我的复盘</h2><span class="autosave" id="autosaveHint">${r.draftAt ? '草稿自动保存于 ' + fmtDateTime(r.draftAt) : '输入后自动保存'}</span></div>
          <div class="field"><label>论文总结（研究问题 / 方法 / 主要发现 / 局限）</label><textarea id="hSummary" placeholder="这篇论文想解决什么问题？怎么做的？证据是什么？哪里站不住？">${r.human.summary}</textarea></div>
          <div class="field"><label>我的收获（和我的研究有什么关系）</label><textarea id="hTakeaways" placeholder="可以借用的方法、可以对比的结果、值得追的参考文献…">${r.human.takeaways}</textarea></div>
          <div class="field"><label>还没想清楚的</label><textarea id="hGaps" placeholder="读完仍然不确定的点，下次回来要先看哪里。">${r.human.gaps}</textarea></div>
          ${r.legacy ? html`<details class="block"><summary>旧版本的文本（技术知识 / 英语知识）</summary><pre style="white-space:pre-wrap;font-family:inherit;font-size:13px">${r.legacy.technical}\n\n${r.legacy.english}</pre><p class="hint">这是旧版自由文本。建议把其中的概念和表达拆成下面的条目，以便复习与汇总。</p></details>` : ''}
        </div>
        <div class="card">
          <h2>知识条目 · ${ev.knowledge.length}</h2>
          ${KINDS.map(kind => html`<div class="row-between" style="margin-top:12px"><h3 style="margin:0">${KIND_LABELS[kind]} · ${byKind(kind).length}</h3><button class="btn btn-sm" data-add-k="${kind}">＋ ${KIND_LABELS[kind]}</button></div>${byKind(kind).length ? byKind(kind).map(kItem) : html`<div class="small muted" style="margin-top:4px">${KIND_HINT[kind]}</div>`}`)}
        </div>
      </div>
    </div>
  </div>`);

  autosave = debounce(() => {
    r.human.summary = $('#hSummary').value;
    r.human.takeaways = $('#hTakeaways').value;
    r.human.gaps = $('#hGaps').value;
    r.draftAt = new Date().toISOString();
    const res = store.save();
    $('#autosaveHint').textContent = res.ok ? '草稿自动保存于 ' + fmtDateTime(r.draftAt) : '保存失败，请导出备份';
  }, 700);
  ['#hSummary', '#hTakeaways', '#hGaps'].forEach(sel => { $(sel).oninput = () => { $('#autosaveHint').textContent = '正在保存…'; autosave(); }; });

  $('#markReviewed').onclick = () => {
    autosave.flush();
    r.savedAt = new Date().toISOString();
    p.status = 'reviewed';
    s.events.push(newEvent({ paperId: p.id, action: 'review_saved', scope: 'paper', response: '标记为已复盘' }));
    const res = store.save();
    if (res.ok) toast('已标记为已复盘', { type: 'ok' });
    show(container, { id });
  };
  $('#exportMd').onclick = () => { autosave.flush(); download(reviewMarkdown(s, id), fileSafe(p.title) + '.md', 'text/markdown'); };
  $('#copyNotion').onclick = async () => {
    autosave.flush();
    try { await navigator.clipboard.writeText(reviewMarkdown(s, id)); toast('复盘 Markdown 已复制，粘贴到 Notion 页面即可', { type: 'ok' }); }
    catch { toast('剪贴板不可用，请用「导出 Markdown」', { type: 'error' }); }
    window.open(NOTION_URL, '_blank', 'noopener');
  };
  container.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.addK) editKnowledgeModal(null, () => show(container, { id }), { kind: b.dataset.addK, paperId: id });
    if (b.dataset.editK) editKnowledgeModal(b.dataset.editK, () => show(container, { id }));
  };
  $('#genAi').onclick = () => generateDraft(container, p, r, ev);
  renderMath(container);
  renderSvgFigures(container);
  renderDiagrams(container);
}

async function generateDraft(container, p, r, ev) {
  const s = store.state;
  const btn = $('#genAi');
  const out = $('#aiDraft');
  if (p.demo) {
    r.ai = { status: 'demo', generatedAt: new Date().toISOString(), model: 'demo', summary: '示例草稿（非模型生成）：本教学片段讨论医学图像分割中的域偏移。模型在源域表现好，不代表跨医院也好；扫描设备、患者群体和采集流程都可能改变数据分布。\n\n证据不足：示例没有实验结果，无法总结方法与发现。\n\n复习问题：\n1. 域偏移和 covariate shift 的区别是什么？\n2. 验证跨域性能需要什么样的实验设计？\n3. 图像外观变化一定导致分割性能下降吗？' };
    store.save(); show(container, { id: p.id }); return;
  }
  if (p.noAI) { toast('这篇论文已设为不发送给 AI', { type: 'error' }); return; }
  if (!aiReady(s.settings)) { toast('AI 未配置，请先到设置页填入 API Key', { type: 'error' }); return; }
  if (!ev.highlights.length && !ev.comments.length && !ev.aiEvents.length) { toast('还没有任何阅读证据（高亮、笔记或提问），草稿会没有依据', { type: 'error' }); return; }
  btn.disabled = true;
  render(out, html`<div class="md streaming-dot" id="aiDraftBody"></div>`);
  let buffer = '';
  const result = await streamAnswer({ settings: s.settings, user: reviewDraftPrompt({ title: p.title, evidence: ev }), effort: s.settings.ai.effort, onDelta: t => { buffer += t; const el = $('#aiDraftBody'); if (el) { render(el, markdownLite(buffer)); renderMath(el); } } });
  btn.disabled = false;
  if (!result.ok) { toast('生成失败：' + result.error, { type: 'error' }); show(container, { id: p.id }); return; }
  r.ai = { status: 'done', generatedAt: new Date().toISOString(), model: result.model, provider: result.provider || '', summary: result.text };
  store.save();
  show(container, { id: p.id });
}
