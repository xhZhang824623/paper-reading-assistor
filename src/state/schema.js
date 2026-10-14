// Data model v2. Pure module: no DOM, no storage access.
import { migrateKind } from '../domain/knowledge.js';
export const SCHEMA_VERSION = 2;

export const PAPER_STATUS = {
  inbox: '收件箱',
  reading: '阅读中',
  parked: '搁置',
  read: '已读完',
  reviewed: '已复盘',
  archived: '已归档',
};

export const CATEGORIES = ['医学影像', '手术机器人', '计算机视觉', '未分类'];

export const FEEDBACK = {
  none: '未标记',
  unclear: '仍不理解',
  understood: '我理解了',
  review: '待复习',
};

export const ACTION_NAMES = {
  translate: '翻译',
  explain: '解释',
  summarize: '总结',
  ask: '提问',
  highlight: '高亮',
  note: '笔记',
  session_end: '结束阅读',
  review_saved: '保存复盘',
};

export const uid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

export const nowISO = () => new Date().toISOString();

export function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    papers: [],
    sessions: [],
    events: [],
    notes: [],
    knowledge: [],
    reviews: {},
    settings: defaultSettings(),
    layout: { sidebarCollapsed: false, assistantWidth: 440, assistantVisible: true },
    current: { paperId: null },
  };
}

export const AI_PROVIDERS = ['anthropic', 'deepseek', 'openai'];

export function defaultProviders() {
  return {
    anthropic: { apiKey: '', model: 'claude-opus-5-5', fastModel: '', baseUrl: '' },
    deepseek: { apiKey: '', model: 'deepseek-v4-pro', fastModel: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' },
    openai: { apiKey: '', model: 'gpt-5', fastModel: '', baseUrl: 'https://api.openai.com/v1' },
  };
}

export function defaultSettings() {
  return {
    name: '',
    research: '',
    fontSize: 'medium',
    theme: 'light',
    readerLevel: 'novice',
    autoVocab: false,
    attachPageImages: false,
    ai: { enabled: false, provider: 'anthropic', effort: 'medium', providers: defaultProviders() },
  };
}

// Accepts the old flat shape ({apiKey, model, baseUrl}) and the new per-provider shape.
export function normalizeAI(raw) {
  const base = defaultSettings().ai;
  const src = raw && typeof raw === 'object' ? raw : {};
  const ai = { enabled: !!src.enabled, provider: AI_PROVIDERS.includes(src.provider) ? src.provider : 'anthropic', effort: ['low', 'medium', 'high'].includes(src.effort) ? src.effort : base.effort, providers: defaultProviders() };
  for (const id of AI_PROVIDERS) {
    const given = src.providers && src.providers[id] && typeof src.providers[id] === 'object' ? src.providers[id] : {};
    ai.providers[id] = { ...ai.providers[id], ...given };
    for (const k of ['apiKey', 'model', 'fastModel', 'baseUrl']) ai.providers[id][k] = String(ai.providers[id][k] ?? '');
  }
  if (!src.providers && (src.apiKey || src.model || src.baseUrl)) {
    const a = ai.providers.anthropic;
    if (src.apiKey) a.apiKey = String(src.apiKey);
    if (src.model) a.model = String(src.model);
    if (src.baseUrl) a.baseUrl = String(src.baseUrl);
  }
  return ai;
}

export function newPaper(partial = {}) {
  return {
    id: uid(),
    title: '',
    authors: '',
    year: '',
    venue: '',
    doi: '',
    url: '',
    tags: [],
    category: '未分类',
    status: 'inbox',
    fileName: '',
    size: 0,
    hash: '',
    hasPdf: false,
    excerptText: '',
    demo: false,
    noAI: false,
    createdAt: nowISO(),
    lastOpenedAt: null,
    readerView: 'pdf',
    readerPos: { page: 1, scrollTop: 0, zoom: 'auto' },
    ...partial,
  };
}

export function newSession(paperId) {
  const at = nowISO();
  return { id: uid(), paperId, startedAt: at, lastActiveAt: at, endedAt: null, outcome: null };
}

export function newEvent(partial) {
  return {
    id: uid(),
    paperId: null,
    sessionId: null,
    action: 'ask',
    scope: 'selection',
    quote: '',
    anchor: null,
    question: '',
    response: '',
    provider: '',
    model: '',
    status: 'done',
    error: '',
    feedback: 'none',
    feedbackAt: null,
    at: nowISO(),
    latencyMs: null,
    parentId: null,
    ...partial,
  };
}

export function newNote(partial) {
  return {
    id: uid(),
    paperId: null,
    type: 'highlight',
    anchor: null,
    quote: '',
    text: '',
    color: 'yellow',
    at: nowISO(),
    resolved: false,
    ...partial,
  };
}

export function newKnowledge(partial) {
  return {
    id: uid(),
    paperId: null,
    kind: 'concept',
    term: '',
    meaning: '',
    note: '',
    example: '',
    status: 'new',
    phonetic: '',
    contexts: [],
    sourceEventId: null,
    sourceQuote: '',
    createdAt: nowISO(),
    nextReviewAt: null,
    reviewCount: 0,
    lastReviewedAt: null,
    ...partial,
  };
}

export function newReview(paperId) {
  return {
    paperId,
    human: { summary: '', takeaways: '', gaps: '' },
    ai: null,
    legacy: null,
    savedAt: null,
    draftAt: null,
  };
}

// Make sure every collection and nested default exists on a state object.
// Does not change meaning; only fills missing fields.
export function normalize(state) {
  const base = emptyState();
  const s = { ...base, ...(state || {}) };
  s.schemaVersion = SCHEMA_VERSION;
  for (const key of ['papers', 'sessions', 'events', 'notes', 'knowledge']) {
    if (!Array.isArray(s[key])) s[key] = [];
  }
  if (!s.reviews || typeof s.reviews !== 'object') s.reviews = {};
  s.settings = { ...base.settings, ...(s.settings || {}) };
  s.settings.ai = normalizeAI(s.settings.ai);
  if (!['novice', 'peer'].includes(s.settings.readerLevel)) s.settings.readerLevel = 'novice';
  s.settings.autoVocab = !!s.settings.autoVocab;
  s.settings.attachPageImages = !!s.settings.attachPageImages;
  for (const k of s.knowledge) if (!Array.isArray(k.contexts)) k.contexts = [];
  s.layout = { ...base.layout, ...(s.layout || {}) };
  s.current = { ...base.current, ...(s.current || {}) };
  s.papers = s.papers.filter(p => p && typeof p.id === 'string').map(p => newPaper({ ...p, createdAt: p.createdAt || nowISO() }));
  const ids = new Set(s.papers.map(p => p.id));
  s.sessions = s.sessions.filter(x => x && ids.has(x.paperId));
  s.events = s.events.filter(x => x && ids.has(x.paperId)).map(e => newEvent(e));
  s.notes = s.notes.filter(x => x && ids.has(x.paperId)).map(n => newNote(n));
  s.knowledge = s.knowledge.filter(x => x && ids.has(x.paperId)).map(k => migrateKind(newKnowledge(k)));
  for (const id of Object.keys(s.reviews)) {
    if (!ids.has(id)) { delete s.reviews[id]; continue; }
    s.reviews[id] = { ...newReview(id), ...s.reviews[id] };
    s.reviews[id].human = { ...newReview(id).human, ...(s.reviews[id].human || {}) };
  }
  if (s.current.paperId && !ids.has(s.current.paperId)) s.current.paperId = null;
  return s;
}
