// Migration from the v1 prototype state (localStorage key 'paper-reading-v1').
// Pure module. Input is the parsed v1 object; output is a v2 state.
import { emptyState, newPaper, newEvent, newNote, newReview, normalize, SCHEMA_VERSION } from './schema.js';
import { DEMO_TEXT } from '../data/demo-paper.js';

const STATUS_MAP = { Inbox: 'inbox', Reading: 'reading', Completed: 'read' };
const FEEDBACK_MAP = { '未确认': 'none', '仍不理解': 'unclear', '自述理解': 'understood', '待复习': 'review' };
const ACTION_MAP = { complete: 'session_end', review: 'review_saved' };

export function splitTags(tags) {
  if (Array.isArray(tags)) return tags.map(t => String(t).trim()).filter(Boolean);
  return String(tags || '').split(/[,，;；]/).map(t => t.trim()).filter(Boolean);
}

export function isV1State(obj) {
  return !!obj && typeof obj === 'object' && Array.isArray(obj.papers) && !('schemaVersion' in obj);
}

export function migrateV1(v1) {
  const s = emptyState();
  const papers = Array.isArray(v1.papers) ? v1.papers : [];
  s.papers = papers.filter(p => p && p.id).map(p => newPaper({
    id: p.id,
    title: p.title || p.fileName || '未命名论文',
    authors: p.authors || '',
    year: p.year || '',
    venue: p.venue || '',
    doi: p.doi || '',
    url: p.sourceURL || '',
    tags: splitTags(p.tags),
    category: p.category || '未分类',
    status: STATUS_MAP[p.status] || 'inbox',
    fileName: p.fileName || '',
    size: p.size || 0,
    hash: p.hash || '',
    hasPdf: !!p.hash,
    excerptText: p.demo ? DEMO_TEXT : (p.excerpt || ''),
    demo: !!p.demo,
    createdAt: p.created || new Date().toISOString(),
    lastOpenedAt: p.lastOpenedAt || null,
    readerView: p.demo ? 'text' : (p.readerView || (p.excerpt && !p.hash ? 'text' : 'pdf')),
  }));
  const ids = new Set(s.papers.map(p => p.id));

  s.notes = (Array.isArray(v1.notes) ? v1.notes : []).filter(n => n && ids.has(n.paperId)).map(n => newNote({
    id: n.id,
    paperId: n.paperId,
    type: n.type === 'highlight' ? 'highlight' : 'comment',
    quote: n.quote || '',
    text: n.text || '',
    at: n.at || new Date().toISOString(),
    anchor: { kind: 'text', quote: n.quote || '', prefix: '', suffix: '', start: null, end: null, paragraph: Number.isInteger(n.paragraph) ? n.paragraph : null, legacyLabel: n.anchor || '' },
  }));

  s.events = (Array.isArray(v1.events) ? v1.events : []).filter(e => e && ids.has(e.paperId)).map(e => newEvent({
    id: e.id,
    paperId: e.paperId,
    action: ACTION_MAP[e.action] || e.action || 'ask',
    scope: e.scope || 'selection',
    quote: e.quote || '',
    question: e.question || '',
    response: e.response || '',
    status: e.execution === 'demo' || e.demo ? 'demo' : e.execution === 'unavailable' ? 'unavailable' : 'done',
    feedback: FEEDBACK_MAP[e.feedback] || 'none',
    feedbackAt: e.feedbackAt || null,
    at: e.at || new Date().toISOString(),
    provider: e.demo ? 'demo' : '',
  }));

  const reviews = v1.reviews && typeof v1.reviews === 'object' ? v1.reviews : {};
  for (const [paperId, r] of Object.entries(reviews)) {
    if (!ids.has(paperId) || !r) continue;
    const rec = newReview(paperId);
    const h = r.human || {};
    rec.human.summary = h.paper || '';
    if ((h.technical || '').trim() || (h.english || '').trim()) {
      rec.legacy = { technical: h.technical || '', english: h.english || '' };
    }
    if (r.ai && r.ai.status === 'demo') {
      rec.ai = { status: 'demo', generatedAt: r.ai.generatedAt || null, summary: r.ai.paper || '', model: 'demo' };
    }
    rec.savedAt = r.humanSavedAt || null;
    s.reviews[paperId] = rec;
  }

  const profile = v1.profile || {};
  const prefs = v1.preferences || {};
  s.settings.name = profile.name || '';
  s.settings.research = profile.research || '';
  s.settings.fontSize = ['small', 'medium', 'large'].includes(prefs.font) ? prefs.font : 'medium';
  s.settings.theme = prefs.theme === 'warm' ? 'warm' : 'light';
  const layout = v1.readerLayout || {};
  s.layout.sidebarCollapsed = !!layout.sidebarCollapsed;
  s.layout.assistantVisible = layout.assistantVisible !== false;
  s.layout.assistantWidth = Number(layout.assistantWidth) || 360;
  const cur = v1.readingCurrent || v1.current;
  s.current.paperId = ids.has(cur) ? cur : null;
  s.schemaVersion = SCHEMA_VERSION;
  return normalize(s);
}

// Entry point used by the store: takes whatever was found in storage.
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (isV1State(raw)) return migrateV1(raw);
  if (raw.schemaVersion === SCHEMA_VERSION) return normalize(raw);
  if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > SCHEMA_VERSION) {
    throw new Error('数据来自更新版本的应用（schema ' + raw.schemaVersion + '），当前版本无法读取。');
  }
  return normalize(raw);
}
