// Turn PDF text lines into paragraphs. Pure. With line geometry (x, y = top, w, h in page points)
// it uses indents, vertical gaps and font size; without it, text heuristics only.
const SECTION = /^(\d+(\.\d+)*\.?|[IVX]+\.|[A-Z]\.)\s+[A-Z一-鿿]/;
const ENDS_SENTENCE = /[.?!。？！]["”')\]]*$/;
const HEADING_WORDS = /^(abstract|introduction|references|acknowledg\w*|appendix|conclusions?|related work|methods?|results|discussion|experiments?|background|preliminaries)\b/i;

function looksLikeHeading(t) {
  if (t.length > 80 || ENDS_SENTENCE.test(t) || /[,;:，；：]$/.test(t)) return false;
  if (HEADING_WORDS.test(t)) return t.split(/\s+/).length <= 6;
  if (SECTION.test(t)) return t.split(/\s+/).length <= 12;
  return false;
}

const median = arr => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };

// lines: [{ text, x?, y?, w?, h?, brk? }]. Returns [{ text, lines, heading? }].
export function reflowLines(lines, { geometry = true } = {}) {
  const items = (lines || []).map(l => ({ ...l, text: String(l.text || '').replace(/\s+/g, ' ').trim() })).filter(l => l.text && !/^\d{1,3}$/.test(l.text));
  const geo = geometry && items.length > 0 && items.every(l => typeof l.y === 'number' && typeof l.h === 'number' && typeof l.x === 'number');
  const lens = items.map(l => l.text.length);
  const body = lens.filter(n => n >= 25);
  const medianLen = median(body.length >= 3 ? body : lens) || 80;
  const bodyH = geo ? items.filter(l => l.text.length >= 25).map(l => l.h) : [];
  const medianH = geo ? (median(bodyH.length >= 3 ? bodyH : items.map(l => l.h)) || 10) : 0;
  const out = [];
  let cur = null;
  const flush = () => { if (cur && cur.text) out.push(cur); cur = null; };
  const start = (l, heading = false) => { cur = { text: l.text, lines: [l], heading }; };
  const append = l => {
    if (/\p{Ll}-$/u.test(cur.text) && /^\p{Ll}/u.test(l.text)) cur.text = cur.text.slice(0, -1) + l.text;
    else cur.text += ' ' + l.text;
    cur.lines.push(l);
  };
  for (const l of items) {
    const prev = cur ? cur.lines[cur.lines.length - 1] : null;
    const bigFont = geo && l.h > medianH * 1.15 && l.text.length < 90;
    const heading = bigFont || looksLikeHeading(l.text);
    if (heading) {
      // consecutive lines of one multi-line title stay together
      if (cur && cur.heading && prev && (!geo || (Math.abs(l.h - prev.h) < 0.6 && l.y - (prev.y + prev.h) < medianH))) { append(l); continue; }
      flush(); start(l, true); continue;
    }
    if (!cur) { start(l); continue; }
    let brk = !!l.brk || cur.heading;
    if (!brk && geo) {
      const sameColumn = Math.abs(l.x - prev.x) < medianH * 6;
      const gap = l.y - (prev.y + prev.h);
      const indent = l.x - prev.x;
      if (sameColumn && gap > medianH * 0.6) brk = true;
      else if (sameColumn && indent > medianH * 0.7) brk = true;
      else if (!sameColumn && prev.text.length < medianLen * 0.85 && ENDS_SENTENCE.test(prev.text)) brk = true;
    } else if (!brk) {
      if (prev.text.length < medianLen * 0.85 && ENDS_SENTENCE.test(prev.text)) brk = true;
    }
    if (brk) { flush(); start(l); } else append(l);
  }
  flush();
  // Geometry that produced almost no breaks (no indents, no spacing) falls back to text rules.
  if (geo && items.length > 20 && out.length < 3) return reflowLines(lines, { geometry: false });
  return out;
}

export function reflowPage(raw) {
  const lines = [];
  let brk = false;
  for (const t of String(raw || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!t.trim()) { brk = true; continue; }
    lines.push({ text: t, brk }); brk = false;
  }
  return reflowLines(lines).map(p => p.text);
}

// Compose a text document from page texts: a page marker line, then the page's paragraphs.
export function composePages(pages) {
  const parts = [];
  pages.forEach((text, i) => {
    const paras = reflowPage(text);
    if (!paras.length) return;
    parts.push(`[第 ${i + 1} 页]`);
    parts.push(...paras);
  });
  return parts.join('\n\n');
}

export const isPageMarker = t => /^\[第 \d+ 页\]$/.test(String(t || '').trim());
