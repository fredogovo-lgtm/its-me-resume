const clamp = (value, maximum) => Math.max(0, Math.min(value, Math.max(0, maximum)));
const round = value => Math.round(value * 10) / 10;
function intersection(a, b) {
  const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right), bottom = Math.min(a.bottom, b.bottom);
  return { left, top, right, bottom, area: Math.max(0, right - left) * Math.max(0, bottom - top) };
}

// Rectangles are viewport CSS pixels, already including the preview zoom.
export function calculateViewportPlacement(paper, block, pageViews, viewport) {
  const fallback = { page: 0, x: round(clamp(16, paper.width - block.width)), y: round(clamp(65, paper.height - block.height)) };
  const usable = pageViews.filter(view => view.rect.width > 0 && view.rect.height > 0);
  if (!usable.length || !viewport) return fallback;
  const views = usable.map(view => ({ ...view, visible: intersection(view.rect, viewport) }));
  views.sort((left, right) => right.visible.area - left.visible.area || Math.abs((left.rect.top + left.rect.bottom - viewport.top - viewport.bottom) / 2) - Math.abs((right.rect.top + right.rect.bottom - viewport.top - viewport.bottom) / 2));
  const view = views[0], visible = view.visible.area > 0 ? view.visible : view.rect;
  const centerX = (visible.left + visible.right) / 2, centerY = (visible.top + visible.bottom) / 2;
  return {
    page: view.page,
    x: round(clamp((centerX - view.rect.left) / view.rect.width * paper.width - block.width / 2, paper.width - block.width)),
    y: round(clamp((centerY - view.rect.top) / view.rect.height * paper.height - block.height / 2, paper.height - block.height)),
  };
}

// Call before pushing the block; call the returned afterRender after updateProject.
// Placement, selection and insertion therefore remain a single undo operation.
export function placeNewBlockInViewport(ctx, block) {
  const root = document.querySelector('#resume-pages'), scroller = root?.closest('.canvas-scroll');
  const pageViews = [...(root?.querySelectorAll('.resume-paper') || [])].map((paper, page) => ({ page, rect: paper.getBoundingClientRect() }));
  const placement = calculateViewportPlacement(ctx.project.paper, block, pageViews, scroller?.getBoundingClientRect());
  Object.assign(block, placement); ctx.ui.selectedBlockId = block.id;
  const projectId = ctx.project.id, language = ctx.project.language;
  return { ...placement, afterRender() {
    requestAnimationFrame(() => {
      if (ctx.project?.id !== projectId || ctx.project.language !== language || ctx.ui.selectedBlockId !== block.id) return;
      const element = [...document.querySelectorAll('#resume-pages [data-block-id]')].find(item => item.dataset.blockId === block.id);
      element?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    });
  } };
}