import {captureTextSelection, readEditableText, restoreTextSelection} from './rich-text-view.mjs';

function caretOffsetAt(element, event) {
  if (!Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) return null;
  const document=element.ownerDocument, selection=document.defaultView.getSelection();
  let node, offset;
  if (typeof document.caretPositionFromPoint==='function') {
    const caret=document.caretPositionFromPoint(event.clientX,event.clientY);
    node=caret?.offsetNode; offset=caret?.offset;
  } else if (typeof document.caretRangeFromPoint==='function') {
    const caret=document.caretRangeFromPoint(event.clientX,event.clientY);
    node=caret?.startContainer; offset=caret?.startOffset;
  }
  if (!node || !element.contains(node)) return null;
  const range=document.createRange();range.setStart(node,offset);range.collapse(true);
  selection.removeAllRanges();selection.addRange(range);
  return captureTextSelection(element,selection)?.start ?? null;
}
function wordAt(text, offset, locale) {
  if (!text) return {start:0,end:0};
  const position=Math.max(0,Math.min(text.length,offset));
  const words=[...new Intl.Segmenter(locale || undefined,{granularity:'word'}).segment(text)];
  const word=words.find(part=>position>=part.index&&position<part.index+part.segment.length) || (position===text.length ? words.at(-1) : null);
  if (word?.isWordLike) return {start:word.index,end:word.index+word.segment.length};
  // Emoji and composed letters stay whole. On white space, keep a caret so a
  // fallback never replaces an unrelated neighboring word.
  if (!word || /^\s+$/u.test(word.segment)) return {start:position,end:position};
  const graphemes=[...new Intl.Segmenter(locale || undefined,{granularity:'grapheme'}).segment(text)];
  const grapheme=graphemes.find(part=>position>=part.index&&position<part.index+part.segment.length) || graphemes.at(-1);
  return {start:grapheme.index,end:grapheme.index+grapheme.segment.length};
}
/** Enter a new inline editing session without replacing the native word selection. */
export function enterInlineEditing(element, event) {
  if (!element || element.isContentEditable) return element;
  const native=captureTextSelection(element), text=readEditableText(element);
  element.contentEditable='plaintext-only';
  delete element.dataset.inlineEdited;
  element.spellcheck=false;
  element.focus({preventScroll:true});
  if (native && native.end>native.start && native.textSnapshot===text) {
    // Read-only double-click selection on Windows may include a trailing
    // separator. Keep the clicked word while protecting surrounding spacing.
    const value=text.slice(native.start,native.end), trimmed=value.trim();
    const start=trimmed ? native.start+value.length-value.trimStart().length : native.start;
    const end=trimmed ? native.end-(value.length-value.trimEnd().length) : native.end;
    restoreTextSelection(element,start,end,{backward:native.backward});
    return element;
  }
  const offset=caretOffsetAt(element,event) ?? native?.start ?? 0;
  const locale=element.closest('[lang]')?.lang || element.ownerDocument.documentElement.lang;
  const range=wordAt(text,offset,locale);
  restoreTextSelection(element,range.start,range.end);
  return element;
}
