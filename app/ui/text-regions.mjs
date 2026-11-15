import { findTextOverlaps, findImageOverlaps } from '../core/text-overlap.mjs';

export function collectTextOverlaps(container, project) {
  const blocks = new Map(project.blocks.map(block => [block.id, block]));
  const regions = [], photos = [];
  [...container.querySelectorAll('.resume-paper')].forEach((paper, page) => {
    const paperBox = paper.getBoundingClientRect();
    const unitX = paperBox.width / project.paper.width, unitY = paperBox.height / project.paper.height;
    if (!(unitX > 0 && unitY > 0)) return;
    for (const element of paper.querySelectorAll('.resume-block')) {
      const block = blocks.get(element.dataset.blockId);
      if (!block || block.hiddenLanguages?.includes(project.language)) continue;
      if (block.kind === 'photo' || block.kind === 'shape' && block.image) {
        const box=element.getBoundingClientRect(),left=Math.max(box.left,paperBox.left),top=Math.max(box.top,paperBox.top),right=Math.min(box.right,paperBox.right),bottom=Math.min(box.bottom,paperBox.bottom);
        photos.push({blockId:block.id,page,x:(left-paperBox.left)/unitX,y:(top-paperBox.top)/unitY,width:(right-left)/unitX,height:(bottom-top)/unitY});continue;
      }
      if (['line','shape'].includes(block.kind)) continue;
      const rects = [], seen = new Set(), frame = element.getBoundingClientRect();
      const clip = block.fixedHeight ? { left: Math.max(paperBox.left, frame.left), top: Math.max(paperBox.top, frame.top), right: Math.min(paperBox.right, frame.right), bottom: Math.min(paperBox.bottom, frame.bottom) } : paperBox;
      for (const field of element.querySelectorAll('.resume-text, .block-period, .block-category, .block-links, .continuation-marker')) {
        const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (!node.nodeValue?.trim()) continue;
          const style = getComputedStyle(node.parentElement);
          if (style.visibility === 'hidden' || style.display === 'none' || /^rgba\([^)]*,\s*0\s*\)$/u.test(style.color)) continue;
          // Empty space between words does not cover another module's text.
          for (const match of node.nodeValue.matchAll(/\S+/gu)) {
            const range = document.createRange(); range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
            for (const measured of range.getClientRects()) {
              const left = Math.max(measured.left, clip.left), right = Math.min(measured.right, clip.right);
              const top = Math.max(measured.top, clip.top), bottom = Math.min(measured.bottom, clip.bottom);
              if (right - left < .4 || bottom - top < .4) continue;
              const rect = { x: (left - paperBox.left) / unitX, y: (top - paperBox.top) / unitY, width: (right - left) / unitX, height: (bottom - top) / unitY };
              const key = [rect.x,rect.y,rect.width,rect.height].map(value => value.toFixed(3)).join(':');
              if (!seen.has(key)) { rects.push(rect); seen.add(key); }
            }
          }
        }
      }
      regions.push({ blockId: block.id, label: block[project.language]?.title || block[project.language === 'zh' ? 'en' : 'zh']?.title || '文字模块', page, rects });
    }
  });
  return [...findTextOverlaps(regions),...findImageOverlaps(photos,regions)];
}
