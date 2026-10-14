import test from 'node:test';
import assert from 'node:assert/strict';
import { paragraphize, locateQuote, segmentText, marksForParagraph, makeTextAnchor, resolveTextAnchor, makePdfAnchor } from '../src/domain/anchors.js';

const text = 'Alpha beta gamma.\n\nBeta again here. Beta twice.\n\n  Third para.  ';

test('paragraphize keeps exact offsets', () => {
  const { paragraphs } = paragraphize(text);
  assert.equal(paragraphs.length, 3);
  assert.equal(text.slice(paragraphs[1].start, paragraphs[1].end), 'Beta again here. Beta twice.');
  assert.equal(paragraphs[2].text, 'Third para.');
});

test('locateQuote disambiguates repeated words with context', () => {
  const second = text.indexOf('Beta twice');
  const loc = locateQuote(text, 'Beta', 'here. ', ' twice');
  assert.equal(loc.start, second);
  assert.equal(loc.confidence, 0.9);
  const single = locateQuote(text, 'gamma');
  assert.equal(single.confidence, 1);
  assert.equal(locateQuote(text, 'missing'), null);
});

test('locateQuote falls back to whitespace-insensitive matching', () => {
  const loc = locateQuote('one   two\nthree', 'two three');
  assert.ok(loc);
  assert.equal('one   two\nthree'.slice(loc.start, loc.end), 'two\nthree');
});

test('segmentText splits overlapping marks', () => {
  const segs = segmentText('abcdefgh', [{ id: 'm1', kind: 'highlight', start: 1, end: 5 }, { id: 'm2', kind: 'comment', start: 3, end: 7 }]);
  assert.deepEqual(segs.map(s => s.text), ['a', 'bc', 'de', 'fg', 'h']);
  assert.deepEqual(segs[2].marks.map(m => m.id), ['m1', 'm2']);
  assert.deepEqual(segs[0].marks, []);
});

test('marks project onto paragraphs and anchors relocate after edits', () => {
  const { paragraphs } = paragraphize(text);
  const a = makeTextAnchor(text, text.indexOf('again'), text.indexOf('again') + 5);
  assert.equal(a.quote, 'again');
  const projected = marksForParagraph(paragraphs[1], [{ ...a, id: 'x', kind: 'highlight' }]);
  assert.equal(projected.length, 1);
  assert.equal(paragraphs[1].text.slice(projected[0].start, projected[0].end), 'again');
  const edited = 'New intro.\n\n' + text;
  const r = resolveTextAnchor(edited, a);
  assert.equal(edited.slice(r.start, r.end), 'again');
  assert.equal(resolveTextAnchor(text, a).confidence, 1);
});

test('pdf anchors round rects and capture context', () => {
  const a = makePdfAnchor({ page: 3, quote: 'gamma', pageText: text, rects: [{ x: 0.123456, y: 0.5, w: 0.2, h: 0.01 }] });
  assert.equal(a.page, 3);
  assert.equal(a.rects[0].x, 0.1235);
  assert.ok(a.prefix.endsWith('beta '));
});
