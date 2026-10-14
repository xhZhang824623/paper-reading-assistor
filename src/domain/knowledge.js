// Knowledge model helpers. Pure module.
// Three kinds: concept (term + definition + my understanding, linked to the explanation it came
// from), word (vocabulary with phonetic and dictionary meaning), phrase (academic expression with
// usage and my own example). Each item keeps the sentences, papers and pages it was met in.
export const KIND_LABELS = { concept: '概念', word: '生词', phrase: '表达' };
export const KINDS = ['concept', 'word', 'phrase'];
export const STATUS_LABELS = { new: '未排期', learning: '学习中', known: '已掌握' };

export function isSingleWordTerm(term) {
  return /^[A-Za-z][A-Za-z'’-]*$/.test(String(term || '').trim());
}

// Old items used kind 'english' for everything English; split them by shape.
export function migrateKind(item) {
  if (!item) return item;
  if (item.kind === 'english') item.kind = isSingleWordTerm(item.term) ? 'word' : 'phrase';
  if (!KINDS.includes(item.kind)) item.kind = 'concept';
  if (typeof item.note !== 'string') item.note = '';
  return item;
}

const stripMd = s => String(s || '').replace(/\*\*|__|`/g, '').replace(/^#+\s*/gm, '').replace(/^[-*]\s+/gm, '').replace(/\$([^$]+)\$/g, '$1').trim();

// A one-sentence definition pulled from an explanation: the "一句话" section when present,
// otherwise the first paragraph. Limited to a readable length.
export function extractDefinition(response) {
  const text = String(response || '').replace(/\r\n?/g, '\n');
  const m = /#{1,4}\s*一句话[^\n]*\n+([\s\S]*?)(?=\n#{1,4}\s|\n*$)/.exec(text);
  let para = m ? m[1] : text;
  para = para.split(/\n\s*\n/).map(p => p.trim()).find(p => p && !/^#{1,4}\s/.test(p) && !/^```/.test(p)) || '';
  para = stripMd(para).replace(/\s+/g, ' ');
  if (para.length > 240) para = para.slice(0, 237).replace(/[，,；;、\s]+\S*$/, '') + '…';
  return para;
}

// Glossary entries from a whole-paper summary ("## 术语表" section). Accepts list lines
// ("- **term**：definition", "1. term - definition") and two-column tables.
export function parseGlossary(response) {
  const text = String(response || '').replace(/\r\n?/g, '\n');
  const sec = /#{1,4}\s*术语表[^\n]*\n([\s\S]*?)(?=\n#{1,4}\s|$)/.exec(text);
  const body = sec ? sec[1] : '';
  const out = [];
  const push = (term, meaning) => {
    term = stripMd(term).replace(/^[“"']+|[”"']+$/g, '').trim();
    meaning = stripMd(meaning).trim();
    if (!term || !meaning || term.length > 80) return;
    if (out.some(x => x.term.toLowerCase() === term.toLowerCase())) return;
    out.push({ term, meaning });
  };
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.length < 2 || /^:?-{2,}:?$/.test(cells[0]) || /^(术语|名词|英文|term|词)$/i.test(cells[0])) continue;
      push(cells[0], cells.slice(1).filter(Boolean).join('，'));
      continue;
    }
    const m = /^(?:(?:[-*•]|\d+[.、)])\s+)?(.{1,100}?)\s*(?:[:：]|\s[—–-]\s)\s*(.+)$/.exec(line);
    if (m) push(m[1], m[2]);
  }
  return out;
}

// Suggested concept name for a "存为概念" action on an answer.
export function conceptTerm({ action = 'explain', quote = '', question = '', response = '' } = {}) {
  const q = String(quote || '').replace(/(\p{Ll})-\s+(\p{Ll})/gu, '$1$2').replace(/\s+/g, ' ').trim();
  const bold = (/\*\*([^*\n]{1,60}?)\*\*/.exec(String(response || '')) || [])[1];
  const clean = s => String(s || '').replace(/[\s。.,，;；:：、]+$/, '').trim();
  if (action !== 'ask' && q && q.length <= 60) return clean(q);
  if (bold) return clean(bold);
  if (q && q.length <= 60) return clean(q);
  const qq = String(question || '').trim();
  return qq.length <= 60 ? clean(qq) : '';
}

// "junction tree（联结树）" and "Junction Tree" are the same term.
export function normalizeTerm(term) {
  return String(term || '').toLowerCase().replace(/\s*[（(][^()（）]*[）)]\s*$/, '').replace(/\s+/g, ' ').trim();
}

export function findByTerm(state, term, kinds = KINDS) {
  const t = normalizeTerm(term);
  if (!t) return null;
  return state.knowledge.find(k => kinds.includes(k.kind) && normalizeTerm(k.term) === t) || null;
}

export function reviewPrompt(item) {
  if (item.kind === 'word') return '这个词是什么意思？';
  if (item.kind === 'phrase') return '这个表达什么意思、怎么用？试着造一句';
  return '不看答案，说出它的定义和在论文里的作用';
}
