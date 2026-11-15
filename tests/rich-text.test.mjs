import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, emptyLibrary, makeBlock, validateLibrary, validateProject } from '../app/core/model.mjs';
const rich = await import('../app/core/rich-text.mjs').catch(() => ({}));
const api = name => { assert.equal(typeof rich[name], 'function', `${name} must be exported`); return rich[name]; };
const block = () => ({ zh: { title: '标题', subtitle: '', body: 'abcdef' }, en: { title: 'Title', subtitle: '', body: 'English' } });
const run = (start, end, style) => ({ start, end, style });
const bold = { fontWeight: 700 };
const color = { color: '#ff0000' };
const entry = () => ({ id: 'entry', category: 'work', period: '', tags: [], ...block(), stale: { zh: false, en: false } });

test('legacy entries remain valid and rich text survives copying without sharing styles', () => {
  const library = emptyLibrary();
  library.entries.push(entry());
  assert.equal(validateLibrary(library), true);
  library.entries[0].richText = { zh: { body: [run(0, 3, bold)] } };
  const copied = makeBlock(library.entries[0]);
  copied.richText.zh.body[0].style.fontWeight = 400;
  assert.equal(library.entries[0].richText.zh.body[0].style.fontWeight, 700);
  library.entries[0].richText.zh.body[0].end = 99;
  assert.throws(() => validateLibrary(library), /richText/);
});

test('rich-text validation accepts supported local styles independently per language and field', () => {
  const value = block();
  value.richText = { zh: { body: [run(0, 2, { fontWeight: 400, fontStyle: 'italic', textDecoration: 'underline', color: '#abc', fontSize: 12.5, fontFamily: 'Segoe UI, Microsoft YaHei' }), run(2, 6, bold)] }, en: { title: [run(0, 5, { color: '#12345678' })] } };
  assert.equal(api('validateRichText')(value), true);
  assert.equal(api('validateRichText')(block()), true);
});

test('rich-text validation rejects crossed text bounds, overlap, unsorted runs and excessive runs', () => {
  const invalid = [
    [run(-1, 2, bold)], [run(0, 7, bold)], [run(1, 1, bold)], [run(0.5, 2, bold)],
    [run(0, 4, bold), run(3, 5, color)], [run(3, 4, bold), run(0, 2, color)],
    [run(0, Infinity, bold)], Array.from({ length: 1001 }, (_, i) => run(i, i + 1, bold))
  ];
  for (const body of invalid) assert.throws(() => api('validateRichText')({ ...block(), richText: { zh: { body } } }), /richText/);
});

test('rich-text validation rejects malformed containers and forbidden CSS or object keys', () => {
  const invalid = [null, [], { fr: {} }, { zh: { html: [] } }, { zh: { body: null } },
    { zh: { body: [{ start: 0, end: 1, style: bold, html: '<b>' }] } },
    { zh: { body: [run(0, 1, {})] } },
    ...[{ fontWeight: 500 }, { fontStyle: 'oblique' }, { textDecoration: 'line-through' }, { color: 'red' }, { color: 'url(x)' }, { fontSize: NaN }, { fontSize: 3 }, { fontSize: 145 }, { fontFamily: 'Arial; color:red' }, { fontFamily: 'url(x)' }, { fontFamily: '' }, { fontFamily: 'a\nb' }, { onclick: 'x' }].map(style => ({ zh: { body: [run(0, 1, style)] } })),
    JSON.parse('{"zh":{"body":[{"start":0,"end":1,"style":{"__proto__":"x"}}]}}')
  ];
  for (const richText of invalid) assert.throws(() => api('validateRichText')({ ...block(), richText }), /richText/);
});

