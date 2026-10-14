// Spaced review scheduling and knowledge item helpers. Pure module.
const DAY = 24 * 60 * 60 * 1000;
export const INTERVALS_DAYS = [1, 3, 7, 14, 30];

export function addDays(iso, days) {
  const d = new Date(iso);
  return new Date(d.getTime() + days * DAY).toISOString();
}

// Called when a user marks an item as needing review for the first time.
export function scheduleFirstReview(item, now = new Date().toISOString()) {
  return { ...item, status: 'learning', reviewCount: 0, nextReviewAt: addDays(now, INTERVALS_DAYS[0]) };
}

// Called after a recall attempt. remembered=true moves to the next interval; false resets.
export function applyRecall(item, remembered, now = new Date().toISOString()) {
  if (!remembered) {
    return { ...item, status: 'learning', reviewCount: 0, lastReviewedAt: now, nextReviewAt: addDays(now, INTERVALS_DAYS[0]) };
  }
  const count = (item.reviewCount || 0) + 1;
  if (count >= INTERVALS_DAYS.length) {
    return { ...item, status: 'known', reviewCount: count, lastReviewedAt: now, nextReviewAt: null };
  }
  return { ...item, status: 'learning', reviewCount: count, lastReviewedAt: now, nextReviewAt: addDays(now, INTERVALS_DAYS[count]) };
}

export function dueItems(items, now = new Date().toISOString()) {
  return (items || []).filter(k => k.status !== 'known' && k.nextReviewAt && k.nextReviewAt <= now)
    .sort((a, b) => a.nextReviewAt.localeCompare(b.nextReviewAt));
}

export function upcomingItems(items, now = new Date().toISOString(), withinDays = 7) {
  const limit = addDays(now, withinDays);
  return (items || []).filter(k => k.status !== 'known' && k.nextReviewAt && k.nextReviewAt > now && k.nextReviewAt <= limit)
    .sort((a, b) => a.nextReviewAt.localeCompare(b.nextReviewAt));
}

// Unresolved questions: events the user marked unclear, plus question notes not resolved.
export function openQuestions(state) {
  const fromEvents = (state.events || []).filter(e => e.feedback === 'unclear').map(e => ({
    id: e.id, kind: 'event', paperId: e.paperId, text: e.question || e.quote || '', at: e.feedbackAt || e.at,
  }));
  const fromNotes = (state.notes || []).filter(n => n.type === 'question' && !n.resolved).map(n => ({
    id: n.id, kind: 'note', paperId: n.paperId, text: n.text || n.quote || '', at: n.at,
  }));
  return [...fromEvents, ...fromNotes].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

// Evidence for one paper's review page.
export function paperEvidence(state, paperId) {
  const events = (state.events || []).filter(e => e.paperId === paperId);
  const notes = (state.notes || []).filter(n => n.paperId === paperId);
  const sessions = (state.sessions || []).filter(s => s.paperId === paperId);
  const knowledge = (state.knowledge || []).filter(k => k.paperId === paperId);
  const aiEvents = events.filter(e => ['translate', 'explain', 'summarize', 'ask'].includes(e.action));
  return {
    events, notes, sessions, knowledge, aiEvents,
    unclear: aiEvents.filter(e => e.feedback === 'unclear'),
    understood: aiEvents.filter(e => e.feedback === 'understood'),
    toReview: aiEvents.filter(e => e.feedback === 'review'),
    highlights: notes.filter(n => n.type === 'highlight'),
    comments: notes.filter(n => n.type === 'comment'),
    questions: notes.filter(n => n.type === 'question'),
  };
}

export function sessionDurationMs(session) {
  if (!session || !session.startedAt) return 0;
  const end = session.endedAt || session.lastActiveAt || session.startedAt;
  return Math.max(0, new Date(end).getTime() - new Date(session.startedAt).getTime());
}

export function formatDuration(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return '不到 1 分钟';
  if (m < 60) return m + ' 分钟';
  const h = Math.floor(m / 60);
  return h + ' 小时 ' + (m % 60) + ' 分钟';
}
