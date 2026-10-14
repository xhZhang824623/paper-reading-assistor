#!/usr/bin/env python3
"""Build the compact offline dictionary (vendor/dict/ecdict-core.json) from ECDICT's ecdict.csv.

ECDICT: https://github.com/skywind3000/ECDICT (MIT). Usage:
    python3 tools/build-dict.py /path/to/ecdict.csv
Keeps words that have a frequency rank (COCA/BNC) or an exam tag, plus their inflected forms.
"""
import csv, json, re, sys
csv.field_size_limit(10 ** 8)
src = sys.argv[1]
out_path = sys.argv[2] if len(sys.argv) > 2 else 'vendor/dict/ecdict-core.json'
words = {}
forms = {}
WORD_RE = re.compile(r"^[A-Za-z][A-Za-z\-']*$")
def num(v):
    try: return int(v)
    except: return 0
with open(src, encoding='utf-8', newline='') as f:
    for row in csv.DictReader(f):
        w = row['word'].strip()
        if not WORD_RE.match(w) or len(w) > 28: continue
        tr = (row.get('translation') or '').strip()
        if not tr: continue
        keep = num(row.get('frq')) > 0 or num(row.get('bnc')) > 0 or bool(row.get('tag')) or bool(row.get('oxford')) or bool(row.get('collins'))
        if not keep: continue
        tr = tr.replace('\\n', '\n')
        # drop the noisy "[网络]" machine-collected lines, keep at most 6 lines
        lines = [l for l in tr.split('\n') if l.strip() and not l.startswith('[网络]')][:6]
        if not lines: continue
        key = w.lower()
        entry = [row.get('phonetic', '').strip(), '\n'.join(lines), (row.get('tag') or '').strip(), num(row.get('frq'))]
        if key not in words or (words[key][3] == 0 and entry[3] > 0):
            words[key] = entry
        for part in (row.get('exchange') or '').split('/'):
            if ':' in part:
                kind, form = part.split(':', 1)
                form = form.strip().lower()
                if form and form != key and WORD_RE.match(form) and kind in ('p', 'd', 'i', '3', 's', 'r', 't'):
                    forms.setdefault(form, key)
# drop forms that are headwords themselves
forms = {k: v for k, v in forms.items() if k not in words}
data = {'source': 'ECDICT (MIT) https://github.com/skywind3000/ECDICT', 'words': {k: v[:3] for k, v in words.items()}, 'forms': forms}
s = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
with open(out_path, 'w', encoding='utf-8') as f: f.write(s)
print('headwords', len(words), 'forms', len(forms), 'bytes', len(s.encode('utf-8')))