test('getTextRuns returns detached local runs and empty arrays for unstyled fields', () => {
  const value = { ...block(), richText: { zh: { body: [run(0, 3, bold)] } } };
  const actual = api('getTextRuns')(value, 'zh', 'body');
  assert.deepEqual(actual, [run(0, 3, bold)]);
  actual[0].style.fontWeight = 400;
  assert.equal(value.richText.zh.body[0].style.fontWeight, 700);
  assert.deepEqual(rich.getTextRuns(value, 'en', 'body'), []);
  assert.throws(() => rich.getTextRuns(value, 'fr', 'body'));
  assert.throws(() => rich.getTextRuns(value, 'zh', 'html'));
});

test('applyTextStyle splits existing runs and overlays only selected properties', () => {
  const source = [run(0, 4, bold)];
  const result = api('applyTextStyle')('abcdef', source, 2, 6, color);
  assert.deepEqual(result, [run(0, 2, bold), run(2, 4, { fontWeight: 700, color: '#ff0000' }), run(4, 6, color)]);
  assert.deepEqual(source, [run(0, 4, bold)]);
});

test('applyTextStyle clears only selected styles and merges adjacent equal styles', () => {
  assert.deepEqual(api('applyTextStyle')('abcdef', [run(0, 6, bold)], 2, 4, null), [run(0, 2, bold), run(4, 6, bold)]);
  assert.deepEqual(rich.applyTextStyle('abcdef', [run(0, 2, bold), run(4, 6, bold)], 2, 4, bold), [run(0, 6, bold)]);
  assert.deepEqual(rich.applyTextStyle('abcdef', [run(0, 2, { color: '#f00', fontWeight: 700 })], 2, 4, { fontWeight: 700, color: '#f00' }), [run(0, 4, { color: '#f00', fontWeight: 700 })]);
  assert.deepEqual(rich.applyTextStyle('abcdef', [run(0, 2, bold)], 3, 3, color), [run(0, 2, bold)]);
});

test('applyTextStyle expands UTF16 selection to full emoji and combining graphemes', () => {
  const text = 'A👩‍💻e\u0301Z';
  assert.deepEqual(api('applyTextStyle')(text, [], 2, 3, bold), [run(1, 6, bold)]);
  assert.deepEqual(rich.applyTextStyle(text, [], 7, 8, color), [run(6, 8, color)]);
  assert.throws(() => rich.applyTextStyle(text, [], -1, 2, bold));
  assert.throws(() => rich.applyTextStyle(text, [], 1, 99, bold));
  assert.throws(() => rich.applyTextStyle(text, [], 1, 2, { background: 'url(x)' }));
});

test('rebaseTextRuns keeps unchanged prefix and suffix while inserted text inherits adjacent style', () => {
  assert.deepEqual(api('rebaseTextRuns')('abcdef', 'abXYcdef', [run(0, 4, bold), run(4, 6, color)]), [run(0, 6, bold), run(6, 8, color)]);
  assert.deepEqual(rich.rebaseTextRuns('abcdef', 'abf', [run(0, 3, bold), run(4, 6, color)]), [run(0, 2, bold), run(2, 3, color)]);
  assert.deepEqual(rich.rebaseTextRuns('abc', 'Xabc', [run(0, 3, bold)]), [run(0, 4, bold)]);
  assert.deepEqual(rich.rebaseTextRuns('abc', 'abcX', [run(0, 3, bold)]), [run(0, 4, bold)]);
  assert.deepEqual(rich.rebaseTextRuns('abcdef', 'abXYcdef', [run(4, 6, color)]), [run(6, 8, color)]);
});

test('rebaseTextRuns replaces content using the starting style and leaves unstyled replacements unstyled', () => {
  assert.deepEqual(api('rebaseTextRuns')('abcdef', 'abXYef', [run(1, 4, bold), run(4, 6, color)]), [run(1, 4, bold), run(4, 6, color)]);
  assert.deepEqual(rich.rebaseTextRuns('abcdef', 'XY', [run(2, 4, bold)]), []);
  assert.deepEqual(rich.rebaseTextRuns('abcdef', '', [run(0, 6, bold)]), []);
  assert.deepEqual(rich.rebaseTextRuns('abcdef', 'abcdef', [run(0, 6, bold)]), [run(0, 6, bold)]);
});

