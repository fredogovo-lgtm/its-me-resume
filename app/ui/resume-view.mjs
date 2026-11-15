import {readingBlocks} from '../core/submission.mjs';
import {flowColumn,hasSidebarContent,templateDecorationSettings,canvasGroupFor} from '../core/canvas-groups.mjs';
import {paintPhoto} from './photo-view.mjs';
import {groupFlowBlocks} from '../core/personal-templates.mjs';
import { categories, categoryEnglish, icon } from './helpers.mjs';
import { getTextRuns } from '../core/rich-text.mjs';
import { appendLinkedRichText, appendDocumentLinks } from './document-links.mjs';
import { documentStyle, effectiveBlockStyle, pageChrome } from '../core/document-style.mjs';
import { paintDesignMaterial } from './design-material-view.mjs';
import { getPeriod } from '../core/entry-content.mjs';
import { collectTextOverlaps } from './text-regions.mjs';
const PX_MM = 96 / 25.4;
const create = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const isDecoration = block => ['shape','line','photo'].includes(block.kind);

const normalizedHeading = value => String(value || '').trim().replace(/[：:]$/u, '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
export function resumeHeadingPlan(block, project, showCategory = true) {
  const language = project.language, labels = language === 'en' ? categoryEnglish : categories;
  const categoryTitle = project.sectionTitles?.[language]?.[block.category]?.trim() || labels[block.category] || block.category;
  const period = getPeriod(block, language);
  const duplicateSkills = block.kind === 'entry' && block.category === 'skills' && normalizedHeading(block[language]?.title) === normalizedHeading(categoryTitle) && (showCategory || project.groupSections !== false);
  return { categoryTitle, period, showCategory: block.kind === 'entry' && showCategory, showTitle: !duplicateSkills, reserveDateColumn: Boolean(period && language === 'en') };
}

function applyTemplateDecorations(paper,project){const settings=templateDecorationSettings(project);paper.classList.toggle('no-section-rules',!settings.sectionRules);paper.classList.toggle('no-profile-rule',!settings.profileRule);}

function blockElement(block, project, interactive, showCategory = true) {
  const language = project.language;
  const text = block[language] || { title: '', subtitle: '', body: '' };
  const element = create('article', `resume-block kind-${block.kind}`);
  element.dataset.blockId = block.id;
  element.dataset.language = language;
  const group=canvasGroupFor(project,block.id);if(group)element.dataset.canvasGroup=group.id;
  if(block.templateDecoration)element.dataset.templateDecoration=block.templateDecoration;
  element.style.width = `${block.width}mm`;
  const effective = effectiveBlockStyle(block, project);
  element.style.fontSize = `${effective.fontSize}pt`;
  element.style.zIndex = block.layer ?? (['shape','line'].includes(block.kind) ? 1 : 2);
  element.style.color = block.color || '#26343f';
  if (block.fontFamily) element.style.fontFamily = block.fontFamily;
  if (block.fontWeight !== undefined) { element.style.fontWeight = block.fontWeight; element.classList.add('has-font-weight'); }
  if (block.fontStyle) element.style.fontStyle = block.fontStyle;
  if (block.textDecoration) element.style.setProperty('--block-text-decoration', block.textDecoration);
  if (block.textAlign) { element.style.textAlign = block.textAlign; element.classList.toggle('has-text-align', block.textAlign !== 'left'); }
  if (block.lineHeight !== undefined || project.documentStyle?.lineHeight !== undefined) { element.style.lineHeight = effective.lineHeight; element.classList.add('has-line-height'); }
  if (block.kind === 'photo') {
    element.style.height = block.height + 'mm';
    const photo = create('div', 'resume-photo-frame'); paintPhoto(photo, block.photo); element.append(photo);
  } else if (isDecoration(block)) {
    element.style.height = `${block.height}mm`;
    if (block.kind !== 'shape' || !paintDesignMaterial(element, block, project)) element.style.background = block.background || project.accent;
    if (block.kind === 'line') element.classList.add('decoration-line');
  } else {
    // Resize controls and warning labels stay outside this content measurement.
    const content = create('div', 'block-content');
    const plan = resumeHeadingPlan(block, project, showCategory);
    if (plan.showCategory) content.append(create('div', 'block-category', plan.categoryTitle));
    const heading = create('div', 'block-heading');
    const title = create('h2', 'block-title resume-text');
    appendLinkedRichText(title, text.title, getTextRuns(block, language, 'title'));
    title.dataset.field = 'title';
    if (plan.showTitle) heading.append(title);
    if (block.continuation && documentStyle(project).continuationMarkers) heading.append(create('span', 'continuation-marker', language === 'en' ? 'continued' : '续'));
    if (plan.period) heading.append(create('span', 'block-period', plan.period));
    if (plan.reserveDateColumn) heading.classList.add('reserve-date-column');
    if (plan.showTitle || plan.period || block.continuation && documentStyle(project).continuationMarkers) content.append(heading);
    if (text.subtitle) {
      const subtitle = create('div', 'block-subtitle resume-text');
      appendLinkedRichText(subtitle, text.subtitle, getTextRuns(block, language, 'subtitle'));
      subtitle.dataset.field = 'subtitle';
      content.append(subtitle);
    }
    if (text.body) {
      const body = create('div', 'block-body resume-text');
      appendLinkedRichText(body, text.body, getTextRuns(block, language, 'body'));
      body.dataset.field = 'body';
      content.append(body);
    }
    if (block.links?.length) { const links = create('div', 'block-links'); appendDocumentLinks(links, block.links, language); if (links.childNodes.length) content.append(links); }
    element.append(content);
    if (block.fixedHeight) { element.style.height = `${block.height}mm`; element.classList.add('has-fixed-height'); }
    if (block.background) element.style.background = block.background;
  }
  if (interactive) {
    element.dataset.interactive = 'true';
    element.classList.toggle('is-locked', Boolean(block.locked));
    element.tabIndex = 0;
    element.setAttribute('aria-label', `${text.title || '装饰'}，${block.locked ? '模块已锁定' : '双击编辑文字，拖动边框移动'}，文本框`);
    const handle = create('button', 'block-drag');
    handle.type = 'button';
    handle.title = block.locked ? '模块已锁定' : '拖动模块；模板排版将转换为自由摆放';
    handle.setAttribute('aria-label', handle.title);
    handle.innerHTML = icon(block.locked ? 'lock' : 'grip', 15);
    element.append(handle);
    if (!block.locked) {
      for (const edge of ['n', 's', 'e', 'w']) {
        const border = create('span', `block-frame-edge edge-${edge}`);
        border.dataset.frameEdge = edge;
        border.setAttribute('aria-hidden', 'true');
        element.append(border);
      }
      for (const direction of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
        const resize = create('button', `block-resize resize-${direction}`);
        resize.type = 'button';
        resize.dataset.resize = direction;
        resize.title = `调整文本框尺寸（${direction.toUpperCase()}）`;
        resize.setAttribute('aria-label', resize.title);
        element.append(resize);
      }
    }
    if (!isDecoration(block)) {
      const badge = create('span', 'block-overflow-badge', '文字超出文本框');
      badge.hidden = true;
      element.append(badge);
    }
  }
  return element;
}

export function measureTextBlock(block, project, widthMm) {
  const paper = create('section', 'resume-paper template-' + project.template);
  applyTemplateDecorations(paper,project);
  paper.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;overflow:visible;pointer-events:none';
  paper.style.width = project.paper.width + 'mm';
  paper.style.fontFamily = project.fontFamily;
  paper.style.setProperty('--resume-accent', project.accent);
  const element = blockElement({ ...block, width: widthMm, fixedHeight: false }, project, false);
  paper.append(element); document.body.append(paper);
  try {
    const content = element.querySelector('.block-content');
    return { height: Math.max(content.offsetHeight, content.scrollHeight) / PX_MM, horizontalOverflow: content.scrollWidth > content.clientWidth + 1 };
  } finally { paper.remove(); }
}

export function renderResume(container, project, { interactive = false, collapsedPages = null } = {}) {
  container.replaceChildren();
  const { width, height } = project.paper;
  const settings = documentStyle(project), chrome = pageChrome(project);
  const topFor = page => page > 0 ? chrome.top : 16;
  const pages = [], warnings = [], positions = {}, issueBlockIds = [];
  const warn = (block, message) => { warnings.push(message); issueBlockIds.push(block.id); };
  const pageFor = index => {
    while (pages.length <= index) {
      const wrapper = create('div', 'paper-wrap');
      const paper = create('section', `resume-paper template-${project.template}`);
      applyTemplateDecorations(paper,project);
      paper.style.width = `${width}mm`;
      paper.style.height = `${height}mm`;
      paper.style.fontFamily = project.fontFamily;
      paper.style.setProperty('--resume-accent', project.accent);
      paper.setAttribute('aria-label', `第 ${pages.length + 1} 页`);
      if (project.template === 'sidebar' && templateDecorationSettings(project).sidebarMode==='auto' && !collapsedPages?.has(pages.length) && (project.mode === 'free' || hasSidebarContent(project))) paper.append(create('div', 'paper-sidebar'));
      wrapper.append(paper, create('span', 'paper-number', `${pages.length + 1}`));
      container.append(wrapper);
      pages.push(paper);
    }
    return pages[index];
  };
  const add = (block, page, x, y, blockWidth, showCategory = true) => {
    const element = blockElement({ ...block, width: blockWidth }, project, interactive, showCategory);
    element.style.left = `${x}mm`;
    element.style.top = `${y}mm`;
    pageFor(page).append(element);
    const content = element.querySelector('.block-content');
    // offsetHeight/scrollHeight are CSS pixels before the preview transform.
    const contentHeightPx = content ? Math.max(content.offsetHeight, content.scrollHeight) : block.height * PX_MM;
    const contentHeight = contentHeightPx / PX_MM;
    const actualHeight = isDecoration(block) || block.fixedHeight ? block.height : contentHeight;
    const verticalOverflow = !isDecoration(block) && Boolean(block.fixedHeight) && contentHeightPx > block.height * PX_MM + 1;
    const horizontalOverflow = Boolean(content && content.scrollWidth > content.clientWidth + 1);
    const overflow = verticalOverflow || horizontalOverflow;
    element.classList.toggle('has-overflow', overflow);
    const badge = element.querySelector('.block-overflow-badge');
    if (badge) { badge.hidden = !overflow; badge.textContent = horizontalOverflow && !verticalOverflow ? '文字超出文本框宽度' : '文字超出文本框'; }
    positions[block.id] = { x, y, width: blockWidth, height: actualHeight, page };
    return { element, actualHeight, contentHeight, overflow, verticalOverflow, horizontalOverflow };
  };
  const validateFrame = (block, result, page, x, y, blockWidth) => {
    if (result.verticalOverflow) warn(block, `“${block[project.language]?.title || '模块'}”的文字超出文本框高度。请增大高度、恢复自动高度或缩短文字后再导出。`);
    if (result.horizontalOverflow) warn(block, `“${block[project.language]?.title || '模块'}”的文字超出文本框宽度。请增大宽度、减小字号或调整内容后再导出。`);
    if (x < 0 || y < 0 || x + blockWidth > width + .2 || y + Math.max(result.actualHeight, result.contentHeight) > height + .2) {
      warn(block, `“${block[project.language]?.title || '装饰'}”超出第 ${page + 1} 页，请调整位置或文本框尺寸。`);
      result.element.classList.add('outside-paper');
    }
  };
  const visibleBlocks = project.blocks.filter(block => !block.hiddenLanguages?.includes(project.language));
  const decorations = visibleBlocks.filter(isDecoration);
  const textBlocks = visibleBlocks.filter(block => !isDecoration(block));
  if (project.mode === 'free') {
    const firstSections=new Set();const sectionIds=new Set();
    if(project.groupSections!==false) for(const block of [...textBlocks].sort((a,b)=>a.page-b.page||a.y-b.y||a.x-b.x)) {
      if(block.kind!=='entry')continue;const key=block.page+':'+(block.column||'main')+':'+block.category;
      if(!firstSections.has(key)){firstSections.add(key);sectionIds.add(block.id);}
    }
    for (const block of [...decorations, ...textBlocks]) {
      const result = add(block, block.page, block.x, block.y, block.width,project.groupSections===false||block.kind!=='entry'||sectionIds.has(block.id));
      validateFrame(block, result, block.page, block.x, block.y, block.width);
    }
  } else {
    const margin = 16, bottom = height - chrome.bottom;
    const sidebar = project.template === 'sidebar' && hasSidebarContent(project);
    const sideWidth = Math.min(53, width * .28), sideBoundary = margin + sideWidth + 10;
    const cursors = { main: { y: margin, page: 0 }, side: { y: margin, page: 0 } };
    const photos = decorations.filter(block => block.kind === 'photo');
    const portrait = photos[0];
    const grouped = project.groupSections !== false;
    const shownSections = new Set();
    if (portrait && !textBlocks.some(block => block.kind === 'profile')) cursors.main.y = margin + portrait.height + 9;
    const flowBlocks = grouped ? groupFlowBlocks(textBlocks) : textBlocks;
    const profile = flowBlocks[0]?.kind === 'profile' ? flowBlocks[0] : null;
    // A narrow main column must not squeeze the name between the sidebar and
    // portrait. Use a header over both columns, keeping the actual photo size.
    const minHeaderWidth = 60;
    const mainHeaderWidth = width - margin - sideBoundary - 5 - (portrait ? portrait.width + 8 : 0);
    const fullHeader = sidebar && portrait && profile && mainHeaderWidth < minHeaderWidth;
    if (fullHeader) {
      const besideWidth = width - margin * 2 - portrait.width - 8;
      const stacked = besideWidth < minHeaderWidth;
      const y = stacked ? margin + portrait.height + 8 : margin;
      const blockWidth = stacked ? width - margin * 2 : besideWidth;
      const result = add(profile, 0, margin, y, blockWidth);
      validateFrame(profile, result, 0, margin, y, blockWidth);
      if (result.actualHeight > bottom - y + .2) warn(profile, `“${profile[project.language]?.title || '模块'}”高于一页，请缩短文字、减小字号或拆成多个模块。`);
      const start = Math.max(y + result.actualHeight, margin + portrait.height) + 9;
      cursors.main.y = start; cursors.side.y = start;
    }
    for (const block of flowBlocks) {
      if (fullHeader && block.id === profile.id) continue;
      const column = sidebar ? flowColumn(block,project.language) : 'main';
      const cursor = cursors[column];
      const headerPhoto = block.kind === 'profile' && cursor.page === 0 ? portrait : null;
      const geometry = page => { const x = column === 'side' || !sidebar || collapsedPages?.has(page) ? margin : sideBoundary + 5; return {x, blockWidth:(column === 'side' ? sideWidth : width - margin - x) - (headerPhoto ? headerPhoto.width + 8 : 0)}; };
      let {x, blockWidth} = geometry(cursor.page);
      const categoryKey = page => page + ':' + column + ':' + block.category;
      const showCategory = page => !grouped || !shownSections.has(categoryKey(page));
      let result = add(block, cursor.page, x, cursor.y, blockWidth, showCategory(cursor.page));
      if (cursor.y + result.actualHeight > bottom && cursor.y > topFor(cursor.page) + .5) {
        result.element.remove(); cursor.page++; cursor.y = topFor(cursor.page);
        ({x, blockWidth} = geometry(cursor.page));
        result = add(block, cursor.page, x, cursor.y, blockWidth, showCategory(cursor.page));
      }
      validateFrame(block, result, cursor.page, x, cursor.y, blockWidth);
      if (result.actualHeight > bottom - topFor(cursor.page) + .2) warn(block, `“${block[project.language]?.title || '模块'}”高于一页，请缩短文字、减小字号或拆成多个模块。`);
      if (block.kind === 'entry') shownSections.add(categoryKey(cursor.page));
      cursor.y += Math.max(result.actualHeight, headerPhoto?.height || 0) + (block.kind === 'profile' ? 9 : effectiveBlockStyle(block,project).sectionSpacing);
    }
    for (const block of decorations) {
      const x = block.kind === 'photo' ? width - margin - block.width : block.x;
      const y = block.kind === 'photo' ? margin : block.y;
      const page=block.kind==='photo'?0:block.page;
      const result = add(block, page, x, y, block.width);
      validateFrame(block, result, page, x, y, block.width);
    }
  }
  pageFor(0);
  // Only saved user choices reflow; pages with side content stay intact.
  if (collapsedPages === null && project.mode === 'flow' && project.template === 'sidebar' && settings.collapsedSidebarPages?.[project.language]?.length) {
    const sidePages = new Set(textBlocks.filter(block => flowColumn(block,project.language)==='side').map(block => positions[block.id]?.page));
    const allowed = new Set(settings.collapsedSidebarPages[project.language].filter(page => page < pages.length && !sidePages.has(page)));
    return renderResume(container, project, {interactive, collapsedPages:allowed});
  }
  const personName = textBlocks.find(block => block.kind === 'profile')?.[project.language]?.title || '';
  pages.forEach((paper,index) => {
    if (index > 0 && settings.continuationHeader) paper.append(create('div', 'document-running-header', personName || (project.language === 'en' ? 'Resume' : '简历')));
    if (settings.pageNumbers) paper.append(create('div', 'document-page-number', `${index + 1} / ${pages.length}`));
  });
  // Only reorder text objects within their existing page. The user's explicit
  // layer and absolute geometry remain unchanged; PDF extraction is checked separately.
  if(project.readingOrderByLanguage?.[project.language]?.length){
    const order=new Map(readingBlocks(project).map((block,index)=>[block.id,index]));
    for(const paper of pages){const all=[...paper.querySelectorAll('.resume-block')],text=all.filter(element=>element.querySelector('.block-content')),sorted=[...text].sort((left,right)=>(order.get(left.dataset.blockId)??1000)-(order.get(right.dataset.blockId)??1000));
      if(sorted.some((element,index)=>element!==text[index])){
        for(const element of sorted)paper.append(element);
      }
    }
  }
  for (const block of visibleBlocks.filter(block => block.kind === 'photo' || block.kind === 'shape' && block.image || project.mode === 'free' && !isDecoration(block))) {
    const frame = positions[block.id];
    if (frame && (frame.page > 0 && settings.continuationHeader && frame.y < chrome.top || settings.pageNumbers && frame.y + frame.height > height - chrome.bottom)) warn(block, `“${block[project.language]?.title || '模块'}”进入页眉或页码保留区。请移动模块，或关闭续页页眉/页码。`);
  }
  let pageStyle = document.querySelector('#paper-size-style');
  if (!pageStyle) { pageStyle = create('style'); pageStyle.id = 'paper-size-style'; document.head.append(pageStyle); }
  pageStyle.textContent = `@page { size: ${width}mm ${height}mm; margin: 0; }`;
  const overlaps = collectTextOverlaps(container, project);
  const overlapped = new Set(overlaps.flatMap(issue => issue.blockIds));
  for (const element of container.querySelectorAll('.resume-block')) element.classList.toggle('has-text-overlap', overlapped.has(element.dataset.blockId));
  return { pages: pages.length, warnings, positions, issueBlockIds, overlaps, collapsedSidebarPages:[...(collapsedPages || [])] };
}
