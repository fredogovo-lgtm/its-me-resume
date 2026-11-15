// Safe inline rendering and one shared text model for editing and DOM selections.

export function safeInlineStyle(value) {
  const style = {};
  if (!value || typeof value !== 'object') return style;
  if ([400, 700].includes(value.fontWeight)) style.fontWeight = value.fontWeight;
  if (['normal', 'italic'].includes(value.fontStyle)) style.fontStyle = value.fontStyle;
  if (['none', 'underline'].includes(value.textDecoration)) style.textDecoration = value.textDecoration;
  if (typeof value.color === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/iu.test(value.color)) style.color = value.color;
  if (Number.isFinite(value.fontSize) && value.fontSize >= 4 && value.fontSize <= 144) style.fontSize = `${value.fontSize}pt`;
  if (typeof value.fontFamily === 'string' && value.fontFamily.length > 0 && value.fontFamily.length <= 160 && !/[\u0000-\u001f\u007f{};<>]|url\s*\(/iu.test(value.fontFamily)) style.fontFamily = value.fontFamily;
  return style;
}
export function appendRichText(element, text, runs = []) {
  text = String(text ?? '');
  element.replaceChildren();
  const append = (value, style = {}) => {
    if (!value) return;
    const span = document.createElement('span'); span.className = 'rich-text-run';
    // Decorations belong to the leaf span. An underline on an ancestor cannot
    // be cancelled on a selected descendant with text-decoration:none.
    span.style.textDecoration = 'var(--block-text-decoration, none)';
    Object.assign(span.style, style); span.append(document.createTextNode(value)); element.append(span);
  };
  let cursor = 0;
  for (const run of [...(Array.isArray(runs) ? runs : [])].sort((a, b) => a.start - b.start)) {
    if (!Number.isInteger(run?.start) || !Number.isInteger(run?.end) || run.start < cursor || run.end <= run.start || run.start < 0 || run.end > text.length) continue;
    if (run.start > cursor) append(text.slice(cursor, run.start));
    append(text.slice(run.start, run.end), safeInlineStyle(run.style));
    cursor = run.end;
  }
  if (cursor < text.length) append(text.slice(cursor));
  return element;
}
const isBlock = node => node?.nodeType === 1 && ['DIV', 'P'].includes(node.tagName);
function editableMap(root) {
  let text = '';
  const offsets = new WeakMap(), points = [];
  const record = (node, offset, index = text.length) => {
    let values = offsets.get(node); if (!values) { values = new Map(); offsets.set(node, values); }
    values.set(offset, index);
    // Text points retain precise offsets when several DOM boundaries share an index.
    if (!points[index] || node.nodeType === 3 || points[index].node.nodeType !== 3) points[index] = {node, offset};
  };
  const newline = () => { text += '\n'; };
  const walk = node => {
    const start = text.length;
    if (node.nodeType === 3) {
      record(node, 0);
      const raw = node.nodeValue || '';
      for (let index = 0; index < raw.length; index++) {
        if (raw[index] === '\r') { newline(); record(node, index + 1); if (raw[index + 1] === '\n') { index++; record(node, index + 1); } }
        else { text += raw[index]; record(node, index + 1); }
      }
      return text.slice(start);
    }
    if (node.nodeType !== 1 && node !== root) return '';
    if (node.nodeType === 1 && ['SCRIPT', 'STYLE'].includes(node.tagName)) { record(node, 0); return ''; }
    if (node.nodeType === 1 && node.tagName === 'BR') { record(node, 0); newline(); return '\n'; }
    const children = [...node.childNodes];
    const placeholder = children.length === 1 && children[0].nodeType === 1 && children[0].tagName === 'BR' && (isBlock(node) || node === root);
    let previous = null;
    record(node, 0);
    children.forEach((child, index) => {
      record(node, index);
      if (child.nodeType === 8 || child.nodeType === 1 && ['SCRIPT', 'STYLE'].includes(child.tagName)) { record(child, 0); return; }
      if (previous && (isBlock(child) || isBlock(previous.node)) && !previous.text.endsWith('\n')) newline();
      let value;
      if (placeholder) { record(child, 0); value = ''; }
      else value = walk(child);
      previous = {node:child, text:value};
      record(node, index + 1);
    });
    record(node, children.length);
    return text.slice(start);
  };
  walk(root);
  return {text, offsets, points};
}
export function readEditableText(element) { return editableMap(element).text; }
export function captureTextSelection(element, selection = window.getSelection()) {
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
  const map = editableMap(element);
  const start = map.offsets.get(range.startContainer)?.get(range.startOffset), end = map.offsets.get(range.endContainer)?.get(range.endOffset);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  const anchor = map.offsets.get(selection.anchorNode)?.get(selection.anchorOffset);
  const focus = map.offsets.get(selection.focusNode)?.get(selection.focusOffset);
  return {start:Math.min(start,end), end:Math.max(start,end), backward:anchor > focus, textSnapshot:map.text};
}
export function restoreTextSelection(element, start, end = start, {backward = false, focus = false} = {}) {
  const map = editableMap(element);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > map.text.length) return false;
  const from = map.points[start], to = map.points[end]; if (!from || !to) return false;
  if (focus) element.focus({preventScroll:true});
  const selection = window.getSelection();
  selection.removeAllRanges();
  if (backward && selection.setBaseAndExtent) selection.setBaseAndExtent(to.node,to.offset,from.node,from.offset);
  else { const range = document.createRange(); range.setStart(from.node,from.offset); range.setEnd(to.node,to.offset); selection.addRange(range); }
  return true;
}