test('rebaseTextRuns never slices an emoji into separate surrogate code units', () => {
  assert.deepEqual(api('rebaseTextRuns')('A😀B', 'A😃B', [run(1, 3, bold), run(3, 4, color)]), [run(1, 3, bold), run(3, 4, color)]);
});

test('sliceTextRuns clips selected ranges and repositions them for continuation text', () => {
  const source = [run(0, 3, bold), run(4, 6, color)];
  assert.deepEqual(api('sliceTextRuns')(source, 2, 5), [run(0, 1, bold), run(2, 3, color)]);
  assert.deepEqual(rich.sliceTextRuns(source, 2, 2), []);
  assert.deepEqual(source, [run(0, 3, bold), run(4, 6, color)]);
  assert.throws(() => rich.sliceTextRuns(source, 3, 2));
});

test('setBlockText keeps styles aligned without affecting other language or field', () => {
  const value = { ...block(), richText: { zh: { body: [run(0, 3, bold)] }, en: { title: [run(0, 5, color)] } } };
  api('setBlockText')(value, 'zh', 'body', 'aXYbcdef');
  assert.equal(value.zh.body, 'aXYbcdef');
  assert.deepEqual(value.richText.zh.body, [run(0, 5, bold)]);
  assert.deepEqual(value.richText.en.title, [run(0, 5, color)]);
  assert.equal(value.zh.title, '标题');
  rich.setBlockText(value, 'zh', 'body', '');
  assert.deepEqual(value.richText.en.title, [run(0, 5, color)]);
  assert.deepEqual(rich.getTextRuns(value, 'zh', 'body'), []);
});

test('setBlockText leaves old unstyled content free of unnecessary richText metadata', () => {
  const value = block();
  api('setBlockText')(value, 'en', 'body', 'New plain text');
  assert.equal(value.en.body, 'New plain text');
  assert.equal(value.richText, undefined);
  assert.throws(() => rich.setBlockText(value, 'zh', 'body', null));
});

test('project validates bilingual visibility and continuation provenance without requiring original block', () => {
  const project = createProject(emptyLibrary());
  project.blocks[0].hiddenLanguages = ['en'];
  project.blocks[0].continuation = { sourceBlockId: 'deleted-source', index: 1 };
  assert.equal(validateProject(project), true);
  for (const bad of [ ['en', 'en'], ['fr'], 'en', ['zh', 'en', 'zh'] ]) {
    const copy = structuredClone(project); copy.blocks[0].hiddenLanguages = bad;
    assert.throws(() => validateProject(copy), /hiddenLanguages/);
  }
  for (const bad of [null, { sourceBlockId: '../x', index: 1 }, { sourceBlockId: 'ok', index: 0 }, { sourceBlockId: 'ok', index: 51 }, { sourceBlockId: 'ok', index: 1.5 }]) {
    const copy = structuredClone(project); copy.blocks[0].continuation = bad;
    assert.throws(() => validateProject(copy), /continuation/);
  }
});

test('local style input rejects sparse arrays and non-JSON style values before editing content', () => {
  assert.throws(() => api('validateRichText')({ ...block(), richText: { zh: { body: new Array(1) } } }), /richText/);
  assert.throws(() => rich.applyTextStyle('abc', [], 0, 2, { fontWeight: undefined }));
  assert.throws(() => rich.applyTextStyle('abc', [], 0, 2, { color: '#f00', [Symbol('x')]: true }));
  const value = { ...block(), richText: { zh: { body: [run(0, 3, bold)] } } };
  const before = structuredClone(value);
  assert.throws(() => rich.setBlockText(value, 'zh', 'body', '\u0000'));
  assert.deepEqual(value, before);
});
