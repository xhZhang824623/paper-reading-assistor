// Anchors for pasted text and PDF pages. Pure module.

export function normalizeWS(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// Split pasted text into paragraphs and compute each paragraph's offset in the flat text.
export function paragraphize(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n');
  const out = [];
  const re = /\n\s*\n/g;
  let last = 0, m;
  while ((m = re.exec(src))) {
    pushPara(src, last, m.index, out);
    last = m.index + m[0].length;
  }
  pushPara(src, last, src.length, out);
  return { text: src, paragraphs: out };
}

function pushPara(src, start, end, out) {
  // trim leading/trailing whitespace but keep offsets exact
  let s = start, e = end;
  while (s < e && /\s/.test(src[s])) s++;
  while (e > s && /\s/.test(src[e - 1])) e--;
  if (e > s) out.push({ start: s, end: e, text: src.slice(s, e) });
}

// Find a quote in text. Prefer an occurrence whose surrounding context matches prefix/suffix.
// Returns {start, end, confidence} or null.
export function locateQuote(text, quote, prefix = '', suffix = '') {
  const src = String(text || '');
  const q = String(quote || '');
  if (!q) return null;
  const candidates = [];
  let i = src.indexOf(q);
  while (i !== -1) { candidates.push(i); i = src.indexOf(q, i + 1); }
  if (candidates.length === 1) return { start: candidates[0], end: candidates[0] + q.length, confidence: 1 };
  if (candidates.length > 1) {
    let best = candidates[0], bestScore = -1;
    for (const c of candidates) {
      const before = src.slice(Math.max(0, c - prefix.length), c);
      const after = src.slice(c + q.length, c + q.length + suffix.length);
      const score = (prefix && before === prefix ? 2 : 0) + (suffix && after === suffix ? 2 : 0);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return { start: best, end: best + q.length, confidence: bestScore > 0 ? 0.9 : 0.5 };
  }
  // Whitespace-insensitive fallback.
  const nq = normalizeWS(q);
  if (!nq) return null;
  const map = [];
  let norm = '';
  let prevSpace = true;
  for (let k = 0; k < src.length; k++) {
    const ch = src[k];
    if (/\s/.test(ch)) { if (!prevSpace) { norm += ' '; map.push(k); } prevSpace = true; }
    else { norm += ch; map.push(k); prevSpace = false; }
  }
  const j = norm.indexOf(nq);
  if (j === -1) return null;
  return { start: map[j], end: map[j + nq.length - 1] + 1, confidence: 0.7 };
}

export function makeTextAnchor(text, start, end, context = 40) {
  const src = String(text || '');
  return {
    kind: 'text',
    quote: src.slice(start, end),
    prefix: src.slice(Math.max(0, start - context), start),
    suffix: src.slice(end, end + context),
    start, end,
  };
}

// Resolve a text anchor against the current text. Uses stored offsets when they still match,
// otherwise relocates by quote and context.
export function resolveTextAnchor(text, anchor) {
  if (!anchor || anchor.kind !== 'text') return null;
  const src = String(text || '');
  if (Number.isInteger(anchor.start) && Number.isInteger(anchor.end) && src.slice(anchor.start, anchor.end) === anchor.quote) {
    return { start: anchor.start, end: anchor.end, confidence: 1 };
  }
  return locateQuote(src, anchor.quote, anchor.prefix, anchor.suffix);
}

// Split a paragraph's text into segments according to marks (ranges relative to the paragraph).
// marks: [{start, end, id, kind}] ; returns [{text, marks: [ {id, kind} ]}]
export function segmentText(text, marks) {
  const src = String(text || '');
  const points = new Set([0, src.length]);
  const valid = (marks || []).filter(m => m && m.end > m.start).map(m => ({ ...m, start: Math.max(0, m.start), end: Math.min(src.length, m.end) })).filter(m => m.end > m.start);
  for (const m of valid) { points.add(m.start); points.add(m.end); }
  const sorted = [...points].sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (b <= a) continue;
    const covering = valid.filter(m => m.start <= a && m.end >= b).map(m => ({ id: m.id, kind: m.kind, color: m.color }));
    segs.push({ text: src.slice(a, b), marks: covering });
  }
  return segs;
}

// Project flat-text marks onto a paragraph range.
export function marksForParagraph(para, marks) {
  return (marks || [])
    .filter(m => m.end > para.start && m.start < para.end)
    .map(m => ({ ...m, start: Math.max(m.start, para.start) - para.start, end: Math.min(m.end, para.end) - para.start }));
}

export function makePdfAnchor({ page, quote, pageText = '', rects = [] }) {
  const loc = locateQuote(pageText, quote);
  const context = 40;
  return {
    kind: 'pdf',
    page,
    quote,
    prefix: loc ? pageText.slice(Math.max(0, loc.start - context), loc.start) : '',
    suffix: loc ? pageText.slice(loc.end, loc.end + context) : '',
    rects: rects.map(r => ({ x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) })),
  };
}

const round = n => Math.round(n * 10000) / 10000;

export function anchorLabel(anchor) {
  if (!anchor) return '未定位';
  if (anchor.kind === 'pdf') return '第 ' + anchor.page + ' 页';
  if (anchor.kind === 'text') {
    if (Number.isInteger(anchor.paragraph)) return '文本第 ' + (anchor.paragraph + 1) + ' 段';
    if (anchor.legacyLabel) return anchor.legacyLabel;
    return '文本片段';
  }
  return '未定位';
}

// PDF text layers break words at line ends ("deter- ministic"); join them for display and prompts.
export function dehyphenate(text) {
  return String(text || '').replace(/(\p{Ll})-\s+(\p{Ll})/gu, '$1$2');
}
