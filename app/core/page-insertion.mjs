import {pageChrome} from './document-style.mjs';
const geometryKeys = ['x', 'y', 'width', 'height', 'page', 'fontSize'];
const position = block => ({ ...Object.fromEntries(geometryKeys.map(key => [key, block[key]])), fixedHeight: Boolean(block.fixedHeight) });
const snapshot = project => ({ mode: project.mode, positions: Object.fromEntries(project.blocks.map(block => [block.id, position(block)])) });

// Returns a complete clone so a rejected insertion cannot partly change a project.
export function insertContinuationPages(project, sourceId, pieces, { placement = 'after-source' } = {}) {
  if (project?.mode !== 'free' || !['after-source', 'append'].includes(placement)) throw new Error('续页位置无效。');
  const sourceIndex = project.blocks.findIndex(block => block.id === sourceId), source = project.blocks[sourceIndex];
  if (!source || !Array.isArray(pieces) || pieces.length < 2 || pieces.length > 50 || pieces[0]?.id !== sourceId) throw new Error('续页模块无效。');
  const next = structuredClone(project), parts = structuredClone(pieces), count = parts.length - 1;
  const language = next.language, other = language === 'zh' ? 'en' : 'zh';
  // A language with no saved geometry previously inherited the live coordinates.
  // Record those before shifting pages, including blocks added after an old snapshot.
  next.layoutByLanguage ||= {};
  next.layoutByLanguage[other] ||= { mode: project.mode, positions: {} };
  for (const block of project.blocks) {
    next.layoutByLanguage[other].positions[block.id] ||= position(block);
  }
  const lastPage = Math.max(0, ...project.blocks.filter(block => !block.hiddenLanguages?.includes(language)).map(block => block.page));
  const firstNewPage = placement === 'append' ? lastPage + 1 : source.page + 1;
  if (placement === 'after-source') for (const block of next.blocks) if (block.page > source.page) block.page += count;
  parts.forEach((part, index) => {
    if (!index) { part.x = source.x; part.y = source.y; part.page = source.page; return; }
    part.x = Math.max(0, Math.min(Math.max(16, source.x), next.paper.width - part.width));
    part.page = firstNewPage + index - 1; part.y = part.page > 0 ? pageChrome(next).top : 16;
  });
  next.blocks.splice(sourceIndex, 1, ...parts);
  if (next.blocks.some(block => block.page > 1000)) throw new Error('拆分后页码超出允许上限，请减少页面后重试。');
  next.layoutByLanguage[language] = snapshot(next);
  next.freeLayoutByLanguage ||= {};
  next.freeLayoutByLanguage[language] = snapshot(next);
  return next;
}