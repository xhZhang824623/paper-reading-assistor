// Export and import helpers. Pure module.
import { ACTION_NAMES, FEEDBACK, PAPER_STATUS } from '../state/schema.js';
import { paperEvidence, formatDuration, sessionDurationMs } from './review.js';
import { anchorLabel } from './anchors.js';
import { migrate } from '../state/migrate.js';
import { KINDS, KIND_LABELS, STATUS_LABELS } from './knowledge.js';

const fmt = iso => iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '';

export function paperHeader(p) {
  const bits = [p.authors, p.year, p.venue].filter(Boolean).join(' · ');
  return `# ${p.title}\n\n${bits ? bits + '\n' : ''}${p.doi ? 'DOI: ' + p.doi + '\n' : ''}${p.url ? '来源: ' + p.url + '\n' : ''}状态: ${PAPER_STATUS[p.status] || p.status}${p.demo ? ' · 教学示例' : ''}\n`;
}

export function reviewMarkdown(state, paperId) {
  const p = state.papers.find(x => x.id === paperId);
  if (!p) return '';
  const r = state.reviews[paperId] || { human: { summary: '', takeaways: '', gaps: '' }, ai: null, legacy: null };
  const ev = paperEvidence(state, paperId);
  const lines = [paperHeader(p)];
  lines.push('## 论文总结（我写的）\n' + (r.human.summary || '尚未填写') + '\n');
  lines.push('## 我的收获\n' + (r.human.takeaways || '尚未填写') + '\n');
  lines.push('## 还没想清楚的\n' + (r.human.gaps || '尚未填写') + '\n');
  if (r.ai && r.ai.summary) lines.push(`## AI 草稿（${r.ai.model || r.ai.status}，${fmt(r.ai.generatedAt)}）\n${r.ai.summary}\n`);
  if (r.legacy) lines.push('## 旧版文本\n### 技术知识\n' + (r.legacy.technical || '无') + '\n\n### 英语知识\n' + (r.legacy.english || '无') + '\n');
  for (const kind of KINDS) {
    const list = ev.knowledge.filter(k => k.kind === kind);
    lines.push(`## ${KIND_LABELS[kind]}\n` + (list.length ? list.map(knowledgeLine).join('\n') : '无') + '\n');
  }
  lines.push('## 阅读会话\n' + (ev.sessions.length ? ev.sessions.map(s => `- ${fmt(s.startedAt)} · ${formatDuration(sessionDurationMs(s))} · ${s.outcome === 'finished' ? '读完' : s.outcome === 'partial' ? '读了一部分' : s.outcome === 'parked' ? '先放着' : '进行中'}`).join('\n') : '无') + '\n');
  lines.push('## 提问与解释记录\n' + (ev.aiEvents.length ? ev.aiEvents.map(e => `- [${ACTION_NAMES[e.action] || e.action}] ${(e.question || e.quote || '').slice(0, 200)}\n  反馈：${FEEDBACK[e.feedback] || e.feedback} · ${e.status === 'demo' ? '示例回答' : e.status === 'unavailable' ? '未调用 AI' : e.model || e.status}`).join('\n') : '无') + '\n');
  lines.push('## 高亮与笔记\n' + (ev.notes.length ? ev.notes.map(n => `- [${anchorLabel(n.anchor)}] ${n.quote ? '“' + n.quote.slice(0, 200) + '”' : ''}${n.text ? '\n  ' + n.text : ''}`).join('\n') : '无') + '\n');
  lines.push(`\n导出时间：${fmt(new Date().toISOString())}。本文件由 Paper Reading 本机导出；AI 草稿与本人笔记分开列出。`);
  return lines.join('\n');
}

function knowledgeLine(k, byPaper = null) {
  const kindExample = k.kind === 'phrase' ? '我的例句：' : '例：';
  let out = `- **${k.term}**${k.kind === 'word' && k.phonetic ? ' /' + k.phonetic + '/' : ''}：${k.meaning || ''}`;
  if (k.note) out += '\n  我的理解：' + k.note;
  if (k.example) out += '\n  ' + kindExample + k.example;
  for (const c of k.contexts || []) out += '\n  > ' + c.sentence + (byPaper ? '（' + (byPaper(c.paperId)?.title || '未知论文') + (c.page ? '，第 ' + c.page + ' 页' : '') + '）' : (c.page ? '（第 ' + c.page + ' 页）' : ''));
  out += `\n  状态：${STATUS_LABELS[k.status] || k.status}`;
  if (byPaper) out += ` · 来源：${byPaper(k.paperId)?.title || '未知论文'}`;
  return out;
}

export function knowledgeMarkdown(state) {
  const byPaper = id => state.papers.find(p => p.id === id);
  const sections = KINDS.map(kind => {
    const list = state.knowledge.filter(k => k.kind === kind);
    return `## ${KIND_LABELS[kind]}（${list.length}）\n${list.map(k => knowledgeLine(k, byPaper)).join('\n') || '无'}`;
  });
  return `# 知识汇总\n\n${sections.join('\n\n')}\n`;
}

// Backup never contains API keys.
export function exportJSON(state) {
  const copy = JSON.parse(JSON.stringify(state));
  if (copy.settings && copy.settings.ai) {
    delete copy.settings.ai.apiKey;
    for (const p of Object.values(copy.settings.ai.providers || {})) if (p && typeof p === 'object') p.apiKey = '';
  }
  return JSON.stringify({ ...copy, exportedAt: new Date().toISOString(), pdfFilesIncluded: false }, null, 2);
}

// Merge a backup into the current state. Existing records win; new ids are added.
export function mergeImport(state, importedRaw) {
  const imported = migrate(importedRaw);
  if (!imported) throw new Error('备份文件格式无法识别。');
  const added = { papers: 0, sessions: 0, events: 0, notes: 0, knowledge: 0, reviews: 0 };
  const next = { ...state };
  for (const key of ['papers', 'sessions', 'events', 'notes', 'knowledge']) {
    const have = new Set(state[key].map(x => x.id));
    const fresh = imported[key].filter(x => !have.has(x.id));
    next[key] = [...state[key], ...fresh];
    added[key] = fresh.length;
  }
  next.reviews = { ...state.reviews };
  for (const [id, r] of Object.entries(imported.reviews)) {
    if (!next.reviews[id]) { next.reviews[id] = r; added.reviews++; }
  }
  // Papers that arrived without a PDF in this browser.
  const paperIds = new Set(state.papers.map(p => p.id));
  next.papers = next.papers.map(p => paperIds.has(p.id) ? p : { ...p, hasPdf: false });
  return { state: next, added };
}

export function fileSafe(name) {
  return String(name || 'paper').replace(/[\\/:*?"<>|\n]+/g, ' ').trim().slice(0, 80) || 'paper';
}
