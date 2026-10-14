// Paper metadata editing and deletion, shared by library and reader.
import { store } from '../state/store.js';
import { dbDelete, dbDeletePaperFiles } from '../state/db.js';
import { PAPER_STATUS, CATEGORIES } from '../state/schema.js';
import { splitTags } from '../state/migrate.js';
import { $, html, modal, closeModal, confirmDialog, toast } from './dom.js';

export function statusOptions(current) {
  return Object.entries(PAPER_STATUS).map(([v, label]) => html`<option value="${v}" ${v === current ? 'selected' : ''}>${label}</option>`);
}

function safeURL(url) {
  try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; }
}

export function editPaperModal(paperId, onSaved) {
  const p = store.state.papers.find(x => x.id === paperId);
  if (!p) return;
  const dlg = modal({
    title: '论文信息',
    body: html`<form id="paperForm" class="form-grid">
      <div class="field full"><label>标题</label><input name="title" required value="${p.title}"></div>
      <div class="field full"><label>作者</label><input name="authors" value="${p.authors}" placeholder="按署名顺序"></div>
      <div class="field"><label>年份</label><input name="year" value="${p.year}" placeholder="2026"></div>
      <div class="field"><label>会议 / 期刊</label><input name="venue" value="${p.venue}" placeholder="MICCAI / TMI"></div>
      <div class="field full"><label>来源链接</label><input name="url" type="url" value="${p.url}" placeholder="https://"></div>
      <div class="field full"><label>DOI</label><input name="doi" value="${p.doi}" placeholder="10.xxxx/xxxxx"></div>
      <div class="field"><label>分类</label><select name="category">${CATEGORIES.map(c => html`<option ${c === p.category ? 'selected' : ''}>${c}</option>`)}</select></div>
      <div class="field"><label>状态</label><select name="status">${statusOptions(p.status)}</select></div>
      <div class="field full"><label>标签（逗号分隔）</label><input name="tags" value="${p.tags.join(', ')}"></div>
      <div class="field full"><label class="checkbox"><input type="checkbox" name="noAI" ${p.noAI ? 'checked' : ''}> 不把这篇论文的内容发送给 AI（审稿稿件、未发表草稿等）</label></div>
      <div class="modal-actions full"><button type="button" class="btn" data-cancel>取消</button><button class="btn btn-primary">保存</button></div>
    </form>`,
  });
  const form = $('#paperForm', dlg);
  form.querySelector('[data-cancel]').onclick = () => closeModal();
  form.onsubmit = e => {
    e.preventDefault();
    const f = form.elements;
    const doi = f.doi.value.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase();
    if (doi && store.state.papers.some(x => x.id !== p.id && x.doi === doi)) { toast('这个 DOI 已有另一条记录，请先核对', { type: 'error' }); return; }
    const url = f.url.value.trim();
    if (url && !safeURL(url)) { toast('来源链接需要是 http 或 https', { type: 'error' }); return; }
    Object.assign(p, {
      title: f.title.value.trim() || p.title,
      authors: f.authors.value.trim(),
      year: f.year.value.trim(),
      venue: f.venue.value.trim(),
      url: url ? safeURL(url) : '',
      doi,
      category: f.category.value,
      status: f.status.value,
      tags: splitTags(f.tags.value),
      noAI: f.noAI.checked,
    });
    const r = store.save();
    closeModal();
    if (r.ok) toast('已保存论文信息', { type: 'ok' });
    if (onSaved) onSaved(p);
  };
}

export async function deletePaperFlow(paperId) {
  const p = store.state.papers.find(x => x.id === paperId);
  if (!p) return false;
  const counts = {
    notes: store.state.notes.filter(n => n.paperId === paperId).length,
    events: store.state.events.filter(e => e.paperId === paperId).length,
    knowledge: store.state.knowledge.filter(k => k.paperId === paperId).length,
  };
  const ok = await confirmDialog({
    title: '删除这篇论文？',
    message: `「${p.title}」及其 ${counts.notes} 条笔记、${counts.events} 条记录、${counts.knowledge} 条知识条目会一起删除，PDF 也会从浏览器移除。此操作无法撤销。`,
    confirmText: '删除', danger: true,
  });
  if (!ok) return false;
  const s = store.state;
  s.papers = s.papers.filter(x => x.id !== paperId);
  s.notes = s.notes.filter(x => x.paperId !== paperId);
  s.events = s.events.filter(x => x.paperId !== paperId);
  s.knowledge = s.knowledge.filter(x => x.paperId !== paperId);
  s.sessions = s.sessions.filter(x => x.paperId !== paperId);
  delete s.reviews[paperId];
  if (s.current.paperId === paperId) s.current.paperId = null;
  if (p.demo) s.settings.demoDismissed = true;
  const r = store.save();
  dbDeletePaperFiles(paperId);
  if (r.ok) toast('已删除', { type: 'ok' });
  return true;
}

export function setPaperStatus(paperId, status) {
  const p = store.state.papers.find(x => x.id === paperId);
  if (!p || !PAPER_STATUS[status]) return;
  p.status = status;
  store.save();
}
