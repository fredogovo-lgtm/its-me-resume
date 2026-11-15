import {runStateTransaction} from './state-transactions.mjs';
import {offerCrossPageCanvasCopy} from './editor-canvas-copy.mjs';
import {mountSubmissionTools} from './submission.mjs';
import {canvasGroupFor,canvasSelectionIds,preserveCanvasOtherLayout,moveCanvasSelection,duplicateCanvasSelection,deleteCanvasSelection,setFlowColumn} from '../core/canvas-groups.mjs';
import { documentStyle, effectiveBlockStyle, setGlobalDocumentStyle, resetBlockDocumentStyle, formatLinkLines, updateLinkLines } from '../core/document-style.mjs';
import { renderDocumentQuality, previewDocumentQuality } from './document-quality.mjs';
import {openAiDateFormat} from './ai-date-format.mjs';
import {mountDesignTools,mountTemplateDecorations} from './design-tools.mjs';
import { makeBlock } from '../core/model.mjs';
import { markLanguageReviewed } from '../core/bilingual-review.mjs';
import { setBlockText } from '../core/rich-text.mjs';
import { readEditableText } from './rich-text-view.mjs';
import { mountRichTextToolbar } from './rich-editing.mjs';
import { organizeInspector } from './inspector-panels.mjs';
import { mountPersonalTemplates } from './personal-templates.mjs';
import { showPhotoCrop } from './photo.mjs';
import { sourceUpdateNoticeHtml, bindSourceUpdateNotice } from './source-updates.mjs';
import { groupFlowBlocks } from '../core/personal-templates.mjs';
import { placeNewBlockInViewport } from './material-placement.mjs';
import { mountPaginationOptions, paginateSelectedBlock } from './pagination.mjs';
import { $, $$, escape, clone, uid, input, textarea, field, button, categories, icon } from './helpers.mjs';
import { renderResume } from './resume-view.mjs';
import { resizeFrame, placeDraggedFrame, duplicateProjectBlock } from './frame-geometry.mjs';
import { applyLanguageLayout, applyLayoutMode,freezeMeasuredLayout } from './language-layout.mjs';
import { getPeriod, setPeriod } from '../core/entry-content.mjs';
import { enterInlineEditing } from './inline-editing.mjs';
import { renderContentWarning } from './content-check.mjs';
import { renderOverlapWarning, renderLayoutWarning } from './layout-review.mjs';
import { renderTemplateThumbnails } from './template-preview.mjs';
import { mountWorkspacePanels } from './workspace-panels.mjs';
const templates = [{ id: 'classic', name: '清晰简洁', note: '单栏布局，适合常规投递' }, { id: 'sidebar', name: '有序分栏', note: '经历在主栏，教育与技能在侧栏' }, { id: 'blank', name: '空白画布', note: '从自由摆放开始搭建' }];
const papers = { A4: [210, 297], A5: [148, 210], B5: [176, 250], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };
const fonts = ['Microsoft YaHei', 'SimSun', 'DengXian', 'Arial', 'Calibri', 'Georgia'];

let pointerActive = false;
let pendingInlineRefresh;
document.addEventListener('pointerdown', () => { pointerActive = true; }, true);
const finishPointerInteraction = () => {
  pointerActive = false;
  const refresh = pendingInlineRefresh; pendingInlineRefresh = null;
  refresh?.();
};
document.addEventListener('pointerup', finishPointerInteraction, true);
document.addEventListener('pointercancel', finishPointerInteraction, true);
window.addEventListener('blur', finishPointerInteraction);

function refreshAfterInlineEdit(ctx, paperRoot, projectId) {
  const refresh = () => requestAnimationFrame(() => {
    if (!paperRoot.isConnected || ctx.ui.screen !== 'editor' || ctx.project?.id !== projectId) return;
    if (document.activeElement?.matches('.resume-text[contenteditable]')) return;
    const focused = document.activeElement;
    const focusBlockId = focused?.closest('#resume-pages [data-block-id]')?.dataset.blockId;
    const focusControl = focused?.dataset.resize ? '[data-resize="' + focused.dataset.resize + '"]' : focused?.matches('.block-drag') ? '.block-drag' : '';
    refreshCanvas(ctx);
    if (focusBlockId) {
      const article = $('[data-block-id="' + focusBlockId + '"]', paperRoot);
      if (article) (focusControl ? $(focusControl, article) : article)?.focus({ preventScroll: true });
    }
  });
  // A blur can run between mouse-down and click. Keep the clicked controls alive.
  if (pointerActive) pendingInlineRefresh = refresh;
  else refresh();
}

