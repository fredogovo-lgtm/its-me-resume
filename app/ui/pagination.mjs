import { findFittingTextRanges, splitBlock } from '../core/split-block.mjs';
import { insertContinuationPages } from '../core/page-insertion.mjs';
import { validateProject } from '../core/model.mjs';
import { sliceTextRuns, getTextRuns } from '../core/rich-text.mjs';
import { renderResume } from './resume-view.mjs';
import { pageChrome } from '../core/document-style.mjs';

// One replacement path is shared by measurement probes and the committed result.
// Reading order is language-local and must include new continuation IDs in place.
export function replacePaginatedBlock(project,sourceId,pieces,{placement='after-source'}={}){
  if(!Array.isArray(pieces)||!pieces.length||pieces[0]?.id!==sourceId||!project.blocks.some(block=>block.id===sourceId))throw new Error('分页来源或续框无效。');
  let next;
  if(project.mode==='free'&&pieces.length>1)next=insertContinuationPages(project,sourceId,pieces,{placement});
  else{next=structuredClone(project);next.blocks.splice(next.blocks.findIndex(block=>block.id===sourceId),1,...structuredClone(pieces));}
  const order=next.readingOrderByLanguage?.[next.language];
  if(order)next.readingOrderByLanguage[next.language]=order.flatMap(id=>id===sourceId?pieces.map(piece=>piece.id):[id]);
  return next;
}

export function mountPaginationOptions(ctx) {
  const control = document.querySelector('[data-action="split-pages"]');
  if (!control) return;
  const root = control.closest('.pagination-actions') || control.parentElement;
  root.querySelector('[data-pagination-options]')?.remove();
  const free = ctx.project?.mode === 'free';
  const help = root.querySelector('.panel-help');
  if (free) {
    const label = document.createElement('label'); label.className = 'field'; label.dataset.paginationOptions = '';
    const title = document.createElement('span'); title.textContent = '续文位置';
    const select = document.createElement('select'); select.dataset.paginationPlacement = ''; select.setAttribute('aria-label', '分页续文位置');
    select.append(new Option('紧接原页插入续页（默认）', 'after-source'), new Option('追加到最后一页', 'append'));
    select.value = ctx.ui.paginationPlacement === 'append' ? 'append' : 'after-source';
    select.disabled = Boolean(ctx.ui.paginating);
    const refresh = () => {
      if (help) help.textContent = select.value === 'append' ? '原有页码不变，续文追加至当前语言最后一页。可一次撤销；另一语言布局保留。' : '续文紧接原页插入，后续页面整体顺延。可一次撤销；另一语言布局保留。';
      if (!ctx.ui.paginating) control.textContent = select.value === 'append' ? '按页拆分并追加末尾' : '按页拆分并插入续页';
    };
    select.addEventListener('change', () => { ctx.ui.paginationPlacement = select.value; refresh(); });
    label.append(title, select); control.before(label); refresh();
  } else {
    if (help) help.textContent = '长正文按当前纸张拆为续框，按模块顺序排版，可一次撤销；另一语言完整保留在首框。';
    if (!ctx.ui.paginating) control.textContent = '按页面拆分正文';
  }
  control.disabled = Boolean(ctx.ui.paginating || ctx.project?.blocks.find(item => item.id === ctx.ui.selectedBlockId)?.locked);
}

