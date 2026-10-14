// Persistence and change notification. The only module that touches localStorage.
import { emptyState, normalize, SCHEMA_VERSION, newPaper } from './schema.js';
import { migrate, isV1State } from './migrate.js';
import { demoPaper } from '../data/demo-paper.js';

export const KEY_V2 = 'paper-reading-v2';
export const KEY_V1 = 'paper-reading-v1';

const listeners = new Set();

export const store = {
  state: emptyState(),
  lastSaveError: null,
  loadInfo: { source: 'fresh', migratedFromV1: false, corrupt: false },

  load() {
    let raw = null, source = 'fresh', migratedFromV1 = false, corrupt = false;
    try {
      const v2 = localStorage.getItem(KEY_V2);
      if (v2) { raw = JSON.parse(v2); source = 'v2'; }
    } catch (err) {
      corrupt = true;
      try { localStorage.setItem(KEY_V2 + '.corrupt-' + Date.now(), localStorage.getItem(KEY_V2) || ''); } catch {}
    }
    if (!raw) {
      try {
        const v1 = localStorage.getItem(KEY_V1);
        if (v1) { const parsed = JSON.parse(v1); if (isV1State(parsed)) { raw = parsed; source = 'v1'; migratedFromV1 = true; } }
      } catch {}
    }
    let state = null;
    try { state = raw ? migrate(raw) : null; } catch (err) { corrupt = true; state = null; }
    if (!state) state = emptyState();
    if (!state.papers.length && !state.settings.demoDismissed) state.papers.push(newPaper(demoPaper()));
    this.state = normalize(state);
    // A page closed mid-stream leaves events in 'streaming'; surface them as interrupted.
    for (const e of this.state.events) if (e.status === 'streaming') { e.status = 'error'; e.error = e.error || '上次生成被中断'; }
    this.loadInfo = { source, migratedFromV1, corrupt };
    if (source !== 'v2') this.save();
    return this.state;
  },

  // Returns {ok, error}. Never throws. Callers that show "saved" must check ok.
  save() {
    try {
      localStorage.setItem(KEY_V2, JSON.stringify(this.state));
      this.lastSaveError = null;
      this.notify('save');
      return { ok: true };
    } catch (err) {
      this.lastSaveError = err;
      this.notify('save-failed', err);
      return { ok: false, error: err };
    }
  },

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  notify(type, detail) { for (const fn of listeners) { try { fn(type, detail); } catch (err) { console.error(err); } } },

  replace(next) { this.state = normalize(next); return this.save(); },
};

export function paperById(id) { return store.state.papers.find(p => p.id === id) || null; }
export function reviewFor(paperId) {
  const r = store.state.reviews[paperId];
  if (r) return r;
  const fresh = { paperId, human: { summary: '', takeaways: '', gaps: '' }, ai: null, legacy: null, savedAt: null, draftAt: null };
  store.state.reviews[paperId] = fresh;
  return fresh;
}
