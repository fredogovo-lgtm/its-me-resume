import {preserveCanvasOtherLayout} from '../core/canvas-groups.mjs';
const positionKeys = ['x', 'y', 'width', 'height', 'page', 'fontSize'];
function snapshotPosition(block, measured = {}) {
  return {
    ...Object.fromEntries(positionKeys.map(key => [key, measured[key] ?? block[key]])),
    fixedHeight: measured.fixedHeight === undefined ? Boolean(block.fixedHeight) : Boolean(measured.fixedHeight),
  };
}
function snapshotLayout(project) {
  return { mode: project.mode, positions: Object.fromEntries(project.blocks.map(block => [block.id, snapshotPosition(block)])) };
}
function saveFreeLayout(project) {
  project.freeLayoutByLanguage ||= {};
  project.freeLayoutByLanguage[project.language] = snapshotLayout(project);
}

// Freeze the visible template, without resurrecting an older manual draft.
// The untouched language must keep its original mode before the shared mode changes.
export function freezeMeasuredLayout(project, positions = {}) {
  if (project.mode !== 'flow') return project;
  preserveCanvasOtherLayout(project);
  for (const block of project.blocks) if (!block.hiddenLanguages?.includes(project.language)) Object.assign(block, snapshotPosition(block, positions[block.id] || {}));
  project.mode = 'free';
  return project;
}

// Shared by the editor and selection wizard. No DOM or storage access.
export function applyLayoutMode(project, mode, positions = {}) {
  if (!['flow', 'free'].includes(mode)) throw new Error('不支持的排版模式');
  if (project.mode === mode) return project;
  if (project.mode === 'free') {
    preserveCanvasOtherLayout(project);
    saveFreeLayout(project);
  }
  if (mode === 'free') {
    const saved = project.freeLayoutByLanguage?.[project.language]?.positions || {};
    freezeMeasuredLayout(project, positions);
    // Explicit mode changes restore an existing manual draft. Insert/resize paths
    // call freezeMeasuredLayout directly and keep the latest measured template.
    for (const block of project.blocks) if (!block.hiddenLanguages?.includes(project.language) && saved[block.id]) Object.assign(block, snapshotPosition(block, saved[block.id]));
  }
  project.mode = mode;
  return project;
}

export function applyLanguageLayout(project, language) {
  if (!['zh', 'en'].includes(language)) throw new Error('不支持的简历语言');
  if (project.language === language) return project;
  if (project.mode === 'free') saveFreeLayout(project);
  project.layoutByLanguage ||= {};
  project.layoutByLanguage[project.language] = snapshotLayout(project);
  const layout = project.layoutByLanguage[language];
  if (layout) {
    project.mode = layout.mode;
    for (const block of project.blocks) {
      const position = layout.positions[block.id];
      if (position) Object.assign(block, position, { fixedHeight: Boolean(position.fixedHeight) });
    }
  }
  project.language = language;
  return project;
}
