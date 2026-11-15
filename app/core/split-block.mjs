import { getTextRuns, sliceTextRuns } from './rich-text.mjs';
const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
const boundaries = text => [0, ...Array.from(segmenter.segment(text), item => item.index + item.segment.length)];

// The fitting predicate uses the exact preview renderer, with no estimates by character count.
export async function findFittingTextRanges(text, fits, { maxParts = 50 } = {}) {
  if (typeof text !== 'string' || typeof fits !== 'function' || !Number.isInteger(maxParts) || maxParts < 1 || maxParts > 50) throw new Error('分页参数无效。');
  const edges = boundaries(text), ranges = [];
  let from = 0;
  if (!text.length) {
    if (!await fits('', { index: 0, start: 0, end: 0, isFirst: true })) throw new Error('当前页面无法容纳标题，请调整字号或位置。');
    return [{ start: 0, end: 0 }];
  }
  while (from < edges.length - 1) {
    if (ranges.length >= maxParts) throw new Error('拆分最多支持50段，已达本次拆分上限。请调整字号、宽度或缩短正文。');
    const start = edges[from], index = ranges.length;
    const check = to => fits(text.slice(start, edges[to]), { index, start, end: edges[to], isFirst: index === 0 });
    let low = from + 1, high = edges.length - 1, best = from;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (await check(mid)) { best = mid; low = mid + 1; }
      else high = mid - 1;
    }
    if (best === from) throw new Error('当前页面连一个完整字素也无法容纳。请增大文本框宽度、减小字号或调整位置。');
    let to = best;
    if (best < edges.length - 1) {
      const min = from + Math.ceil((best - from) * .6);
      // Prefer a paragraph boundary, then a natural word/sentence boundary.
      for (const pattern of [/\n$/u, /[\s。！？；.!?;]$/u]) {
        let found = false;
        for (let candidate = best; candidate >= min; candidate--) {
          if (pattern.test(text.slice(edges[candidate - 1], edges[candidate]))) { to = candidate; found = true; break; }
        }
        if (found) break;
      }
    }
    ranges.push({ start, end: edges[to] });
    from = to;
  }
  return ranges;
}

export function splitBlock(block, language, ranges, { idFactory = () => crypto.randomUUID() } = {}) {
  if (!['zh', 'en'].includes(language) || !block?.[language] || ['shape', 'line'].includes(block.kind)) throw new Error('请选择文字模块。');
  const text = block[language].body, validEdges = new Set(boundaries(text));
  if (!Array.isArray(ranges) || ranges.length < 1 || ranges.length > 50) throw new Error('拆分范围无效。');
  let previous = 0;
  for (const { start, end } of ranges) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start !== previous || end < start || (text.length && end === start) || !validEdges.has(start) || !validEdges.has(end)) throw new Error('拆分范围必须连续且保持完整字素。');
    previous = end;
  }
  if (previous !== text.length) throw new Error('拆分范围没有覆盖全部正文。');
  const other = language === 'zh' ? 'en' : 'zh', ids = new Set([block.id]);
  return ranges.map(({ start, end }, index) => {
    const part = structuredClone(block);
    if (index) {
      part.id = idFactory();
      if (typeof part.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(part.id) || ids.has(part.id)) throw new Error('续框标识无效或重复。');
      ids.add(part.id);
      part.continuation = { sourceBlockId: block.id, index };
      part[other] = { title: '', subtitle: '', body: '' };
      if (part.richText) delete part.richText[other];
    }
    part[language].body = text.slice(start, end);
    const runs = sliceTextRuns(getTextRuns(block, language, 'body'), start, end);
    if (part.richText?.[language]?.body || runs.length) {
      part.richText ||= {}; part.richText[language] ||= {};
      if (runs.length) part.richText[language].body = runs;
      else delete part.richText[language].body;
    }
    const hidden = new Set((part.hiddenLanguages || []).filter(item => item !== language));
    if (index) hidden.add(other);
    if (hidden.size) part.hiddenLanguages = [...hidden];
    else delete part.hiddenLanguages;
    part.fixedHeight = false;
    return part;
  });
}
