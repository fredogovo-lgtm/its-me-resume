// UTF-16 offsets over plain text. These functions never interpret or produce HTML.
const LANGUAGES = ['zh', 'en'];
const FIELDS = ['title', 'subtitle', 'body'];
const STYLE_KEYS = ['fontWeight', 'fontStyle', 'textDecoration', 'color', 'fontSize', 'fontFamily'];
const MAX_RUNS = 1000;
const MAX_TEXT = 200000;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const clone = value => structuredClone(value);
function fail(path, message) { throw new Error(`${path}: ${message}`); }
function object(value, path, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, '必须为普通对象');
  if (Object.getOwnPropertySymbols(value).length || Object.keys(value).some(key => !allowedKeys.includes(key))) fail(path, '包含不支持的字段');
}
function text(value, path) {
  if (typeof value !== 'string' || value.length > MAX_TEXT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) fail(path, '文本类型、长度或控制字符无效');
}
function offset(value, path, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail(path, '文本范围无效');
}
function validateStyle(style, path) {
  object(style, path, STYLE_KEYS);
  const keys = Object.keys(style);
  if (!keys.length) fail(path, '样式不能为空');
  for (const key of keys) {
    const value = style[key];
    if (key === 'fontWeight' && ![400, 700].includes(value)) fail(`${path}.${key}`, '字重无效');
    if (key === 'fontStyle' && !['normal', 'italic'].includes(value)) fail(`${path}.${key}`, '字体样式无效');
    if (key === 'textDecoration' && !['none', 'underline'].includes(value)) fail(`${path}.${key}`, '文字修饰无效');
    if (key === 'color' && (typeof value !== 'string' || !/^#(?:[a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/iu.test(value))) fail(`${path}.${key}`, '颜色格式无效');
    if (key === 'fontSize' && (!Number.isFinite(value) || value < 4 || value > 144)) fail(`${path}.${key}`, '字号超出允许范围');
    if (key === 'fontFamily' && (typeof value !== 'string' || !value || value.length > 160 || /[{};<>\u0000-\u001f]|url\s*\(/iu.test(value))) fail(`${path}.${key}`, '字体名称无效');
  }
}
function validateRuns(runs, maximum, path) {
  if (!Array.isArray(runs) || runs.length > MAX_RUNS) fail(path, '样式列表类型或长度无效');
  let previousEnd = 0;
  for (const [index, run] of runs.entries()) {
    const name = `${path}[${index}]`;
    object(run, name, ['start', 'end', 'style']);
    offset(run.start, `${name}.start`, maximum);
    offset(run.end, `${name}.end`, maximum);
    if (run.start >= run.end || run.start < previousEnd) fail(name, '样式范围必须按顺序排列且不重叠');
    validateStyle(run.style, `${name}.style`);
    previousEnd = run.end;
  }
}
function fieldText(block, language, field) {
  if (!LANGUAGES.includes(language) || !FIELDS.includes(field)) fail('richText', '语言或文本字段无效');
  const result = block?.[language]?.[field];
  text(result, `${language}.${field}`);
  return result;
}
function sameStyle(left, right) { return STYLE_KEYS.every(key => left[key] === right[key]); }
function mergeRuns(runs) {
  const result = [];
  for (const run of runs) {
    if (run.start >= run.end || !Object.keys(run.style).length) continue;
    const previous = result.at(-1);
    if (previous && previous.end === run.start && sameStyle(previous.style, run.style)) previous.end = run.end;
    else result.push({ start: run.start, end: run.end, style: { ...run.style } });
  }
  if (result.length > MAX_RUNS) fail('richText', '局部样式过多，请清除部分样式后重试');
  return result;
}
function boundaries(value) {
  const result = new Set([value.length]);
  for (const part of segmenter.segment(value)) result.add(part.index);
  result.add(0);
  return result;
}
function selection(value, start, end) {
  offset(start, 'selection.start', value.length);
  offset(end, 'selection.end', value.length);
  if (start > end) fail('selection', '文本范围无效');
  if (start === end) return { start, end };
  const edges = boundaries(value);
  while (!edges.has(start)) start--;
  while (!edges.has(end)) end++;
  return { start, end };
}

export function validateRichText(block, path = 'block') {
  if (block.richText === undefined) return true;
  const name = `${path}.richText`;
  object(block.richText, name, LANGUAGES);
  for (const [language, fields] of Object.entries(block.richText)) {
    object(fields, `${name}.${language}`, FIELDS);
    for (const [field, runs] of Object.entries(fields)) {
      const value = fieldText(block, language, field);
      validateRuns(runs, value.length, `${name}.${language}.${field}`);
    }
  }
  return true;
}

export function getTextRuns(block, language, field) {
  fieldText(block, language, field);
  validateRichText(block);
  return clone(block.richText?.[language]?.[field] ?? []);
}

export function applyTextStyle(value, runs, start, end, patch) {
  text(value, 'text');
  validateRuns(runs, value.length, 'richText');
  if (patch !== null) validateStyle(patch, 'richText.patch');
  ({ start, end } = selection(value, start, end));
  if (start === end) return mergeRuns(runs);
  const points = [...new Set([start, end, ...runs.flatMap(run => [run.start, run.end])])].sort((left, right) => left - right);
  const output = [];
  let index = 0;
  for (let cursor = 0; cursor + 1 < points.length; cursor++) {
    const from = points[cursor];
    const to = points[cursor + 1];
    while (index < runs.length && runs[index].end <= from) index++;
    const original = runs[index]?.start <= from && runs[index]?.end >= to ? runs[index].style : {};
    const chosen = from >= start && to <= end;
    const style = chosen ? (patch === null ? {} : { ...original, ...patch }) : original;
    if (Object.keys(style).length) output.push({ start: from, end: to, style });
  }
  return mergeRuns(output);
}

export function rebaseTextRuns(previousText, nextText, runs) {
  text(previousText, 'previousText');
  text(nextText, 'nextText');
  validateRuns(runs, previousText.length, 'richText');
  if (previousText === nextText) return mergeRuns(runs);
  if (!nextText.length || !runs.length) return [];
  let prefix = 0;
  while (prefix < previousText.length && prefix < nextText.length && previousText[prefix] === nextText[prefix]) prefix++;
  const previousEdges = boundaries(previousText);
  const nextEdges = boundaries(nextText);
  while (!previousEdges.has(prefix) || !nextEdges.has(prefix)) prefix--;
  let suffix = 0;
  while (suffix < previousText.length - prefix && suffix < nextText.length - prefix && previousText[previousText.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]) suffix++;
  while (!previousEdges.has(previousText.length - suffix) || !nextEdges.has(nextText.length - suffix)) suffix--;
  const previousEnd = previousText.length - suffix;
  const nextEnd = nextText.length - suffix;
  const delta = nextText.length - previousText.length;
  const before = runs.filter(run => run.start < prefix).map(run => ({ ...run, end: Math.min(run.end, prefix) }));
  const after = runs.filter(run => run.end > previousEnd).map(run => ({ ...run, start: Math.max(run.start, previousEnd) + delta, end: run.end + delta }));
  // A caret at a run boundary inherits its left neighbour, otherwise its right neighbour.
  const inherited = runs.find(run => run.start < prefix && run.end >= prefix) ?? runs.find(run => run.start === prefix);
  const inserted = inherited && nextEnd > prefix ? [{ start: prefix, end: nextEnd, style: inherited.style }] : [];
  return mergeRuns([...before, ...inserted, ...after]);
}

export function sliceTextRuns(runs, start, end) {
  validateRuns(runs, Number.MAX_SAFE_INTEGER, 'richText');
  offset(start, 'slice.start', Number.MAX_SAFE_INTEGER);
  offset(end, 'slice.end', Number.MAX_SAFE_INTEGER);
  if (start > end) fail('slice', '文本范围无效');
  return mergeRuns(runs.filter(run => run.end > start && run.start < end).map(run => ({ start: Math.max(start, run.start) - start, end: Math.min(end, run.end) - start, style: run.style })));
}

export function setBlockText(block, language, field, nextText) {
  const previousText = fieldText(block, language, field);
  text(nextText, `${language}.${field}`);
  const runs = rebaseTextRuns(previousText, nextText, getTextRuns(block, language, field));
  block[language][field] = nextText;
  if (runs.length) {
    block.richText ??= {};
    block.richText[language] ??= {};
    block.richText[language][field] = runs;
  } else if (block.richText?.[language]) {
    delete block.richText[language][field];
    if (!Object.keys(block.richText[language]).length) delete block.richText[language];
    if (!Object.keys(block.richText).length) delete block.richText;
  }
}
