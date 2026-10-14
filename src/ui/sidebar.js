import { store } from '../state/store.js';
import { $, $$, html, render } from './dom.js';
import { dueItems } from '../domain/review.js';

export function initSidebar() {
  $('#sideToggle').onclick = () => {
    store.state.layout.sidebarCollapsed = !store.state.layout.sidebarCollapsed;
    store.save();
    applySidebar();
  };
  $('#recentPapers').addEventListener('click', e => {
    const b = e.target.closest('[data-open]');
    if (b) location.hash = '#/read/' + b.dataset.open;
  });
  applySidebar();
  updateSidebar();
}

export function applySidebar() {
  document.body.classList.toggle('sidebar-collapsed', !!store.state.layout.sidebarCollapsed);
}

export function updateSidebar(route = '', params = {}) {
  const s = store.state;
  $('#paperCount').textContent = s.papers.length;
  const due = dueItems(s.knowledge).length;
  const dueEl = $('#dueCount');
  dueEl.textContent = due;
  dueEl.classList.toggle('due', due > 0);
  dueEl.hidden = due === 0;
  $$('[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === route));
  const recent = s.papers.filter(p => p.lastOpenedAt).sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt)).slice(0, 6);
  render($('#recentPapers'), recent.length
    ? recent.map(p => html`<button class="recent-paper ${route === 'read' && params.id === p.id ? 'active' : ''}" data-open="${p.id}" title="${p.title}">${p.title}</button>`)
    : html`<div class="hint" style="padding:0 10px">还没有打开过论文</div>`);
  const status = $('#saveStatus');
  if (store.lastSaveError) { status.textContent = '保存失败，请导出备份'; status.className = 'error'; }
  else { status.textContent = ''; status.className = ''; }
}
