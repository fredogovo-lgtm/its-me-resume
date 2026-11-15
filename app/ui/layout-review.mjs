import { paginateSelectedBlock } from './pagination.mjs';
const create = (tag, text) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
function locate(ctx, id) {
  ctx.ui.selectedBlockId = id; ctx.render();
  document.querySelector('#resume-pages [data-block-id="' + id + '"]')?.scrollIntoView({ block: 'center', inline: 'nearest' });
}
export function renderOverlapWarning(ctx, root) {
  const issues = ctx.layoutResult?.overlaps || [];
  root.replaceChildren(); root.hidden = !issues.length;
  if (!issues.length) return;
  root.append(create('span', issues[0].message + (issues.length > 1 ? ' 共发现' + issues.length + '处。' : '')));
  const button = create('button', '定位重叠模块'); button.type = 'button'; button.className = 'button quiet'; button.dataset.locateOverlap = 'true';
  button.onclick = () => locate(ctx, issues[0].blockIds.find(id => id !== ctx.ui.selectedBlockId) || issues[0].blockIds[0]);
  root.append(button);
}
export function renderLayoutWarning(ctx, root) {
  const issues = ctx.layoutResult?.warnings || [];
  root.replaceChildren(); root.hidden = !issues.length;
  if (!issues.length) return;
  root.append(create('span', issues[0] + (issues.length > 1 ? ' 另有' + (issues.length - 1) + '项排版提示。' : '')));
  const visible = ctx.project.blocks.filter(block => !block.hiddenLanguages?.includes(ctx.project.language));
  const id = ctx.layoutResult.issueBlockIds?.[0] || visible[0]?.id;
  if (!id) return;
  const position = create('button', '定位模块'); position.type = 'button'; position.className = 'button quiet'; position.dataset.locateLayout = 'true'; position.onclick = () => locate(ctx,id); root.append(position);
  const block = visible.find(item => item.id === id);
  if (block && !['shape','line'].includes(block.kind)) {
    const split = create('button', '按页拆分'); split.type = 'button'; split.className = 'button quiet'; split.dataset.warningSplit = 'true'; split.disabled = Boolean(block.locked);
    split.onclick = () => { ctx.ui.selectedBlockId = id; paginateSelectedBlock(ctx); }; root.append(split);
    if (block.fixedHeight) {
      const auto = create('button', '自动高度'); auto.type = 'button'; auto.className = 'button quiet'; auto.disabled = Boolean(block.locked); auto.dataset.warningAutoHeight = 'true';
      auto.onclick = () => ctx.updateProject(next => { next.blocks.find(item => item.id === id).fixedHeight = false; }); root.append(auto);
    }
  }
}
