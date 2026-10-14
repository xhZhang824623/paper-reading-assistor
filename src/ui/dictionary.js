// Offline English-Chinese dictionary (ECDICT subset, vendor/dict). Loaded once on first lookup.
const URL_JSON = new URL('../../vendor/dict/ecdict-core.json', import.meta.url).href;
let loading = null;

export const TAG_LABELS = { zk: '中考', gk: '高考', cet4: '四级', cet6: '六级', ky: '考研', toefl: '托福', ielts: '雅思', gre: 'GRE' };

export function loadDict() {
  if (!loading) loading = fetch(URL_JSON).then(r => { if (!r.ok) throw new Error('词典加载失败 ' + r.status); return r.json(); });
  return loading;
}

// True when a selection looks like one word (or a hyphenated word) worth a dictionary lookup.
export function isSingleWord(text) {
  const t = String(text || '').trim();
  return /^[A-Za-z][A-Za-z'’-]{0,30}$/.test(t);
}

function candidates(w, forms) {
  const list = [w];
  if (forms[w]) list.push(forms[w]);
  if (w.endsWith("'s")) list.push(w.slice(0, -2));
  for (const suf of ['ies', 'es', 's', 'ied', 'ed', 'ing', 'ly', 'er', 'est', 'ness', 'ally']) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) {
      const base = w.slice(0, -suf.length);
      list.push(base, base + 'e', base.replace(/(.)\1$/, '$1'), suf === 'ies' || suf === 'ied' ? base + 'y' : base, suf === 'ally' ? base + 'al' : base);
      if (forms[base]) list.push(forms[base]);
    }
  }
  return list;
}

export async function lookupWord(raw) {
  const dict = await loadDict();
  const w = String(raw || '').trim().toLowerCase().replace(/’/g, "'").replace(/^[^a-z]+|[^a-z']+$/g, '');
  if (!w) return null;
  for (const key of candidates(w, dict.forms)) {
    const e = dict.words[key];
    if (e) return { word: key, input: raw.trim(), phonetic: e[0] || '', translation: e[1] || '', tags: (e[2] || '').split(/\s+/).filter(Boolean).map(t => TAG_LABELS[t] || t) };
  }
  return null;
}
