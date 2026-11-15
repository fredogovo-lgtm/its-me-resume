import { renderResume } from './resume-view.mjs';
window.renderPrint = async (project) => {
  await document.fonts.ready;
  const result = renderResume(document.querySelector('#print-pages'), project);
  await document.fonts.ready;
  await Promise.all([...document.querySelectorAll('#print-pages img')].map(image => image.decode().catch(() => { throw new Error('个人照片无法读取，请更换照片后再导出。'); })));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return { pages: result.pages, warnings: result.warnings, overlaps: result.overlaps };
};