export function renderEditor(ctx) {
  const project = ctx.project;
  if (!project) {
    $('#screen').innerHTML = `<div class="empty-state"><div class="empty-paper">${icon('edit', 44)}</div><h1>从完整经历，做出合适的简历。</h1><p>选择目标岗位，挑选已有资料，再在纸面上调整文字和布局。</p><div class="button-group">${button('建立简历', 'new-project', 'primary')}${button('先完善资料', 'library')}</div>${!ctx.state.library.entries.length ? button('用虚构示例体验', 'sample', 'quiet') : ''}</div>`;
    $('[data-action="new-project"]').onclick = () => ctx.showJobDialog({ isNew: true });
    $('[data-action="library"]').onclick = () => ctx.navigate('library');
    $('[data-action="sample"]')?.addEventListener('click', () => ctx.useSample().catch(error => ctx.notify(error.message, true)));
    return;
  }
  let selected = project.blocks.find(block => block.id === ctx.ui.selectedBlockId && !block.hiddenLanguages?.includes(project.language));
  if (!selected) ctx.ui.selectedBlockId = null;
  const language = project.language;
  $('#screen').innerHTML = `<div class="editor-workspace"><div class="editor-toolbar"><div class="project-tools"><select id="project-picker" aria-label="切换简历">${ctx.state.projects.map(item => `<option value="${item.id}" ${item.id === project.id ? 'selected' : ''}>${escape(item.name)}</option>`).join('')}</select><button class="icon-button" id="new-project" title="建立简历" aria-label="建立简历">${icon('plus', 18)}</button><span class="toolbar-separator"></span><button class="icon-button" id="undo" title="撤销 Ctrl+Z" aria-label="撤销" ${!ctx.canUndo('undo') ? 'disabled' : ''}>${icon('undo', 17)}</button><button class="icon-button" id="redo" title="重做 Ctrl+Shift+Z" aria-label="重做" ${!ctx.canUndo('redo') ? 'disabled' : ''}>${icon('redo', 17)}</button></div><div class="editor-language segmented"><button data-edit-language="zh" class="${language === 'zh' ? 'active' : ''}">中文</button><button data-edit-language="en" class="${language === 'en' ? 'active' : ''}">English</button></div><div class="view-tools"><button type="button" class="button quiet" data-project-ai>AI 辅助</button><div id="workspace-panels"></div><span id="page-count"></span><select id="zoom" aria-label="预览缩放"><option value="fit">适合宽度</option>${[.5, .65, .75, .85, 1].map(value => `<option value="${value}" ${value === ctx.ui.zoom ? 'selected' : ''}>${value * 100}%</option>`).join('')}</select></div></div>${sourceUpdateNoticeHtml(project,ctx.state.library)}<div class="editor-columns"><aside class="editor-left"><div class="editor-tabs">${['content', 'templates', 'materials'].map((key, index) => `<button data-tab="${key}" class="${ctx.ui.editorTab === key ? 'active' : ''}">${['内容', '模板', '素材'][index]}</button>`).join('')}</div><div id="left-panel"></div><div class="left-footer"><span class="offline-dot"></span>所有修改仅保存在本机</div></aside><section class="canvas-area"><div class="canvas-context"><div class="mode-switch segmented"><button data-mode="flow" class="${project.mode === 'flow' ? 'active' : ''}">模板排版</button><button data-mode="free" class="${project.mode === 'free' ? 'active' : ''}">自由摆放</button></div><span>${project.mode === 'free' ? '拖至其它纸张换页，拖动调整点改变尺寸' : '拖动左侧列表调整顺序；拖动纸面文本框进入自由摆放'}</span><label class="snap-setting"><input type="checkbox" id="snap" ${ctx.ui.snap ? 'checked' : ''}>吸附</label></div><div class="canvas-scroll"><div id="scaled-pages"><div id="resume-pages"></div></div></div><div id="content-warning" hidden></div><div id="overlap-warning" class="review-warning" hidden></div><div id="layout-warning" class="layout-warning" hidden></div><div id="document-quality-warning" hidden></div><div class="canvas-footer"><span>${escape(project.paper.name)} / ${project.paper.width} × ${project.paper.height} mm</span><span>双击文字直接修改 · Ctrl+S 保存</span></div></section><aside class="inspector"><div class="inspector-heading"><strong>${selected ? '模块设置' : '纸张与样式'}</strong>${selected ? '<span class="tag">仅当前简历</span>' : ''}</div><div id="inspector-content"></div></aside></div></div>`;
  renderLeft(ctx);
  refreshCanvas(ctx);
  renderInspector(ctx, selected);
  bindSourceUpdateNotice(ctx);
  $('[data-project-ai]').onclick=()=>ctx.openProjectAi?.();
  $('#project-picker').onchange = event => ctx.switchProject(event.target.value).catch(error => ctx.notify(error.message, true));
  $('#new-project').onclick = () => ctx.showJobDialog({ isNew: true });
  $('#undo').onclick = () => ctx.undo(); $('#redo').onclick = () => ctx.undo('redo');
  $$('[data-tab]').forEach(button => button.onclick = () => { ctx.ui.editorTab = button.dataset.tab; ctx.render(); });
  $$('[data-edit-language]').forEach(button => button.onclick = () => switchLanguage(ctx, button.dataset.editLanguage));
  $$('[data-mode]').forEach(button => button.onclick = () => {
    if (button.dataset.mode === ctx.project.mode) return;
    ctx.updateProject(next => applyLayoutMode(next, button.dataset.mode, ctx.layoutResult.positions));
  });
  $('#snap').onchange = event => { ctx.ui.snap = event.target.checked; };
  $('#zoom').value = ctx.ui.zoomMode === 'fit' ? 'fit' : String(ctx.ui.zoom);
  $('#zoom').onchange = event => {
    ctx.ui.zoomMode = event.target.value === 'fit' ? 'fit' : 'manual';
    if (ctx.ui.zoomMode === 'manual') ctx.ui.zoom = Number(event.target.value);
    applyZoom(ctx);
  };
  ctx.canvasResizeObserver = new ResizeObserver(() => {
    if (ctx.ui.zoomMode === 'fit' && $('.canvas-scroll')?.isConnected) applyZoom(ctx);
  });
  ctx.canvasResizeObserver.observe($('.canvas-scroll'));
  const paperRoot = $('#resume-pages');
  paperRoot.onclick = event => {
    if (event.target.closest('a.resume-link')) event.preventDefault();
    if (event.target.closest('[contenteditable]')) return;
    const block = event.target.closest('[data-block-id]');
    const id = block?.dataset.blockId || null;
    if (ctx.ui.selectedBlockId !== id) { ctx.ui.selectedBlockId = id; ctx.render(); }
  };
  paperRoot.ondblclick = event => {
    const text = event.target.closest('.resume-text');
    if (!text) return;
    const block = ctx.project.blocks.find(block => block.id === text.closest('[data-block-id]').dataset.blockId);
    if (!block) return;
    if (block.locked) return ctx.notify('请先在右侧解锁模块');
    enterInlineEditing(text, event);
  };
  paperRoot.addEventListener('input', event => {
    const text = event.target.closest?.('.resume-text[contenteditable]');
    if (!text) return;
    const id = text.closest('[data-block-id]').dataset.blockId, fieldName = text.dataset.field, value = readEditableText(text);
    if (ctx.project.blocks.find(item => item.id === id)?.[ctx.project.language]?.[fieldName] === value) return;
    ctx.updateProject(next => {
      const block = next.blocks.find(item => item.id === id);
      setBlockText(block, next.language, fieldName, value); markStale(block, next.language);
    }, { render: false, history: !text.dataset.inlineEdited });
    text.dataset.inlineEdited = 'true';
    syncInlineControls(ctx, id, fieldName, value);
  });
  paperRoot.addEventListener('blur', event => {
    const text = event.target.closest?.('.resume-text[contenteditable]');
    if (!text) return;
    const id = text.closest('[data-block-id]').dataset.blockId;
    const fieldName = text.dataset.field;
    const value = readEditableText(text);
    text.removeAttribute('contenteditable');
    if (ctx.project.blocks.find(item => item.id === id)?.[ctx.project.language]?.[fieldName] !== value) ctx.updateProject(next => { const block = next.blocks.find(item => item.id === id); setBlockText(block, next.language, fieldName, value); markStale(block, next.language); }, { render: false, history: !text.dataset.inlineEdited });
    syncInlineControls(ctx, id, fieldName, value);
    refreshAfterInlineEdit(ctx, paperRoot, project.id);
  }, true);
  paperRoot.addEventListener('pointerdown', event => beginDrag(ctx, event));
  ctx.workspacePanelsDispose = mountWorkspacePanels(ctx);
}
function syncInlineControls(ctx, id, fieldName, value) {
  const control = $('#block-form [name="' + fieldName + '"]');
  if (ctx.ui.selectedBlockId === id && control && document.activeElement !== control) control.value = value;
  if (fieldName === 'title') {
    const label = $('.block-list-row[data-block="' + id + '"] strong');
    if (label) label.textContent = value || '文字模块';
  }
}
function markStale(block, language) {
  block.stale ||= { zh: false, en: false };
  block.stale[language] = false;
  block.stale[language === 'zh' ? 'en' : 'zh'] = true;
}
function switchLanguage(ctx, language) {
  if (ctx.project.language === language) return;
  ctx.updateProject(project => applyLanguageLayout(project, language));
}
function applyZoom(ctx) {
  const pages = $('#resume-pages'); const wrapper = $('#scaled-pages');
  if (!pages) return;
  if (ctx.ui.zoomMode === 'fit') {
    const scroller = $('.canvas-scroll'), padding = getComputedStyle(scroller);
    const available = Math.max(80, scroller.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight) - 2);
    ctx.ui.zoom = Math.min(1, available / (ctx.project.paper.width * 96 / 25.4));
  }
  pages.style.transform = `scale(${ctx.ui.zoom})`;
  pages.style.transformOrigin = 'top left';
  wrapper.style.width = `${ctx.project.paper.width * 96 / 25.4 * ctx.ui.zoom}px`;
  wrapper.style.height = `${pages.offsetHeight * ctx.ui.zoom}px`;
}
function refreshCanvas(ctx) {
  $$('[data-mode]').forEach(control=>control.classList.toggle('active',control.dataset.mode===ctx.project.mode));
  ctx.layoutResult = renderResume($('#resume-pages'), ctx.project, { interactive: true });
  const selected = $(`#resume-pages [data-block-id="${ctx.ui.selectedBlockId}"]`);
  selected?.classList.add('selected');
  if(ctx.ui.selectedBlockId)for(const id of canvasSelectionIds(ctx.project,ctx.ui.selectedBlockId))$('#resume-pages [data-block-id="'+id+'"]')?.classList.add('canvas-group-selected');
  $('#page-count').textContent = `${ctx.layoutResult.pages} 页`;
  renderLayoutWarning(ctx, $('#layout-warning'));
  renderContentWarning(ctx, $('#content-warning'));
  renderOverlapWarning(ctx, $('#overlap-warning'));
  renderDocumentQuality(ctx, $('#document-quality-warning'));
  const current = ctx.project.blocks.find(block => block.id === ctx.ui.selectedBlockId);
  const autoHeight = $('[data-action="auto-height"]');
  if (autoHeight && current) autoHeight.disabled = Boolean(current.locked || !current.fixedHeight);
  const heightMode = $('[data-height-mode]');
  if (heightMode && current) heightMode.textContent = current.fixedHeight ? '固定高度：文字超出时会提示，并阻止导出。' : '自动高度：随文字换行自动增长。';
  const heightInput = $('#block-form [name="height"]');
  if (heightInput && current && !current.fixedHeight && !['shape','line','photo'].includes(current.kind) && document.activeElement !== heightInput) heightInput.value = (ctx.layoutResult.positions[current.id]?.height || current.height).toFixed(1);
  $('.canvas-footer > span').textContent = ctx.project.paper.name + ' / ' + ctx.project.paper.width + ' × ' + ctx.project.paper.height + ' mm';
  applyZoom(ctx);
}

