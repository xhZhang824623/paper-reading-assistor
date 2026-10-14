// Home: what to do today. Continue reading, review queue, open questions, inbox, then stats.
import { store } from '../state/store.js';
import { kindBadge } from './knowledge.js';
import { reviewPrompt } from '../domain/knowledge.js';
import { PAPER_STATUS } from '../state/schema.js';
import { $, $$, html, render, relTime, fmtDate } from './dom.js';
import { dueItems, upcomingItems, openQuestions, applyRecall, formatDuration, sessionDurationMs } from '../domain/review.js';
import { lastSession } from '../domain/session.js';
import { countByDay, heatmap, dayKey, weekSummary } from '../domain/stats.js';

function sessionLine(p) {
  const s = lastSession(store.state, p.id);
  if (!s) return '还没开始读';
  const outcome = s.endedAt ? ({ finished: '上次读完了', partial: '上次读了一部分', parked: '先放着' })[s.outcome] || '上次' : '阅读中';
  return `${outcome} · ${relTime(s.lastActiveAt || s.startedAt)} · ${formatDuration(sessionDurationMs(s))}`;
}

export function show(container) {
  const s = store.state;
  const today = dayKey(new Date());
  const byOpened = (a, b) => (b.lastOpenedAt || '').localeCompare(a.lastOpenedAt || '');
  const continueList = s.papers.filter(p => ['reading', 'parked'].includes(p.status)).sort(byOpened).slice(0, 5);
  const toReview = s.papers.filter(p => p.status === 'read').sort(byOpened);
  const inbox = s.papers.filter(p => p.status === 'inbox').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const due = dueItems(s.knowledge);
  const upcoming = upcomingItems(s.knowledge);
  const questions = openQuestions(s).slice(0, 8);
  const unclearCount = id => s.events.filter(e => e.paperId === id && e.feedback === 'unclear').length;
  const week = weekSummary(s, today);
  const heat = heatmap(countByDay(s.events), today, 26);
  const paperTitle = id => s.papers.find(p => p.id === id)?.title || '已删除的论文';
  const dateline = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  const realPapers = s.papers.filter(p => !p.demo);

  render(container, html`<div class="page">
    <div class="page-head"><div><h1>今天</h1><p>${dateline} · 本周 ${week.sessions} 次阅读，${week.finished} 篇读完，新增 ${week.knowledge} 条知识</p></div>
      <div class="page-actions"><button class="btn btn-primary" data-import>＋ 导入 PDF</button></div></div>
    ${realPapers.length ? '' : html`<div class="card" style="margin-bottom:16px"><h2>从一篇真论文开始</h2><p class="muted">把 PDF 拖进窗口或点击「导入 PDF」。导入后可以直接在 PDF 上划词翻译、解释、提问和高亮。${s.papers.some(p => p.demo) ? '想先试试流程，可以打开左侧的教学示例。' : ''}</p>
      ${s.settings.ai.enabled ? '' : html`<p class="muted" style="margin-top:6px">AI 还没有配置：到 <a href="#/settings">设置</a> 填入 API Key 后，翻译和解释才会真正调用模型。</p>`}</div>`}
    <div class="grid-2">
      <section class="card">
        <div class="row-between"><h2>继续阅读</h2><a href="#/library" class="small">全部论文 →</a></div>
        ${continueList.length ? continueList.map(p => html`<div class="item"><div class="item-main"><div class="item-title clamp-2">${p.title}${p.demo ? html` <span class="badge">示例</span>` : ''}</div><div class="item-meta">${PAPER_STATUS[p.status]} · ${sessionLine(p)}${unclearCount(p.id) ? html` · <span class="badge badge-warn">${unclearCount(p.id)} 处仍不理解</span>` : ''}</div></div><div class="item-actions"><button class="btn btn-sm btn-primary" data-open="${p.id}">继续</button></div></div>`) : html`<div class="empty">没有正在读的论文。${inbox.length ? '从收件箱挑一篇开始。' : ''}</div>`}
        ${toReview.length ? html`<h3 style="margin:14px 0 4px;font-size:13px;color:var(--ink-2)">读完了，还没复盘</h3>${toReview.map(p => html`<div class="item"><div class="item-main"><div class="item-title clamp-2">${p.title}</div><div class="item-meta">${sessionLine(p)}</div></div><div class="item-actions"><button class="btn btn-sm" data-review="${p.id}">写复盘</button></div></div>`)}` : ''}
      </section>
      <section class="card">
        <div class="row-between"><h2>今日复习 ${due.length ? html`<span class="badge badge-warn">${due.length}</span>` : ''}</h2><a href="#/knowledge" class="small">全部知识 →</a></div>
        ${due.length ? due.slice(0, 6).map(k => html`<div class="item" data-k="${k.id}"><div class="item-main"><div class="item-title">${kindBadge(k.kind)} ${k.term}${k.kind === 'word' && k.phonetic ? html` <span class="muted small">/${k.phonetic}/</span>` : ''}</div><div class="item-meta">${reviewPrompt(k)} · ${paperTitle(k.paperId)} · 第 ${k.reviewCount + 1} 次复习</div><div class="reveal" hidden><div>${k.meaning || '（没有写含义）'}</div>${k.note ? html`<div class="small muted" style="margin-top:4px">我的理解：${k.note}</div>` : ''}${k.example ? html`<div class="small muted" style="margin-top:4px">例：${k.example}</div>` : ''}${k.contexts && k.contexts[0] ? html`<div class="quote">${k.contexts[0].sentence}</div>` : ''}</div></div><div class="item-actions"><button class="btn btn-sm" data-reveal>看答案</button><button class="btn btn-sm" data-recall="${k.id}" data-ok="1" hidden>记得</button><button class="btn btn-sm" data-recall="${k.id}" data-ok="0" hidden>不记得</button></div></div>`) : html`<div class="empty">今天没有到期的复习${upcoming.length ? html`，未来 7 天有 ${upcoming.length} 条` : ''}。<br><span class="small">在回答下方点「待复习」或把概念存为条目，这里就会排期。</span></div>`}
      </section>
    </div>
    <div class="grid-2" style="margin-top:16px">
      <section class="card">
        <h2>还没想清楚的问题</h2>
        ${questions.length ? questions.map(q => html`<div class="item"><div class="item-main"><div class="clamp-2">${q.text}</div><div class="item-meta">${paperTitle(q.paperId)} · ${relTime(q.at)}</div></div><div class="item-actions"><button class="btn btn-sm" data-open="${q.paperId}">回到论文</button></div></div>`) : html`<div class="empty">没有标记为「仍不理解」的问题。</div>`}
      </section>
      <section class="card">
        <div class="row-between"><h2>收件箱 ${inbox.length ? html`<span class="badge">${inbox.length}</span>` : ''}</h2></div>
        ${inbox.length ? inbox.slice(0, 6).map(p => html`<div class="item"><div class="item-main"><div class="item-title clamp-2">${p.title}</div><div class="item-meta">${[p.authors, p.year, p.venue].filter(Boolean).join(' · ') || '元数据待补充'} · 导入于 ${fmtDate(p.createdAt)}</div></div><div class="item-actions"><button class="btn btn-sm btn-primary" data-open="${p.id}">开始读</button></div></div>`) : html`<div class="empty">收件箱是空的。</div>`}
      </section>
    </div>
    <section class="section">
      <div class="section-head"><h2>最近 26 周</h2><small class="muted">${heat.activeDays} 个活跃日 · 统计的是操作次数，不是时长</small></div>
      <div class="card"><div class="heat">${heat.cells.map(c => html`<i class="l${c.level} ${c.future ? 'future' : ''}" title="${c.key} · ${c.count} 次"></i>`)}</div></div>
    </section>
  </div>`);

  container.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.import !== undefined) $('#fileInput').click();
    if (b.dataset.open) location.hash = '#/read/' + b.dataset.open;
    if (b.dataset.review) location.hash = '#/review/' + b.dataset.review;
    if (b.dataset.reveal !== undefined) {
      const item = b.closest('.item');
      item.querySelector('.reveal').hidden = false;
      b.hidden = true;
      $$('[data-recall]', item).forEach(x => x.hidden = false);
    }
    if (b.dataset.recall) {
      const idx = store.state.knowledge.findIndex(k => k.id === b.dataset.recall);
      if (idx === -1) return;
      store.state.knowledge[idx] = applyRecall(store.state.knowledge[idx], b.dataset.ok === '1');
      store.save();
      show(container);
    }
  };
}
