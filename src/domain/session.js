// Reading sessions. Pure functions over state.
import { newSession } from '../state/schema.js';

export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;

export function closeStaleSessions(state, now = new Date().toISOString()) {
  const limit = new Date(now).getTime() - SESSION_IDLE_MS;
  let changed = 0;
  for (const s of state.sessions) {
    if (s.endedAt) continue;
    const last = new Date(s.lastActiveAt || s.startedAt).getTime();
    if (last < limit) { s.endedAt = s.lastActiveAt || s.startedAt; s.outcome = s.outcome || 'partial'; changed++; }
  }
  return changed;
}

export function activeSession(state, paperId, now = new Date().toISOString()) {
  const limit = new Date(now).getTime() - SESSION_IDLE_MS;
  return state.sessions.find(s => s.paperId === paperId && !s.endedAt && new Date(s.lastActiveAt || s.startedAt).getTime() >= limit) || null;
}

export function ensureSession(state, paperId, now = new Date().toISOString()) {
  let s = activeSession(state, paperId, now);
  if (s) { s.lastActiveAt = now; return s; }
  s = newSession(paperId);
  s.startedAt = now; s.lastActiveAt = now;
  state.sessions.push(s);
  return s;
}

export function touchSession(state, paperId, now = new Date().toISOString()) {
  const s = activeSession(state, paperId, now);
  if (s) s.lastActiveAt = now;
  return s;
}

export function endSession(state, paperId, outcome, now = new Date().toISOString()) {
  const s = state.sessions.find(x => x.paperId === paperId && !x.endedAt);
  if (!s) return null;
  s.endedAt = now; s.lastActiveAt = now; s.outcome = outcome;
  return s;
}

export function lastSession(state, paperId) {
  return state.sessions.filter(s => s.paperId === paperId).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] || null;
}