function renderLeft(ctx) {
  const project = ctx.project;
  const lang = project.language;
  const root = $('#left-panel');
  let visibleBlocks = project.blocks.filter(block => !block.hiddenLanguages?.includes(lang));
  if(project.mode === 'flow' && project.groupSections !== false) visibleBlocks = groupFlowBlocks(visibleBlocks);
  if (ctx.ui.editorTab === 'content') {
    root.innerHTML = `<div class="job-summary"><div><small>目标岗位</small><strong>${escape(project.jobTitle || '尚未指定')}</strong></div>${button('资料选择', 'job', 'quiet')}</div><div class="list-section-heading"><span>当前简历模块</span><small>${visibleBlocks.length}</small></div><div class="block-list">${visibleBlocks.map(block => `<button class="block-list-row ${block.id === ctx.ui.selectedBlockId ? 'selected' : ''}" draggable="true" data-block="${block.id}"><span class="list-grip">${icon(block.locked ? 'lock' : 'grip', 15)}</span><span><strong>${escape(block[lang]?.title || ({ line: '装饰线', shape: '装饰色块', photo: '个人照片' }[block.kind]) || '文字模块')}</strong><small>${block.kind === 'profile' ? '基本信息' : escape(categories[block.category] || (block.kind === 'entry' ? '经历模块' : '自定义素材'))}${block.continuation ? ' · 续' + (block.continuation.index + 1) : ''}</small></span>${block.stale?.[lang] ? '<span class="stale-dot" title="当前语言可能需要更新"></span>' : ''}</button>`).join('')}</div>${project.attachments?.length ? `<div class="selected-attachments"><div class="list-section-heading"><span>已选补充文件</span><small>${project.attachments.length}</small></div>${project.attachments.map(item => `<button class="attachment-preview" data-open-attachment="${escape(item.id)}">${icon('file', 16)}<span>${escape(item.name)}</span></button>`).join('')}<p class="panel-help">随 PDF 另附导出，文件内容不排入纸面。</p></div>` : ''}<div class="left-actions">${button('比较资料来源', 'source-updates', 'quiet')}${button(`${icon('plus', 15)} 添加文字`, 'add-text')}${button('保存并返回资料库', 'library', 'quiet')}</div><p class="panel-help">这里的文字修改只影响当前简历。资料库与其他简历保持原样。</p>`;
    bindSourceUpdateNotice(ctx, root);
    $('[data-action="job"]', root).onclick = () => ctx.showJobDialog({ isNew: false });
    $$('[data-open-attachment]', root).forEach(control => control.onclick = () => { const task = ctx.openAttachment ? ctx.openAttachment(control.dataset.openAttachment) : window.resume.openAttachment(control.dataset.openAttachment); Promise.resolve(task).catch(error => ctx.notify(error.message, true)); });
    $('[data-action="add-text"]', root).onclick = () => addBlock(ctx, 'text');
    $('[data-action="library"]', root).onclick = () => ctx.navigate('library');
    let dragged;
    $$('[data-block]', root).forEach(row => {
      row.onclick = () => { ctx.ui.selectedBlockId = row.dataset.block; ctx.render(); };
      row.ondragstart = event => { dragged = row.dataset.block; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', dragged); };
      row.ondragover = event => { event.preventDefault(); row.classList.add('drag-over'); };
      row.ondragleave = () => row.classList.remove('drag-over');
      row.ondrop = event => {
        event.preventDefault(); row.classList.remove('drag-over');
        if (!dragged || dragged === row.dataset.block) return;
        ctx.updateProject(next => { const from = next.blocks.findIndex(item => item.id === dragged); const to = next.blocks.findIndex(item => item.id === row.dataset.block); const [block] = next.blocks.splice(from, 1); next.blocks.splice(to, 0, block); });
      };
    });
  } else if (ctx.ui.editorTab === 'templates') {
    root.innerHTML = `<p class="panel-help">更换模板保留现有文字。自由位置会单独保留，切回自由摆放即可恢复。</p><div class="template-list">${templates.map(template => `<button class="template-card ${project.template === template.id ? 'selected' : ''}" data-template="${template.id}"><div class="template-mini mini-${template.id}"><i></i><b></b><span></span><span></span><span></span></div><strong>${template.name}</strong><small>${template.note}</small>${project.template === template.id ? `<span class="template-check">${icon('check', 15)}</span>` : ''}</button>`).join('')}</div>`;
    $$('[data-template]', root).forEach(button => button.onclick = () => ctx.updateProject(next => {
      const target = button.dataset.template;
      applyLayoutMode(next, target === 'blank' ? 'free' : 'flow', ctx.layoutResult.positions);
      next.template = target;
    }));
    const personalHost=document.createElement('div'); personalHost.id='personal-templates-placeholder';root.append(personalHost);
    mountPersonalTemplates(ctx,personalHost);
    renderTemplateThumbnails(ctx, root, ctx.project);
  } else {
    root.innerHTML = `<p class="panel-help">添加后，可在自由摆放模式移动位置。颜色、尺寸在右侧调整。</p><div class="material-grid"><button data-material="text"><span class="material-text">T</span>文字模块</button><button data-material="line"><span class="material-line"></span>装饰线</button><button data-material="shape"><span class="material-shape"></span>装饰色块</button></div><p class="panel-help">素材随当前简历保存，导出历史中的可编辑状态也会保留。</p>`;
    $$('[data-material]', root).forEach(button => button.onclick = () => addBlock(ctx, button.dataset.material));
  }
  if(ctx.ui.editorTab==='content')mountSubmissionTools(ctx,root);
  if(ctx.ui.editorTab!=='templates')mountDesignTools(ctx,root,{materials:ctx.ui.editorTab==='materials'});
}
function addBlock(ctx, kind) {
  const block = makeBlock({ id: uid(), category: 'other', period: '', tags: [], zh: { title: kind === 'text' ? '新的文字模块' : '', subtitle: '', body: kind === 'text' ? '在这里填写你希望补充的内容。' : '' }, en: { title: kind === 'text' ? 'Additional information' : '', subtitle: '', body: '' }, stale: { zh: false, en: false } });
  Object.assign(block, { kind, sourceId: null, x: 16, y: 65, width: kind === 'shape' ? 70 : 160, height: kind === 'line' ? .6 : kind === 'shape' ? 18 : 20, background: kind === 'shape' ? '#e6efed' : kind === 'line' ? ctx.project.accent : 'transparent' });
  const placement=placeNewBlockInViewport(ctx,block);
  ctx.updateProject(next => {
    freezeMeasuredLayout(next, ctx.layoutResult.positions);
    next.blocks.push(block);
  });
  placement.afterRender();
}

function renderInspector(ctx, block) {
  const project = ctx.project, lang = project.language, root = $('#inspector-content');
  const decoration = block && ['line', 'shape', 'photo'].includes(block.kind);
  const frame = block && (ctx.layoutResult?.positions[block.id] || block);
  const globalStyle = documentStyle(project), effectiveStyle = block && effectiveBlockStyle(block,project);
  const fontChoices = [...new Set([...fonts, project.fontFamily, block?.fontFamily].filter(Boolean))];
  const select = (name, choices, value, first = '') => `<select name="${name}">${first ? `<option value="">${first}</option>` : ''}${choices.map(([key,label]) => `<option value="${escape(key)}" ${String(value) === String(key) ? 'selected' : ''}>${escape(label)}</option>`).join('')}</select>`;
  const geometryDisabled = block?.locked ? 'disabled' : '';
  const dimensions = block && ['x','y','width','height'].map((key,index) => {
    const minimum = key === 'width' ? decoration ? 2 : 12 : key === 'height' ? decoration ? .4 : 6 : 0;
    return field(['横向位置','纵向位置','宽度','高度'][index], input(key, Number(Number(frame[key]).toFixed(1)), `type="number" min="${minimum}" max="1000" step="0.5" ${geometryDisabled}`));
  }).join('');
  root.innerHTML = `<div id="rich-selection-toolbar"></div>${block ? `<form id="block-form"><div class="inspector-section">${decoration ? (block.kind==='photo'?button('裁剪与形状','crop-project-photo','secondary')+'<p class="panel-help">照片仅用于当前简历，可拖动边框和调整点改变位置及尺寸。</p>':'<p class="panel-help">装饰元素的颜色、位置与尺寸可在下方设置。</p>') : `${field('标题', input('title', block[lang].title, 'maxlength="240"'))}${field('补充说明', input('subtitle', block[lang].subtitle, 'maxlength="500"'))}${field('正文', textarea('body', block[lang].body, 8, 'maxlength="30000"'))}${field('投递链接 · 每行 名称 | URL', textarea('documentLinks',formatLinkLines(block.links,lang),3,'maxlength="25000" placeholder="作品集 | https://example.com"'))}<p class="panel-help">显示名称按当前语言保存；网址、增删链接中英共用。支持http、https和mailto，PDF保留当前语言显示名和完整目标。</p><p class="document-style-status" data-document-link-error role="status"></p>${block.kind === 'entry' ? field('时间', input('period', getPeriod(block, lang), 'maxlength="120"')) : ''}<div class="local-edit-note">修改仅用于当前简历。双击纸面文字，可改写或选中文字设置样式。</div><div class="pagination-actions">${button('按页面拆分正文', 'split-pages', 'secondary', block.locked ? 'disabled' : '')}<p class="panel-help">长正文按当前纸张拆为续框，可一次撤销；另一语言完整保留在首框。</p></div><div class="language-review"><span>${block.stale?.[lang] ? '当前语言可能需要更新' : '中英内容可独立编辑'}</span>${block.stale?.[lang] ? button('已核对', 'review-project-language', 'quiet') : ''}${button(lang === 'zh' ? '查看英文' : '查看中文', 'other-language', 'quiet')}</div>`}</div><div class="inspector-section"><h3>${decoration ? '外观' : '模块样式'}</h3>${!decoration ? `<p class="panel-help">以下样式作用于整个文字模块。</p>${field('模块字体', select('fontFamily', fontChoices.map(font => [font,font]), block.fontFamily, '跟随简历字体'))}<div class="form-grid compact">${field('字号 / pt', input('fontSize', effectiveStyle?.fontSize || project.fontSize, 'type="number" min="6" max="48" step="0.5"'))}${field('文字颜色', input('color', block.color || '#26343f', 'type="color"'))}${field('字重', select('fontWeight', [[400,'常规'],[700,'粗体']], block.fontWeight, '跟随模板'))}${field('字形', select('fontStyle', [['normal','正常'],['italic','斜体']], block.fontStyle || 'normal'))}${field('下划线', select('textDecoration', [['none','无'],['underline','下划线']], block.textDecoration || 'none'))}${field('对齐', select('textAlign', [['left','左对齐'],['center','居中'],['right','右对齐'],['justify','两端对齐']], block.textAlign || 'left'))}${field('行高 / 倍', input('lineHeight', effectiveStyle.lineHeight, 'type="number" min="1" max="2.5" step="0.05"'))}${field('模块后间距 / mm',input('sectionSpacing',effectiveStyle.sectionSpacing,'type="number" min="0" max="30" step="0.5"'))}</div><p class="document-style-status" data-block-style-status>${effectiveStyle.inheritedFontSize?'字号跟随全局':'字号单独设置'} · ${block.lineHeight===undefined?'行距跟随全局':'行距单独设置'} · ${block.sectionSpacing===undefined?'间距跟随全局':'间距单独设置'}</p>${button('字号/行距/间距跟随全局','reset-document-style','quiet')}` : block.kind==='photo'?'<p class="panel-help">使用照片取景控制外观。</p>':field('填充颜色', input('background', block.background || project.accent, 'type="color"'))}</div><div class="inspector-section"><h3>文本框位置与尺寸 <small>mm</small></h3>${project.mode === 'flow' && !decoration ? '<p class="muted">模板自动排版。拖动纸面边框或调整点，会保留各模块当前位置并进入自由摆放。</p>' : `<div class="form-grid compact">${dimensions}${field('所在页', input('page', block.page + 1, `type="number" min="1" max="50" step="1" ${geometryDisabled}`))}</div>`}${!decoration ? `<p class="panel-help" data-height-mode>${block.fixedHeight ? '固定高度：文字超出时会提示，并阻止导出。' : '自动高度：随文字换行自动增长。'}</p>${button('恢复自动高度', 'auto-height', 'quiet', `${block.locked || !block.fixedHeight ? 'disabled' : ''}`)}` : ''}<label class="check-row"><input name="locked" type="checkbox" ${block.locked ? 'checked' : ''}>锁定位置、尺寸与纸面文字</label></div><div class="inspector-section button-group">${button(block.kind === 'photo' ? '复制照片（当前语言）' : '复制模块', 'duplicate-block', 'secondary')}${button('删除', 'delete-block', 'quiet danger')}</div></form>` : `<div class="inspector-intro">${icon('edit', 28)}<p>选中纸面文本框，调整内容、模块样式或位置尺寸。</p></div>`}<form id="page-form"><div class="inspector-section"><h3>简历设置</h3>${field('简历名称', input('name', project.name, 'maxlength="120" required'))}${field('纸张', `<select name="paperName">${Object.keys(papers).map(key => `<option value="${key}" ${project.paper.name === key ? 'selected' : ''}>${key}</option>`).join('')}<option value="custom" ${!papers[project.paper.name] ? 'selected' : ''}>自定义</option></select>`)}<div class="form-grid compact">${field('宽 / mm', input('paperWidth', project.paper.width, 'type="number" min="100" max="500" step="0.1"'))}${field('高 / mm', input('paperHeight', project.paper.height, 'type="number" min="120" max="700" step="0.1"'))}</div>${field('字体', select('fontFamily', fontChoices.map(font => [font,font]), project.fontFamily))}${field('主题色', input('accent', project.accent, 'type="color"'))}<div class="form-grid compact">${field('全局字号 / pt',input('documentFontSize',project.fontSize,'type="number" min="6" max="48" step="0.5"'))}${field('全局行高 / 倍',input('documentLineHeight',globalStyle.lineHeight,'type="number" min="1" max="2.5" step="0.05"'))}${field('全局模块后间距 / mm',input('documentSectionSpacing',globalStyle.sectionSpacing,'type="number" min="0" max="30" step="0.5"'))}${field('目标页数 · 0不限定',input('documentTargetPages',globalStyle.targetPages,'type="number" min="0" max="50" step="1"'))}</div><p class="panel-help">全局字号是实际打印字号；顶部缩放只影响屏幕。明确设置过的模块字号、行距与选中文字样式保持独立。模块后间距用于模板排版。</p><label class="check-row"><input type="checkbox" name="documentContinuationHeader" ${globalStyle.continuationHeader?'checked':''}>续页显示姓名页眉</label><label class="check-row"><input type="checkbox" name="documentPageNumbers" ${globalStyle.pageNumbers?'checked':''}>纸面及PDF显示页码</label><label class="check-row"><input type="checkbox" name="documentContinuationMarkers" ${globalStyle.continuationMarkers?'checked':''}>拆分续框显示“续”标记</label>${button('预览紧凑排版/收起空侧栏','preview-document-quality','quiet')}<label class="check-row"><input type="checkbox" name="groupSections" ${project.groupSections!==false?'checked':''}>同类经历合并章节</label><p class="panel-help">模板排版按分类组织，同一页同栏只显示一次标题；自由摆放保留手动位置。</p>${Object.entries(categories).map(([key,label])=>field(label+' · 章节标题',input('section_'+key,project.sectionTitles?.[lang]?.[key]||'','maxlength="80" placeholder="使用默认标题"'))).join('')}</div></form><div class="inspector-section"><button class="button quiet danger" id="delete-project">删除当前项目</button></div>`;
  const blockForm = $('#block-form');
  if (blockForm) {
    if(block.kind==='entry'){const dates=document.createElement('button');dates.type='button';dates.className='button quiet';dates.dataset.projectDates='';dates.textContent='整理时间格式（本机）';blockForm.elements.period.closest('.field').append(dates);dates.onclick=async()=>{await ctx.flush();openAiDateFormat(ctx,{scope:'project',ids:[block.id],language:lang});};}
    if(!decoration&&block.kind!=='profile'){
      const wrapper=document.createElement('label');wrapper.className='field';wrapper.innerHTML='<span>模板内栏位 · 当前语言</span><select name="flowColumn"><option value="auto">按模板自动</option><option value="main">主栏</option><option value="side">侧栏</option></select><small class="panel-help">有序分栏模板生效；单栏模板继续使用主栏，不会切换为自由摆放。</small>';wrapper.querySelector('select').value=block.flowColumnByLanguage?.[lang]||'auto';if(block.locked)wrapper.querySelector('select').disabled=true;blockForm.querySelector('.inspector-section').append(wrapper);
    }
    const selectedGroup=canvasGroupFor(project,block.id);if(selectedGroup){const note=document.createElement('p');note.className='panel-help';note.textContent='当前模块属于 '+selectedGroup.blockIds.length+' 项分组。拖动会移动整组；复制和删除作用于整组的当前语言。调整尺寸仅作用于此成员。';blockForm.prepend(note);$('[data-action="duplicate-block"]').textContent='复制分组（当前语言）';$('[data-action="delete-block"]').textContent='删除分组（当前语言）';}
    blockForm.onsubmit = event => event.preventDefault();
    blockForm.addEventListener('focusin', event => { if (event.target.dataset) delete event.target.dataset.edited; });
    blockForm.oninput = event => {
      const control = event.target, key = control.name;
      if (!key) return;
      if (ctx.project.blocks.find(item => item.id === block.id)?.locked && ['x','y','width','height','page'].includes(key)) return;
      let value = control.type === 'checkbox' ? control.checked : control.value;
      if (key === 'documentLinks') {
        try { value = updateLinkLines(value,ctx.project.blocks.find(item=>item.id===block.id)?.links || [],lang,11); control.setCustomValidity(''); $('[data-document-link-error]').textContent = ''; } catch (error) { control.setCustomValidity(error.message); $('[data-document-link-error]').textContent = error.message; return; }
      }
      if (control.type === 'number') {
        if (!control.value) return;
        value = Number(value); if (!Number.isFinite(value)) return;
        value = Math.max(Number(control.min || 0), Math.min(Number(control.max || 1000), value));
        if (key === 'page') value = Math.round(value) - 1;
      } else if (key === 'fontWeight' && value !== '') value = Number(value);
      const history = !control.dataset.edited; control.dataset.edited = 'true';
      try{ctx.updateProject(next => {
        const target = next.blocks.find(item => item.id === block.id);
        if(target.kind==='photo'&&['x','y','width','height','page'].includes(key))freezeMeasuredLayout(next,ctx.layoutResult.positions);
        if (['title','subtitle','body'].includes(key)) { if (target[lang][key] !== value) { setBlockText(target, lang, key, value); markStale(target, lang); } }
        else if (key === 'flowColumn') setFlowColumn(next,target.id,value);
        else if (canvasGroupFor(next,target.id)&&['x','y','width','height','page'].includes(key)){preserveCanvasOtherLayout(next);freezeMeasuredLayout(next,ctx.layoutResult.positions);moveCanvasSelection(next,target.id,{...target,[key]:value},{resize:['width','height'].includes(key)});if(key==='height'&&!decoration)target.fixedHeight=true;}
        else if (key === 'documentLinks') target.links = value;
        else if (key === 'period') { if (getPeriod(target, lang) !== value) { setPeriod(target, lang, value); markStale(target, lang); } }
        else if (['fontFamily','fontWeight'].includes(key) && value === '') delete target[key];
        else { target[key] = value; if (key === 'fontSize') target.fontSizeMode = 'override'; if (key === 'height' && !decoration) target.fixedHeight = true; }
      }, { render: false, history });}catch(error){ctx.notify(error.message,true);const original=ctx.layoutResult.positions[block.id]||block;if(['x','y','width','height','page'].includes(key))control.value=key==='page'?original.page+1:original[key];return;}
      refreshCanvas(ctx);
      if (['fontSize','lineHeight','sectionSpacing'].includes(key)) $('[data-block-style-status]').textContent = '已设置模块样式；可随时恢复跟随全局';
      if (key === 'locked') ctx.render();
    };
    $('[data-action="crop-project-photo"]')?.addEventListener('click',()=>showPhotoCrop(ctx,ctx.project.blocks.find(item=>item.id===block.id).photo,photo=>ctx.updateProject(next=>{next.blocks.find(item=>item.id===block.id).photo=photo;})));
    $('[data-action="reset-document-style"]')?.addEventListener('click', () => ctx.updateProject(next => resetBlockDocumentStyle(next.blocks.find(item => item.id === block.id))));
    $('[data-action="split-pages"]')?.addEventListener('click', () => paginateSelectedBlock(ctx));
    $('[data-action="review-project-language"]')?.addEventListener('click', () => ctx.updateProject(next => { markLanguageReviewed(next.blocks.find(item => item.id === block.id), lang); }));
    $('[data-action="other-language"]')?.addEventListener('click', () => switchLanguage(ctx, lang === 'zh' ? 'en' : 'zh'));
    $('[data-action="auto-height"]')?.addEventListener('click', () => ctx.updateProject(next => { next.blocks.find(item => item.id === block.id).fixedHeight = false; }));
    $('[data-action="duplicate-block"]').onclick = () => {
      if(offerCrossPageCanvasCopy(ctx,block.id))return;
      try{if(canvasGroupFor(ctx.project,block.id)){ctx.updateProject(next=>{preserveCanvasOtherLayout(next);freezeMeasuredLayout(next,ctx.layoutResult.positions);const copied=duplicateCanvasSelection(next,block.id),ids=new Set(next.blocks.map(item=>item.id));ctx.ui.selectedBlockId=copied.blocks.find(item=>!ids.has(item.id))?.id;Object.assign(next,copied);});}else{const id = uid();ctx.ui.selectedBlockId = id;ctx.updateProject(next => duplicateProjectBlock(next, block.id, id, ctx.layoutResult.positions));}}catch(error){ctx.notify(error.message,true);}
    };
    $('[data-action="delete-block"]').onclick = () => {try{ctx.updateProject(next=>{if(canvasGroupFor(next,block.id))Object.assign(next,deleteCanvasSelection(next,block.id));else next.blocks=next.blocks.filter(item=>item.id!==block.id);ctx.ui.selectedBlockId=null;});}catch(error){ctx.notify(error.message,true);}};
  }
  const pageForm = $('#page-form');
  pageForm.onsubmit = event => event.preventDefault();
  pageForm.addEventListener('focusin', event => { if (event.target.dataset) delete event.target.dataset.edited; });
  $('[data-action="preview-document-quality"]')?.addEventListener('click',()=>previewDocumentQuality(ctx));
  pageForm.oninput = event => {
    const control = event.target, key = control.name; if (!key) return;
    let value = control.type==='checkbox'?control.checked:control.value;
    if (['paperWidth', 'paperHeight','documentFontSize','documentLineHeight','documentSectionSpacing','documentTargetPages'].includes(key)) { value = Number(value); if (!Number.isFinite(value) || value < Number(control.min) || value > Number(control.max)) return; }
    if (key === 'documentTargetPages' && !Number.isInteger(value)) return;
    if (key === 'name' && !value.trim()) return;
    const history = !control.dataset.edited; control.dataset.edited = 'true';
    ctx.updateProject(next => {
      if (key === 'paperName') {
        if (value === 'custom') next.paper.name = 'custom';
        else next.paper = { name: value, width: papers[value][0], height: papers[value][1] };
      } else if (key === 'paperWidth' || key === 'paperHeight') { next.paper[key === 'paperWidth' ? 'width' : 'height'] = value; next.paper.name = 'custom'; }
      else if (key.startsWith('document')) { const keys = {documentFontSize:'fontSize',documentLineHeight:'lineHeight',documentSectionSpacing:'sectionSpacing',documentTargetPages:'targetPages',documentContinuationHeader:'continuationHeader',documentPageNumbers:'pageNumbers',documentContinuationMarkers:'continuationMarkers'}; if (keys[key]) setGlobalDocumentStyle(next,{[keys[key]]:value}); }
      else if(key.startsWith('section_')){next.sectionTitles||={};next.sectionTitles[lang]||={};next.sectionTitles[lang][key.slice(8)]=value;}
      else next[key] = value;
    }, { render: false, history });
    refreshCanvas(ctx);
    if (key === 'groupSections') {ctx.render();return;}
    if (key === 'paperName') { pageForm.elements.paperWidth.value = ctx.project.paper.width; pageForm.elements.paperHeight.value = ctx.project.paper.height; }
  };
  $('#delete-project').onclick = async () => {
    if (!confirm('删除当前简历项目？资料库和已导出的 PDF 保持不变。')) return;
    try {const id=ctx.project.id;await runStateTransaction(ctx,'正在删除当前简历',async()=>{await ctx.flush();ctx.merge(await window.resume.deleteProject(id));ctx.forgetProject?.(id);ctx.ui.selectedBlockId=null;ctx.render();}); } catch (error) { ctx.notify(error.message, true); }
  };
  mountRichTextToolbar(ctx, $('#rich-selection-toolbar'));
  mountPaginationOptions(ctx);
  organizeInspector(ctx, block);
  mountTemplateDecorations(ctx,$('#page-form'));
}

function beginDrag(ctx, event) {
  if (event.button !== 0) return;
  let handle = event.target.closest('.block-resize, .block-drag, .block-frame-edge');
  if (!handle) return;
  const id = handle.closest('[data-block-id]').dataset.blockId;
  const block = ctx.project.blocks.find(item => item.id === id);
  if (!block || block.locked) return;
  const memberIds=canvasSelectionIds(ctx.project,id);
  if(memberIds.some(member=>ctx.project.blocks.find(item=>item.id===member)?.locked)){ctx.notify('分组中有锁定成员，请先解锁或解组。',true);return;}
  event.preventDefault(); event.stopPropagation();
  const direction = handle.dataset.resize || null;
  if (document.activeElement?.matches('.resume-text[contenteditable]')) {
    document.activeElement.blur();
    const article = $('#resume-pages [data-block-id="' + id + '"]');
    handle = direction ? $('[data-resize="' + direction + '"]', article) : $('.block-drag', article);
  }
  const element = handle.closest('[data-block-id]'), scroller = $('.canvas-scroll');
  const positions = clone(ctx.layoutResult.positions), laidOut = positions[id] || block;
  const startFrame = {x:laidOut.x,y:laidOut.y,width:laidOut.width,height:laidOut.height,page:laidOut.page??block.page};
  const start = {x:event.clientX,y:event.clientY}, mmPerPx=25.4/96/ctx.ui.zoom;
  const paperBox=element.closest('.resume-paper').getBoundingClientRect();
  const grip={x:(start.x-paperBox.left)*mmPerPx-startFrame.x,y:(start.y-paperBox.top)*mmPerPx-startFrame.y};
  const decoration=['shape','line','photo'].includes(block.kind);
  let frame=startFrame,moved=false,finished=false,validDrop=true,ghost,scrollFrame,lastPointer=start;const groupGhosts=[];
  ctx.ui.selectedBlockId=id;
  $$('#resume-pages .resume-block.selected').forEach(item=>item.classList.remove('selected'));
  element.classList.add('selected','dragging');
  $$('.block-list-row').forEach(item=>item.classList.toggle('selected',item.dataset.block===id));
  renderInspector(ctx,block);
  $('.inspector-heading').innerHTML='<strong>模块设置</strong><span class="tag">仅当前简历</span>';
  handle.setPointerCapture(event.pointerId);
  const papers=()=>$$('#resume-pages .resume-paper').map((paper,page)=>{const rect=paper.getBoundingClientRect();return{page,left:rect.left,top:rect.top,width:rect.width,height:rect.height};});
  const updateMove=pointer=>{
    const options={snap:ctx.ui.snap&&!pointer.altKey,minWidth:decoration?2:12,minHeight:decoration ? .4 : 6};
    if(direction) {
      frame=resizeFrame(startFrame,direction,(pointer.x-start.x)*mmPerPx,(pointer.y-start.y)*mmPerPx,options);
      element.style.left=frame.x+'mm';element.style.top=frame.y+'mm';element.style.width=frame.width+'mm';element.style.height=frame.height+'mm';
      if(memberIds.length>1)try{moveCanvasSelection(clone(ctx.project),id,frame,{positions,resize:true});validDrop=true;}catch{validDrop=false;}
      if(!decoration)element.classList.add('has-fixed-height');
      const content=$('.block-content',element);
      const vertical=content&&Math.max(content.offsetHeight,content.scrollHeight)>frame.height*96/25.4+1,horizontal=content&&content.scrollWidth>content.clientWidth+1;
      element.classList.toggle('has-overflow',Boolean(vertical||horizontal));
      const badge=$('.block-overflow-badge',element);if(badge){badge.hidden=!(vertical||horizontal);badge.textContent=horizontal&&!vertical?'文字超出文本框宽度':'文字超出文本框';}
    } else {
      const bounds=scroller.getBoundingClientRect(),inside=pointer.x>=bounds.left&&pointer.x<=bounds.right&&pointer.y>=bounds.top&&pointer.y<=bounds.bottom;
      const target=inside?placeDraggedFrame(startFrame,pointer,papers(),ctx.project.paper,grip,options):null;
      validDrop=Boolean(target);if(target)frame=target;
      if(target&&memberIds.length>1)try{moveCanvasSelection(clone(ctx.project),id,target,{positions});}catch{validDrop=false;}
      $$('#resume-pages .resume-paper').forEach((paper,page)=>paper.classList.toggle('drop-target',Boolean(target&&target.page===page)));
      if(!ghost){
        ghost=element.cloneNode(true);ghost.removeAttribute('data-block-id');ghost.classList.add('drag-preview');ghost.classList.remove('selected');
        ghost.style.fontFamily=getComputedStyle(element).fontFamily;ghost.style.setProperty('--resume-accent',ctx.project.accent);ghost.style.transform='scale('+ctx.ui.zoom+')';ghost.style.width=startFrame.width+'mm';
        document.body.append(ghost);element.classList.add('drag-origin');
        for(const memberId of memberIds.filter(member=>member!==id)){const original=$('#resume-pages [data-block-id="'+memberId+'"]'),position=positions[memberId];if(!original||!position)continue;const preview=original.cloneNode(true);preview.removeAttribute('data-block-id');preview.classList.add('drag-preview');preview.style.fontFamily=getComputedStyle(original).fontFamily;preview.style.setProperty('--resume-accent',ctx.project.accent);preview.style.transform='scale('+ctx.ui.zoom+')';preview.style.width=position.width+'mm';document.body.append(preview);original.classList.add('drag-origin');groupGhosts.push({original,preview,position});}

      }
      const rect=target?papers()[target.page]:null;
      ghost.style.left=(rect?rect.left+frame.x/mmPerPx:pointer.x-grip.x/mmPerPx)+'px';
      ghost.style.top=(rect?rect.top+frame.y/mmPerPx:pointer.y-grip.y/mmPerPx)+'px';
      ghost.classList.toggle('invalid-drop',!validDrop);
      for(const member of groupGhosts){member.preview.style.left=(parseFloat(ghost.style.left)+(member.position.x-startFrame.x)/mmPerPx)+'px';member.preview.style.top=(parseFloat(ghost.style.top)+(member.position.y-startFrame.y)/mmPerPx)+'px';member.preview.classList.toggle('invalid-drop',!validDrop);}
    }
    for(const key of ['x','y','width','height']){const input=$('#block-form [name="'+key+'"]');if(input)input.value=frame[key].toFixed(1);}
    const pageInput=$('#block-form [name="page"]');if(pageInput&&frame.page!==undefined)pageInput.value=frame.page+1;
  };
  const scroll=()=>{
    if(finished||!moved||direction)return;
    const box=scroller.getBoundingClientRect(),p=lastPointer;
    if(p.x>=box.left&&p.x<=box.right&&p.y>=box.top&&p.y<=box.bottom){
      const velocity=p.y<box.top+38?-Math.ceil((box.top+38-p.y)/3):p.y>box.bottom-38?Math.ceil((p.y-box.bottom+38)/3):0;
      if(velocity){const before=scroller.scrollTop;scroller.scrollTop+=velocity;if(before!==scroller.scrollTop)updateMove(p);}
    }
    scrollFrame=requestAnimationFrame(scroll);
  };
  const move=pointer=>{
    lastPointer={x:pointer.clientX,y:pointer.clientY,altKey:pointer.altKey};
    if(!moved&&Math.hypot(pointer.clientX-start.x,pointer.clientY-start.y)<2)return;
    if(!moved){moved=true;if(!direction)scrollFrame=requestAnimationFrame(scroll);}
    updateMove(lastPointer);
  };
  const clean=()=>{
    handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',cancel);handle.removeEventListener('lostpointercapture',cancel);document.removeEventListener('keydown',escapeDrag);
    cancelAnimationFrame(scrollFrame);ghost?.remove();for(const member of groupGhosts){member.preview.remove();member.original.classList.remove('drag-origin');}$$('#resume-pages .drop-target').forEach(p=>p.classList.remove('drop-target'));
    if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);
    element.classList.remove('dragging','drag-origin');
  };
  const end=pointer=>{
    if(finished)return;
    if(moved&&!direction)updateMove({x:pointer.clientX,y:pointer.clientY,altKey:pointer.altKey});
    finished=true;clean();
    if(!moved||!validDrop){ctx.render();if(moved&&!validDrop)ctx.notify(memberIds.length>1?'请将整组放在同一张纸内，已恢复原位置':'请将模块放在纸张内，已恢复原位置');return;}
    ctx.updateProject(next=>{
      preserveCanvasOtherLayout(next);freezeMeasuredLayout(next,positions);
      next.mode='free';const target=next.blocks.find(item=>item.id===id);if(memberIds.length>1)moveCanvasSelection(next,id,frame,{resize:Boolean(direction)});else Object.assign(target,frame);
      if(direction&&!decoration)target.fixedHeight=true;
    });
    $('#resume-pages [data-block-id="'+id+'"]')?.scrollIntoView({block:'nearest',inline:'nearest'});
  };
  const cancel=()=>{if(finished)return;finished=true;clean();ctx.render();};
  const escapeDrag=keyEvent=>{if(keyEvent.key==='Escape'){keyEvent.preventDefault();cancel();}};
  handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',cancel);handle.addEventListener('lostpointercapture',cancel);document.addEventListener('keydown',escapeDrag);
}

// Kept as a compatibility entry for older callers; creation has one shared wizard.
export function showJobDialog(ctx, options = {}) {
  return ctx.startWizard(options);
}
