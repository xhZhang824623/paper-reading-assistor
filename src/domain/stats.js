// Activity statistics. Pure module. Dates are computed in the browser's local time zone
// unless a timeZone is given.
export function dayKey(at, timeZone) {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = t => parts.find(p => p.type === t).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}

export function countByDay(events, timeZone) {
  const days = {};
  for (const e of events || []) {
    const k = dayKey(e.at, timeZone);
    if (!k) continue;
    days[k] = (days[k] || 0) + 1;
  }
  return days;
}

function shiftKey(key, days) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Heatmap over the last `weeks` weeks ending in the current week (Monday-first rows).
export function heatmap(days, todayKey, weeks = 26) {
  const todayDow = (new Date(todayKey + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
  const end = shiftKey(todayKey, 6 - todayDow);
  const start = shiftKey(end, -(weeks * 7 - 1));
  const cells = [];
  let active = 0;
  for (let i = 0; i < weeks * 7; i++) {
    const key = shiftKey(start, i);
    const count = days[key] || 0;
    const future = key > todayKey;
    if (count && !future) active++;
    cells.push({ key, count, future, level: count === 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : count < 10 ? 3 : 4 });
  }
  return { cells, start, end, activeDays: active };
}

export function lastNDays(days, todayKey, n = 30) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const key = shiftKey(todayKey, -i);
    out.push({ key, count: days[key] || 0 });
  }
  return out;
}

export function weekSummary(state, todayKey) {
  const weekStart = shiftKey(todayKey, -6);
  const inWeek = iso => { const k = dayKey(iso); return k >= weekStart && k <= todayKey; };
  const sessions = state.sessions.filter(s => inWeek(s.startedAt));
  const papersTouched = new Set(sessions.map(s => s.paperId)).size;
  const finished = state.sessions.filter(s => s.outcome === 'finished' && inWeek(s.endedAt || s.startedAt)).length;
  const knowledge = state.knowledge.filter(k => inWeek(k.createdAt)).length;
  return { sessions: sessions.length, papersTouched, finished, knowledge };
}
