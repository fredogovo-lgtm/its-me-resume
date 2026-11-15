import { appendRichText } from './rich-text-view.mjs';
import { linkRanges, safeLinkTarget, linkLabel } from '../core/document-style.mjs';
/** Wrap existing leaf text without changing rich-run spans or editable text offsets. */
export function appendLinkedRichText(element, text, runs = []) {
  appendRichText(element, text, runs);
  const ranges = linkRanges(text); if (!ranges.length) return element;
  const nodes = [];
  const walk = node => { if (node.nodeType === 3) nodes.push(node); else for (const child of node.childNodes) walk(child); };
  walk(element); let offset = 0;
  for (const node of nodes) {
    const value = node.nodeValue, start = offset, end = start + value.length; offset = end;
    const matches = ranges.filter(range => range.start < end && range.end > start); if (!matches.length) continue;
    const fragment = document.createDocumentFragment(); let cursor = 0;
    for (const range of matches) {
      const from = Math.max(0,range.start - start), to = Math.min(value.length,range.end - start);
      if (from > cursor) fragment.append(document.createTextNode(value.slice(cursor,from)));
      const anchor = document.createElement('a'); anchor.className = 'resume-link'; anchor.href = range.url; anchor.rel = 'noreferrer'; anchor.textContent = value.slice(from,to); fragment.append(anchor); cursor = to;
    }
    if (cursor < value.length) fragment.append(document.createTextNode(value.slice(cursor)));
    node.replaceWith(fragment);
  }
  return element;
}
export function appendDocumentLinks(element, links, language) {
  for (const item of links || []) {
    const url = safeLinkTarget(item.url); if (!url) continue;
    if (element.childNodes.length) element.append(document.createTextNode(' · '));
    const anchor = document.createElement('a'); anchor.className = 'resume-link'; anchor.href = url; anchor.rel = 'noreferrer'; anchor.textContent = linkLabel(item,language); element.append(anchor);
  }
  return element;
}