export async function paginateSelectedBlock(ctx, { placement = ctx.ui.paginationPlacement || 'after-source' } = {}) {
  if (ctx.ui.paginating) return;
  const sourceProject = ctx.project;
  const source = sourceProject?.blocks.find(block => block.id === ctx.ui.selectedBlockId);
  if (!source || ['shape', 'line', 'photo'].includes(source.kind)) return;
  if (source.locked) return ctx.notify('请先解锁模块。');
  if (!['after-source', 'append'].includes(placement)) return ctx.notify('请选择续文的页面位置。', true);
  let project = structuredClone(sourceProject);
  const block = structuredClone(source), snapshot = JSON.stringify(sourceProject), language = project.language;
  const chrome = pageChrome(project), bottom = project.paper.height - chrome.bottom;
  let position = ctx.layoutResult.positions[block.id] || block;
  let width = position.width, firstHeight;
  const fullHeight = bottom - chrome.top;
  if (width < 12 || (project.mode === 'free' && (block.x < 0 || block.x + width > project.paper.width || block.y < (block.page > 0 ? chrome.top : 16)))) return ctx.notify('请先把文本框移到纸张内容区，避开页眉，并将宽度调整到纸张内，再拆分。', true);
  ctx.ui.paginating = true;
  const control = document.querySelector('[data-action="split-pages"]');
  if (control) { control.disabled = true; control.textContent = '正在计算…'; }
  const placementControl = document.querySelector('[data-pagination-placement]');
  if (placementControl) placementControl.disabled = true;
  let staging;
  try {
    await document.fonts?.ready;
    staging = document.createElement('div');
    staging.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none';
    document.body.append(staging);
    const unchanged = () => { if (ctx.project?.id !== project.id || JSON.stringify(ctx.project) !== snapshot) throw new Error('简历已发生变化，请重新拆分。'); };
    unchanged();
    if (project.mode === 'flow') {
      // The overflowing full block may already have been pushed to a fresh page.
      // A one-grapheme probe finds the real available space after earlier blocks.
      const probe = structuredClone(project), target = probe.blocks.find(item => item.id === block.id);
      const first = new Intl.Segmenter(project.language, {granularity:'grapheme'}).segment(block[language].body)[Symbol.iterator]().next().value?.segment || '';
      target[language].body = first; target.fixedHeight = false;
      if (target.richText?.[language]?.body) target.richText[language].body = sliceTextRuns(getTextRuns(block,language,'body'),0,first.length);
      const result = renderResume(staging, probe);
      position = result.positions[block.id];
      if (!position) throw new Error('当前语言没有可见的文本框，请先选择可见模块再拆分。');
      width = position.width;
    }
    firstHeight = bottom - (project.mode === 'free' ? block.y : position.y);
    if (width < 12 || firstHeight <= 0 || fullHeight <= 0) throw new Error('当前页没有可用正文空间，请增大纸张、减小字号或移动文本框后重试。');
    let measures = 0;
    const starts = [], probePrefix = 'pagination-' + crypto.randomUUID();
    const ranges = await findFittingTextRanges(block[language].body, async (_body, meta) => {
      if (++measures % 8 === 0) await new Promise(requestAnimationFrame);
      unchanged();
      starts[meta.index] = meta.start;
      // Render the real preceding pieces and candidate together. This includes
      // grouped category headings, the continuation marker, local rich text,
      // per-page sidebar widths, and the exact active font/line spacing.
      const probeRanges = starts.slice(0, meta.index + 1).map((start,index) => ({start,end:index===meta.index?meta.end:starts[index+1]}));
      const truncated = structuredClone(block);
      truncated[language].body = block[language].body.slice(0, meta.end);
      if (truncated.richText?.[language]?.body) truncated.richText[language].body = sliceTextRuns(getTextRuns(block,language,'body'),0,meta.end);
      let sequence = 0;
      const probePieces = splitBlock(truncated,language,probeRanges,{idFactory:()=>probePrefix+'-'+(++sequence)});
      probePieces.forEach(part => {part.width=width;});
      const probe = replacePaginatedBlock(project,block.id,probePieces,{placement});
      const result = renderResume(staging,probe), ids=new Set(probePieces.map(part=>part.id));
      if ((result.issueBlockIds||[]).some(id=>ids.has(id))) return false;
      if (project.mode==='flow' && result.positions[block.id]?.page>position.page) return false;
      return probePieces.every(part=>{
        const frame=result.positions[part.id],top=frame?.page>0?chrome.top:16;
        return frame && frame.width>=12 && frame.x>=0 && frame.x+frame.width<=project.paper.width+.1 && frame.y>=top-.1 && frame.y+frame.height<=bottom-.6;
      });
    });
    if (ranges.length === 1) return ctx.notify('正文可放入一页，无需拆分。固定高度可用“恢复自动高度”调整。');
    const pieces = splitBlock(block, language, ranges);
    if (project.blocks.length + pieces.length - 1 > 500) throw new Error('当前简历模块已达上限，请先精简模块。');
    pieces.forEach(part => { part.width = width; });
    project = replacePaginatedBlock(project,block.id,pieces,{placement});
    validateProject(project);
    unchanged();
    const verified = renderResume(staging, project), pieceIds = new Set(pieces.map(part => part.id));
    const previousIssues = new Set(ctx.layoutResult.issueBlockIds || []);
    const failures = verified.warnings.filter((message,index) => pieceIds.has(verified.issueBlockIds?.[index]) || !previousIssues.has(verified.issueBlockIds?.[index]));
    for (const part of pieces) {
      const frame = verified.positions[part.id], top = frame?.page > 0 ? chrome.top : 16;
      if (!frame || frame.y < top - .1 || frame.y + frame.height > bottom + .1) failures.push('拆分后的文本框仍进入页眉/页码区域，或超出纸张。');
    }
    if (project.mode === 'flow' && verified.positions[block.id]?.page > position.page) failures.push('首段未能放入当前页的剩余空间。');
    if (failures.length) throw new Error('本次拆分未通过实际排版复检，已保留原稿。'+[...new Set(failures)].slice(0,2).join(' ')+' 请增大宽度或纸张、减小字号/行距，或调整标题与位置后重试。');
    if (ctx.project?.id !== project.id || JSON.stringify(ctx.project) !== snapshot) throw new Error('简历已发生变化，请重新拆分。');
    ctx.updateProject(next => {
      next.blocks = project.blocks;
      if(project.readingOrderByLanguage)next.readingOrderByLanguage=structuredClone(project.readingOrderByLanguage);
      if (project.layoutByLanguage) next.layoutByLanguage = project.layoutByLanguage;
      if (project.freeLayoutByLanguage) next.freeLayoutByLanguage = project.freeLayoutByLanguage;
    }, {trackBilingual:false});
    const where = project.mode === 'free' ? placement === 'append' ? '，续文已追加末尾' : '，续页已紧接原页插入' : '';
    ctx.notify('已拆成' + pieces.length + '个文本框' + where + '，可继续编辑或一次撤销。另一语言保留在首框。');
  } catch (error) {
    ctx.notify(error.message, true);
  } finally {
    staging?.remove();
    ctx.ui.paginating = false;
    mountPaginationOptions(ctx);
  }
}