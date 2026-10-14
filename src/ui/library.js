import { store } from '../state/store.js';
import { PAPER_STATUS, CATEGORIES } from '../state/schema.js';
import { $, $$, html, render, fmtDate } from './dom.js';
import { editPaperModal, deletePaperFlow, statusOptions, setPaperStatus } from './paper-edit.js';

const filters = { q: '', category: '', status: '' };

function matches(p) {
  const q = filters.q.toLowerCase();
  return (!filters.category || p.category === filters.category)
    && (!filters.status || p.status === filters.status)
    && (!q || [p.title, p.authors, p.year, p.venue, p.doi, p.tags.join(' ')].join(' ').toLowerCase().includes(q));
}

function badges(p) {
  return html`${p.demo ? html`<span class="badge">教学示例</span>` : ''}${!p.hasPdf && !p.demo ? html`<span class="badge badge-warn">无 PDF</span>` : ''}${p.noAI ? html`<span class="badge badge-danger">不发 AI</span>` : ''}`;
}

function card(p) {
  const meta = [p.authors, p.year, p.venue].filter(Boolean).join(' · ');
  return html`<article class="paper-card" data-id="${p.id}">
    <div class="row-between"><select class="status-select" data-status="${p.id}" aria-label="阅读状态">${statusOptions(p.status)}</select><span class="row">${badges(p)}</span></div>
    <h3><a href="#/read/${p.id}">${p.title}</a></h3>
    <div class="meta">${meta || '作者、年份待补充'}${p.url ? html` · <a href="${p.url}" target="_blank" rel="noopener">来源 ↗</a>` : ''}</div>
    <div><span class="tag">${p.category}</span>${p.tags.map(t => html`<span class="tag">${t}</span>`)}</div>
    <div class="actions"><button class="btn btn-sm btn-primary" data-open="${p.id}">阅读</button><button class="btn btn-sm" data-review="${p.id}">复盘</button><span class="spacer"></span><span class="menu-wrap"><button class="icon-btn" data-menu="${p.id}" aria-label="更多">⋯</button></span></div>
  </article>`;
}

function rowHTML(p) {
  return html`<tr data-id="${p.id}"><td><div class="title"><a href="#/read/${p.id}">${p.title}</a></div><div class="small muted">${[p.authors, p.year, p.venue].filter(Boolean).join(' · ') || '元数据待补充'}</div></td><td><span class="tag">${p.category}</span>${p.tags.map(t => html`<span class="tag">${t}</span>`)}</td><td><select class="status-select" data-status="${p.id}">${statusOptions(p.status)}</select> ${badges(p)}</td><td class="small muted nowrap">${fmtDate(p.lastOpenedAt || p.createdAt)}</td><td><div class="row nowrap"><button class="btn btn-sm btn-primary" data-open="${p.id}">阅读</button><button class="btn btn-sm" data-review="${p.id}">复盘</button><span class="menu-wrap"><button class="icon-btn" data-menu="${p.id}" aria-label="更多">⋯</button></span></div></td></tr>`;
}

export function show(container) {
  const s = store.state;
  const view = s.layout.libraryView || 'cards';
  const list = s.papers.filter(matches).sort((a, b) => (b.lastOpenedAt || b.createdAt || '').localeCompare(a.lastOpenedAt || a.createdAt || ''));
  render(container, html`<div class="page">
    <div class="page-head"><div><h1>论文库</h1><p>${s.papers.length} 篇${list.length !== s.papers.length ? html`，筛选后 ${list.length} 篇` : ''}。拖入 PDF 即可导入。</p></div>
      <div class="page-actions"><button class="btn btn-primary" data-import>＋ 导入 PDF</button></div></div>
    <div class="lib-toolbar">
      <input type="search" id="libSearch" placeholder="搜索标题、作者、年份、出处、标签" value="${filters.q}" aria-label="搜索">
      <select id="libCategory" aria-label="分类"><option value="">所有分类</option>${CATEGORIES.map(c => html`<option ${filters.category === c ? 'selected' : ''}>${c}</option>`)}</select>
      <select id="libStatus" aria-label="状态"><option value="">所有状态</option>${Object.entries(PAPER_STATUS).map(([v, l]) => html`<option value="${v}" ${filters.status === v ? 'selected' : ''}>${l}</option>`)}</select>
      <div class="seg"><button data-view="cards" class="${view === 'cards' ? 'active' : ''}">卡片</button><button data-view="list" class="${view === 'list' ? 'active' : ''}">列表</button></div>
    </div>
    ${!list.length ? html`<div class="empty">${s.papers.length ? '没有匹配的论文。' : '还没有论文。把 PDF 拖进窗口，或点击右上角导入。'}</div>`
      : view === 'cards' ? html`<div class="paper-grid">${list.map(card)}</div>`
      : html`<table class="paper-table"><thead><tr><th>论文</th><th>分类与标签</th><th>状态</th><th>最近</th><th></th></tr></thead><tbody>${list.map(rowHTML)}</tbody></table>`}
  </div>`);

  $('#libSearch').oninput = e => { filters.q = e.target.value; refreshList(container); };
  $('#libCategory').onchange = e => { filters.category = e.target.value; show(container); };
  $('#libStatus').onchange = e => { filters.status = e.target.value; show(container); };
  container.onchange = e => { const sel = e.target.closest('[data-status]'); if (sel) setPaperStatus(sel.dataset.status, sel.value); };
  container.onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.import !== undefined) $('#fileInput').click();
    if (b.dataset.view) { s.layout.libraryView = b.dataset.view; store.save(); show(container); }
    if (b.dataset.open) location.hash = '#/read/' + b.dataset.open;
    if (b.dataset.review) location.hash = '#/review/' + b.dataset.review;
    if (b.dataset.menu) openMenu(b, b.dataset.menu, container);
  };
}

function refreshList(container) {
  // Re-render only the list region to keep the search box focused.
  const pos = $('#libSearch').selectionStart;
  show(container);
  const input = $('#libSearch');
  input.focus();
  input.setSelectionRange(pos, pos);
}

function openMenu(anchor, paperId, container) {
  $$('.menu').forEach(m => m.remove());
  const p = store.state.papers.find(x => x.id === paperId);
  if (!p) return;
  const menu = document.createElement('div');
  menu.className = 'menu';
  render(menu, html`<button data-edit>编辑信息与标签</button><button data-noai>${p.noAI ? '允许发送给 AI' : '不发送给 AI'}</button><button data-paste>粘贴文本片段…</button><button class="danger" data-delete>删除${p.demo ? '示例' : ''}</button>`);
  anchor.parentElement.append(menu);
  menu.style.right = '0';
  menu.style.top = '32px';
  const close = () => { menu.remove(); document.removeEventListener('click', onDoc, true); };
  const onDoc = e => { if (!menu.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('click', onDoc, true), 0);
  menu.onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    close();
    if (b.dataset.edit !== undefined) editPaperModal(paperId, () => show(container));
    if (b.dataset.noai !== undefined) { p.noAI = !p.noAI; store.save(); show(container); }
    if (b.dataset.paste !== undefined) location.hash = '#/read/' + paperId + '/paste';
    if (b.dataset.delete !== undefined) { if (await deletePaperFlow(paperId)) show(container); }
  };
}
