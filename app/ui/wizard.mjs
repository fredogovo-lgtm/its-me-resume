import {confirmPersonalTemplateImpact,renderPersonalTemplateImpact} from './personal-template-review.mjs';
import {experienceFilterHtml,bindExperienceFilters,experiencePreviewHtml} from './experience-controls.mjs';
import {attachmentSelectionWarnings,entryDisplay} from '../core/library-experience.mjs';
import {buildPersonLinks,personWebsiteLabel,linkLabel} from '../core/document-style.mjs';
import { saveWizardDraft, loadWizardDraft, clearWizardDraft } from './wizard-drafts.mjs';
import { $, $$, escape, input, textarea, field, button, categories, icon } from './helpers.mjs';
import { renderResume, measureTextBlock } from './resume-view.mjs';
import { entryLanguageStatus } from '../core/content-check.mjs';
import { getPeriod } from '../core/entry-content.mjs';
import { renderTemplateThumbnails } from './template-preview.mjs';
import { applyLanguageLayout, applyLayoutMode } from './language-layout.mjs';
import { jobPresets } from './jobs.mjs';
import { createWizardDraft, initializeSelection, recommendSelection, createWizardProject, updateWizardProject, selectionEntries, selectionAttachments, personFields, wizardPhotoState } from './wizard-model.mjs';

const fieldLabels = { name: '姓名', headline: '个人简介 / 求职方向', city: '所在城市', email: '邮箱', phone: '电话', website: '个人网站' };
const templates = [
  { id: 'classic', name: '经典单栏', note: '清晰阅读，适合常规投递' },
  { id: 'sidebar', name: '有序分栏', note: '主栏讲经历，侧栏放技能与教育' },
  { id: 'blank', name: '空白画布', note: '已选资料先排好，可自由调整位置' },
];
const currentProject = (ctx, draft) => draft.isNew ? null : ctx.state.projects.find(project => project.id === draft.projectId);
const checked = value => value ? 'checked' : '';
const sizeLabel = bytes => bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.ceil(bytes / 1024)) + ' KB';
const languageNames = { zh: '中文', en: '英文' };
const textFieldNames = { title: '标题', subtitle: '补充说明', body: '正文' };
const localizedPersonFields = ['name', 'headline', 'city'];
const personValue = (person, key, language) => String(localizedPersonFields.includes(key) ? person[language]?.[key] || '' : key==='website' ? (personWebsiteLabel(person,language)||person.website||buildPersonLinks(person).map(link=>linkLabel(link,language)).join('、')) : person[key] || '').trim();
const otherLanguage = language => language === 'zh' ? 'en' : 'zh';
function entryLanguageNote(entry, language) {
  const status = entryLanguageStatus(entry, language);
  if (status.hidden) return '';
  if (status.missingFields.length) return '尚未填写' + languageNames[language] + status.missingFields.map(key => textFieldNames[key]).join('、') + '，可在预览中补写。';
  return status.empty ? languageNames[language] + '版暂无文字，可在预览中补写。' : '';
}

export function startWizard(ctx, { isNew = true, fresh = false } = {}) {
  const saved = ctx.ui.wizard || loadWizardDraft(ctx);
  if (!fresh && saved && saved.isNew === isNew && (isNew || saved.projectId === ctx.project?.id)) {
    ctx.ui.wizard = saved; ctx.ui.screen = 'wizard'; saveWizardDraft(ctx); ctx.render(); return;
  }
  ctx.ui.wizard = createWizardDraft(ctx.state.library, { project: isNew ? null : ctx.project });
  ctx.ui.screen = 'wizard';
  ctx.render();
}

export function renderWizard(ctx) {
  if (!ctx.ui.wizard) ctx.ui.wizard = createWizardDraft(ctx.state.library);
  const draft = ctx.ui.wizard;
  saveWizardDraft(ctx, draft);
  const root = $('#screen');
  const steps = ['岗位方向', '资料与模板', '预览制作'];
  root.innerHTML = '<div class="wizard-page"><div class="wizard-heading"><div><h1>' + (draft.step === 1 ? '选择岗位方向' : '选择资料与模板') + '</h1><p>' + (draft.step === 1 ? '可以先选岗位，让本地关键词帮你筛选经历；也可以直接开始。' : '勾选要用的资料，选一个起始模板，再到纸面上继续调整。') + '</p></div></div><ol class="wizard-stepper" aria-label="建立简历进度">' + steps.map((label, index) => '<li class="' + (draft.step === index + 1 ? 'active' : index + 1 < draft.step ? 'complete' : '') + '"' + (draft.step === index + 1 ? ' aria-current="step"' : '') + '><span>' + (index + 1) + '</span>' + label + '</li>').join('') + '</ol><div id="wizard-content"></div></div>';
  if (draft.step === 1) renderRoleStep(ctx, $('#wizard-content', root));
  else renderSelectionStep(ctx, $('#wizard-content', root));
}

function captureRole(form, draft, ctx) {
  draft.jobPreset = form.elements.jobPreset.value;
  draft.jobTitle = form.elements.jobTitle.value;
  draft.jobDescription = form.elements.jobDescription.value;
  saveWizardDraft(ctx, draft);
}
function renderRoleStep(ctx, root) {
  const draft = ctx.ui.wizard;
  root.innerHTML = '<form id="wizard-role-form"><div class="wizard-grid wizard-role-grid"><section class="wizard-section"><div class="section-heading"><h2>这次想申请什么岗位？</h2><span class="tag">可跳过</span></div>' + field('岗位类别', '<select name="jobPreset"><option value="">选择常见岗位，或自行填写</option>' + jobPresets.map(preset => '<option value="' + preset.id + '" ' + (draft.jobPreset === preset.id ? 'selected' : '') + '>' + preset.name + '</option>').join('') + '</select>') + field('目标岗位', input('jobTitle', draft.jobTitle, 'maxlength="160" placeholder="例如：产品经理、数据分析师"')) + field('招聘要求 / JD', textarea('jobDescription', draft.jobDescription, 8, 'maxlength="30000" placeholder="可粘贴招聘要求，也可以只填写岗位名称。"')) + '</section><aside class="wizard-section wizard-explainer"><div class="wizard-explainer-icon">' + icon('check', 28) + '</div><h2>经历由你决定</h2><p>选择岗位后，按本地关键词推荐经历；也可跳过，直接挑选资料。</p></aside></div><div class="wizard-footer"><div>' + button(draft.isNew ? '返回资料库' : '返回编辑', 'wizard-cancel', 'quiet') + '</div><div class="button-group">' + button('暂时跳过', 'wizard-skip', 'secondary') + '<button type="submit" class="button primary" data-action="wizard-next">下一步：选择资料 ' + icon('arrow', 16) + '</button></div></div></form>';
  const form = $('#wizard-role-form', root);
  const ai=document.createElement('button');ai.type='button';ai.className='button quiet';ai.dataset.wizardAiRole='';ai.textContent='用 AI 分析岗位';form.querySelector('.wizard-footer > .button-group').prepend(ai);ai.onclick=()=>{captureRole(form,draft,ctx);ctx.openWizardAi?.('role');};
  form.oninput = () => captureRole(form, draft, ctx);
  form.elements.jobPreset.onchange = () => {
    const preset = jobPresets.find(item => item.id === form.elements.jobPreset.value);
    if (preset) form.elements.jobTitle.value = preset.name;
    captureRole(form, draft, ctx);
  };
  const advance = skip => {
    captureRole(form, draft, ctx);
    if (skip) Object.assign(draft, { jobPreset: '', jobTitle: '', jobDescription: '' });
    ctx.ui.wizard = initializeSelection(ctx.state.library, draft);
    ctx.ui.wizard.step = 2;
    ctx.render();
  };
  form.onsubmit = event => { event.preventDefault(); advance(false); };
  $('[data-action="wizard-skip"]', root).onclick = () => advance(true);
  $('[data-action="wizard-cancel"]', root).onclick = () => ctx.navigate(draft.isNew ? 'library' : 'editor');
}

export function captureSelection(form, draft, ctx) {
  const data = new FormData(form),previousLanguage=form.dataset?.selectionLanguage||draft.language||'zh';
  // Filtering/sorting moves nodes, but DOM order is not the user's content order.
  const checkedEntries = new Set(data.getAll('entryId'));
  const sourceIds = selectionEntries(ctx.state.library, currentProject(ctx, draft)).map(entry => entry.id);
  draft.entryIds = [...new Set([...(draft.entryIds || []), ...sourceIds])].filter(id => checkedEntries.has(id));
  draft.personFields = data.getAll('personField');
  draft.attachmentIds = data.getAll('attachmentId');
  draft.projectName = String(data.get('projectName') || '');
  draft.template = String(data.get('template') || 'classic');
  const selectedLanguage=String(data.get('language')||'zh');
  draft.usePhoto = data.has('usePhoto'); draft.photoFromLibrary = data.has('photoFromLibrary');
  draft.personalTemplateId = String(data.get('personalTemplateId') || '');
  draft.selectionByLanguage||={};draft.selectionByLanguage[previousLanguage]={entryIds:[...draft.entryIds],personFields:[...draft.personFields],usePhoto:draft.usePhoto,photoFromLibrary:draft.photoFromLibrary};
  draft.language=selectedLanguage;
  if(selectedLanguage!==previousLanguage){
    const saved=draft.selectionByLanguage[selectedLanguage],project=currentProject(ctx,draft),initial=project?createWizardDraft(ctx.state.library,{project:{...project,language:selectedLanguage}}):draft;
    for(const key of ['entryIds','personFields','usePhoto','photoFromLibrary'])draft[key]=structuredClone((saved||initial)[key]);
  }
  saveWizardDraft(ctx, draft);
}

function profileConflictHtml(conflicts) {
  if (!conflicts?.length) return '';
  return '<section class="wizard-section wizard-profile-conflict" id="wizard-profile-conflict" tabindex="-1" aria-label="确认联系方式变更"><h2>确认联系方式变更</h2><p>联系方式已在当前简历改写，无法逐项识别。采用新选择将使用右侧内容。</p>' + conflicts.map(conflict => '<div class="wizard-conflict-language"><h3>' + (conflict.language === 'zh' ? '中文' : 'English') + ' · ' + escape(conflict.blockTitle || '基本信息') + '</h3><div class="wizard-grid"><label class="field"><span>当前的自定义文字</span><textarea readonly rows="4">' + escape(conflict.currentBody) + '</textarea></label><label class="field"><span>采用新选择后的文字</span><textarea readonly rows="4">' + escape(conflict.nextBody || '（不显示联系方式）') + '</textarea></label></div></div>').join('') + '<div class="button-group">' + button('返回保留原选择', 'wizard-conflict-back', 'secondary') + button('采用新选择并进入预览', 'wizard-conflict-apply', 'primary') + '</div></section>';
}

function renderSelectionStep(ctx, root) {
  const draft = ctx.ui.wizard;
  const library = ctx.state.library;
  const project = currentProject(ctx, draft);
  const entries = selectionEntries(library, project);
  const attachments = selectionAttachments(library, project);
  const recommendation = recommendSelection(library, draft);
  const matches = new Map(recommendation.ranking.map(item => [item.entryId, item]));
  // Checked existing modules keep their local edits, so inspect that snapshot.
  const savedEntries = new Map();
  for (const block of project?.blocks || []) if (block.kind === 'entry' && block.sourceId && !block.hiddenLanguages?.includes(draft.language) && !savedEntries.has(block.sourceId)) savedEntries.set(block.sourceId, block);
  const displayEntry = entry => savedEntries.get(entry.id) || entry;
  const groups = new Map(Object.keys(categories).map(category => [category, []]));
  for (const entry of entries) groups.get(categories[entry.category] ? entry.category : 'other').push(entry);
  const groupHeader = (label, group) => '<div class="selection-group-heading"><h3>' + label + '</h3><label class="selection-all"><input type="checkbox" data-group-all="' + group + '"> 全选</label></div>';
  const personal = '<section class="selection-group">' + groupHeader('基本信息', 'person') + '<div class="person-selection-grid">' + personFields.map(key => {
    const value = personValue(library.person, key, draft.language);
    const reference = !value && localizedPersonFields.includes(key) ? personValue(library.person, key, otherLanguage(draft.language)) : '';
    return '<label class="selection-row"><input type="checkbox" name="personField" data-selection-group="person" value="' + key + '" ' + checked(draft.personFields.includes(key)) + '><span><strong>' + fieldLabels[key] + '</strong><small>' + escape(value || (localizedPersonFields.includes(key) ? '尚未填写' + languageNames[draft.language] : '资料库暂未填写')) + '</small>' + (reference ? '<em class="selection-language-note" data-person-language-missing>' + languageNames[otherLanguage(draft.language)] + '参考：' + escape(reference) + '</em>' : '') + '</span></label>';
  }).join('') + '</div></section>';
  const {current: currentPhotoBlock, available: availablePhoto} = wizardPhotoState(library, project, draft.language);
  const projectPhoto = currentPhotoBlock?.photo;
  if (!availablePhoto) { draft.usePhoto = false; draft.photoFromLibrary = false; saveWizardDraft(ctx, draft); }
  const photoStatus = draft.isNew ? '勾选后将使用资料库照片及取景。' : projectPhoto ? languageNames[draft.language] + '版已有照片，保留当前照片及取景。' : languageNames[draft.language] + '版尚无照片，勾选后将从' + (library.person.photo ? '资料库' : '当前简历副本') + '新增，仅用于当前版。';
  const photoChoice = availablePhoto ? '<section class="selection-group"><h3>个人照片 <span class="muted">可选</span></h3><label class="selection-row"><input type="checkbox" name="usePhoto" ' + checked(draft.usePhoto) + '><span><strong>在简历中使用照片</strong><small data-wizard-photo-status>' + escape(photoStatus) + '</small></span></label>' + (projectPhoto && library.person.photo && JSON.stringify(projectPhoto) !== JSON.stringify(library.person.photo) ? '<label class="check-row"><input type="checkbox" name="photoFromLibrary" ' + checked(draft.photoFromLibrary) + '>改用资料库照片及取景（当前简历照片已独立保留）</label>' : '') + (!library.person.photo ? '<p class="panel-help">照片可使用当前简历保留的副本，资料库已无此照片。</p>' : '') + '</section>' : '';
  const personalTemplates = ctx.state.personalTemplates || [];
  const personalTemplatePicker = personalTemplates.length ? field('我的模板', '<select name="personalTemplateId"><option value="">使用上方起始模板</option>' + personalTemplates.map(item => '<option value="' + escape(item.id) + '" ' + (draft.personalTemplateId === item.id ? 'selected' : '') + '>' + escape(item.name) + '</option>').join('') + '</select>') : '';
  const experience = '<section class="selection-group experience-selection-container">' + groupHeader('经历资料', 'entries') + experienceFilterHtml(entries,ctx.ui.wizardExperienceFilters||={}) + '<p class="panel-help">搜索和时间排序只影响列表；现有成稿顺序保持，新勾选资料按原有顺序追加。进入制作后可拖动调整成稿顺序。</p><div class="experience-selection-list" data-experience-list>' + entries.map(entry => {
    const category=categories[entry.category]?entry.category:'other';
    const match = matches.get(entry.id);
    const current = displayEntry(entry);
    const content = current[draft.language] || {};
    const alternate = current[otherLanguage(draft.language)] || {};
    const status = entryLanguageStatus(current, draft.language);
    const currentTitle = String(content.title || '').trim();
    const referenceTitle = !currentTitle && status.hasReference ? String(alternate.title || '').trim() : '';
    const title = currentTitle || (referenceTitle ? referenceTitle + '（' + languageNames[otherLanguage(draft.language)] + '参考）' : '未命名经历');
    const subtitle = [content.subtitle, getPeriod(current, draft.language)].filter(Boolean).join(' · ');
    const languageNote = entryLanguageNote(current, draft.language);
    return '<article class="experience-item" data-experience-id="'+escape(entry.id)+'"><label class="selection-row' + (match ? ' recommended' : '') + '"><input type="checkbox" name="entryId" data-selection-group="entries" value="' + escape(entry.id) + '" ' + checked(draft.entryIds.includes(entry.id)) + '><span><strong>' + escape(title) + '</strong>' + '<small>'+escape(categories[category])+'</small>'+(subtitle ? '<small>' + escape(subtitle) + '</small>' : '') + (languageNote ? '<em class="selection-language-note" data-entry-language-missing>' + escape(languageNote) + '</em>' : '') + (match ? '<em class="selection-reason">本地匹配：' + escape(match.reasons.join('；')) + '</em>' : recommendation.hasRole ? '<small class="muted">暂无关键词匹配，仍可手动选用</small>' : '') + (entry.savedOnly ? '<small class="muted">当前简历保留的副本 · 已不在资料库</small>' : '') + '</span></label>'+experiencePreviewHtml(current,draft.language,{savedOnly:entry.savedOnly||savedEntries.has(entry.id),project})+'</article>';
  }).join('') + '</div><p class="empty-compact experience-filter-empty" data-experience-empty hidden>没有符合筛选的经历。已勾选内容保持。</p></section>';
  const files = '<section class="selection-group"><div class="selection-group-heading"><div><h3>补充文件 <span class="muted">可选</span></h3><p>选中文件将在导出 PDF 时另存到补充材料文件夹。</p></div>' + (typeof ctx.importAttachments === 'function' ? button(icon('plus', 15) + ' 添加文件', 'wizard-import-attachments', 'quiet') : '') + '</div>' + (attachments.length ? attachments.map(attachment => '<label class="selection-row"><input type="checkbox" name="attachmentId" value="' + escape(attachment.id) + '" ' + checked(draft.attachmentIds.includes(attachment.id)) + '><span><strong>' + escape(attachment.name) + '</strong><small>' + sizeLabel(attachment.size) + (attachment.savedOnly ? ' · 当前简历保留的副本' : '') + '</small><small>'+escape(entries.filter(entry=>(entry.attachmentIds||[]).includes(attachment.id)).map(entry=>entryDisplay(entry,draft.language).title).join('、')||'独立附件')+'</small></span></label>').join('') : '<p class="empty-compact">还没有补充文件。可以不选文件，直接继续。</p>') + '</section>';
  root.innerHTML = profileConflictHtml(draft.profileConflicts) + '<form id="wizard-selection-form"><div class="wizard-recommendation"><div><strong>' + (recommendation.hasRole ? '<span class="tag">本地推荐</span> ' + escape(draft.jobTitle || '按招聘要求筛选') : '从完整资料开始') + '</strong><p>' + (recommendation.hasRole ? (recommendation.ranking.length ? '已找到 ' + recommendation.ranking.length + ' 条相关经历。推荐只依据已有文字和标签，可按需要调整。' : '暂未找到关键词匹配。你可以手动勾选资料，或返回补充岗位要求。') : '默认选中已有基本信息和经历。取消不需要的项目，预览只保留你勾选的内容。') + '</p></div>' + button(recommendation.hasRole ? '采用本地推荐' : '选中全部经历', 'wizard-recommend', 'quiet') + '</div><div class="wizard-language-warning" id="wizard-language-summary" role="status" hidden></div><div class="wizard-grid"><div class="wizard-section wizard-selection-list">' + personal + photoChoice + experience + (!entries.length ? '<section class="selection-group"><h3>经历资料</h3><p class="empty-compact">资料库还没有经历。可以先建立简历，再添加文字。</p></section>' : '') + files + '<div id="wizard-attachment-warning" role="status"></div></div><aside class="wizard-section wizard-settings"><h2>给这份简历一个起点</h2>' + field('简历名称', input('projectName', draft.projectName, 'maxlength="120" placeholder="我的简历"')) + field('预览语言', '<select name="language"><option value="zh" ' + (draft.language === 'zh' ? 'selected' : '') + '>中文</option><option value="en" ' + (draft.language === 'en' ? 'selected' : '') + '>English</option></select>') + '<fieldset class="template-picker"><legend>选择模板</legend>' + templates.map(template => '<label class="template-choice' + (draft.template === template.id ? ' selected' : '') + '"><input type="radio" name="template" value="' + template.id + '" ' + checked(draft.template === template.id) + '><span class="template-mini mini-' + template.id + '" aria-hidden="true"><i></i><b></b><span></span><span></span><span></span></span><span><strong>' + template.name + '</strong><small>' + template.note + '</small></span></label>').join('') + '</fieldset>' + personalTemplatePicker + '<p class="wizard-local-note">进入预览后，可继续调整文字与排版。</p></aside></div><div class="wizard-footer"><div>' + button('上一步：岗位方向', 'wizard-back', 'quiet') + '</div><div class="button-group"><span id="wizard-selected-count" class="wizard-selected-count" aria-live="polite"></span><button type="submit" class="button primary" data-action="wizard-create">' + (draft.isNew ? '进入预览' : '更新并进入预览') + ' ' + icon('arrow', 16) + '</button></div></div></form>';
  const form = $('#wizard-selection-form', root);form.dataset.selectionLanguage=draft.language;
  const impact=document.createElement('div');impact.dataset.wizardTemplateImpact='';$('.wizard-settings',form).append(impact);

  const updateSummary = () => {
    const photoStatusNode = $('[data-wizard-photo-status]', form);
    if (photoStatusNode) photoStatusNode.textContent = (draft.usePhoto ? (draft.photoFromLibrary ? '将替换当前版的首张照片，其他照片和另一语言保持。' : photoStatus) : languageNames[draft.language] + '版不使用照片，另一语言的照片保持。') + ' 进入预览后可拖动、调整尺寸及取景。';
    const warnings=attachmentSelectionWarnings(entries,draft.entryIds,draft.attachmentIds),signature=JSON.stringify(warnings.map(row=>[row.attachmentId,row.entryIds]));
    const warning=$('#wizard-attachment-warning',form);
    warning.className=warnings.length&&draft.attachmentWarningAcknowledged!==signature?'experience-attachment-warning':'';
    warning.innerHTML=warnings.length&&draft.attachmentWarningAcknowledged!==signature ? '<strong>这些附件关联的项目未被选中</strong><p>'+escape(warnings.map(row=>attachments.find(file=>file.id===row.attachmentId)?.name||'已保存附件').join('、'))+'</p><p>可以保留为独立补充材料；不会自动移除附件。</p><div class="button-group"><button type="button" class="button secondary" data-keep-linked-files>保留这些附件</button><button type="button" class="button quiet" data-remove-linked-files>取消勾选这些附件</button></div>':'';
    $('[data-keep-linked-files]',warning)?.addEventListener('click',()=>{draft.attachmentWarningAcknowledged=signature;updateSummary();});
    $('[data-remove-linked-files]',warning)?.addEventListener('click',()=>{const ids=new Set(warnings.map(row=>row.attachmentId));for(const control of $$('input[name="attachmentId"]',form))if(ids.has(control.value))control.checked=false;captureSelection(form,draft,ctx);updateSummary();});
    $('#wizard-selected-count', root).textContent = '已选 ' + draft.personFields.length + ' 项基本信息、' + draft.entryIds.length + ' 段经历、' + draft.attachmentIds.length + ' 个文件';
    const missingPersonal = draft.personFields.filter(key => !personValue(library.person, key, draft.language));
    const missingEntries = entries.filter(entry => draft.entryIds.includes(entry.id) && entryLanguageNote(displayEntry(entry), draft.language));
    const summary = $('#wizard-language-summary', root);
    summary.hidden = !missingPersonal.length && !missingEntries.length;
    summary.innerHTML = '<strong>' + languageNames[draft.language] + '版待补充：' + missingPersonal.length + ' 项基本信息、' + missingEntries.length + ' 段经历</strong><p>带有“' + languageNames[otherLanguage(draft.language)] + '参考”的标题仅用于辨认资料，不会作为' + languageNames[draft.language] + '内容导出。可继续进入预览补写，也可返回资料库完善；无需填写未勾选的个人信息。</p>';
    for (const group of $$('[data-group-all]', form)) {
      const controls = $$('[data-selection-group]', form).filter(control => control.dataset.selectionGroup === group.dataset.groupAll && !control.closest('[data-experience-id]')?.hidden);
      const count = controls.filter(control => control.checked).length;
      group.checked = controls.length > 0 && count === controls.length;
      group.indeterminate = count > 0 && count < controls.length;
    }
    for (const choice of $$('.template-choice', form)) choice.classList.toggle('selected', choice.querySelector('input').checked);
    const picker = $('.template-picker', form);
    picker.querySelector('[data-template-build-error]')?.remove();
    let preview, previewNote = '';
    try {
      preview = draft.isNew ? createWizardProject(library, draft, {personalTemplates,measureBlock:measureTextBlock}) : updateWizardProject(project, library, draft, {personalTemplates,measureBlock:measureTextBlock});
      initializeBlankLayout(preview, project);
    } catch (error) {
      if (error.code === 'PROFILE_SELECTION_CONFLICT' && project) {
        preview = structuredClone(project);
        applyLanguageLayout(preview, draft.language);
        preview.template = draft.template;
        initializeBlankLayout(preview, project);
        previewNote = '当前联系方式有局部改写待确认，暂按已保存的内容预览；确认选择后会更新。';
      } else {
        picker.querySelector('.template-preview-tools')?.remove();
        const failure = document.createElement('p'); failure.className = 'template-preview-provenance';
        failure.dataset.templateBuildError = '';
        failure.textContent = '当前资料暂不能生成模板预览：' + error.message;
        picker.append(failure);
      }
    }
    if (preview) renderTemplateThumbnails(ctx, picker, preview, { note: previewNote });
    impact.replaceChildren();
    if(preview&&draft.personalTemplateId){try{const baselineDraft={...draft,personalTemplateId:''},baseline=draft.isNew?createWizardProject(library,baselineDraft):updateWizardProject(project,library,baselineDraft);renderPersonalTemplateImpact(impact,baseline,preview,{previews:false});}catch(error){impact.textContent='两版影响暂不能预览：'+error.message;}}
  };
  bindExperienceFilters($('.experience-selection-container',form),entries,ctx.ui.wizardExperienceFilters,draft.language,{onUpdate:()=>updateSummary()});
  const aiSelect=document.createElement('button');aiSelect.type='button';aiSelect.className='button quiet';aiSelect.dataset.wizardAiSelect='';aiSelect.textContent='用 AI 推荐经历';$('.wizard-recommendation',form).append(aiSelect);aiSelect.onclick=()=>{captureSelection(form,draft,ctx);ctx.openWizardAi?.('select');};
  const aiRecommendation=draft.aiRecommendations;
  if(aiRecommendation&&aiRecommendation.jobTitle===draft.jobTitle&&aiRecommendation.jobDescription===draft.jobDescription&&aiRecommendation.language===draft.language){const note=document.createElement('p');note.dataset.aiSelectionNote='';note.className='wizard-local-note';note.textContent='AI 推荐已采用，可继续手动勾选；本地推荐仍可单独使用。';$('.wizard-recommendation',form).after(note);for(const item of aiRecommendation.items){const control=$$('input[name="entryId"]',form).find(input=>input.value===item.entryId);if(control){const reason=document.createElement('em');reason.className='selection-reason';reason.textContent='AI 建议：'+item.reason;control.closest('label').append(reason);}}}
  const clearConflict = () => { delete draft.profileConflicts; $('#wizard-profile-conflict', root)?.remove(); };
  form.oninput = event => { if (event.target.dataset.groupAll || event.target.name==='language') return; captureSelection(form, draft, ctx); clearConflict(); updateSummary(); };
  form.onchange = event => {
    if (event.target.dataset.groupAll) {
      for (const control of $$('[data-selection-group]', form)) if (control.dataset.selectionGroup === event.target.dataset.groupAll && !control.closest('[data-experience-id]')?.hidden) control.checked = event.target.checked;
    }
    if (event.target.name === 'template' && form.elements.personalTemplateId) form.elements.personalTemplateId.value = '';
    captureSelection(form, draft, ctx);
    if (event.target.name === 'language') {
      // captureSelection restored this language's own material/photo choices.
      saveWizardDraft(ctx, draft);
    }
    clearConflict(); updateSummary();
    if (event.target.name === 'language') ctx.render();
  };
  $('[data-action="wizard-back"]', root).onclick = () => { captureSelection(form, draft, ctx); draft.step = 1; ctx.render(); };
  $('[data-action="wizard-recommend"]', root).onclick = () => { captureSelection(form, draft, ctx); draft.entryIds = recommendation.entryIds; ctx.render(); };
  $('[data-action="wizard-import-attachments"]', root)?.addEventListener('click', async () => {
    captureSelection(form, draft, ctx);
    try { await ctx.importAttachments(); if (ctx.ui.screen === 'wizard') ctx.render(); }
    catch (error) { ctx.notify(error.message, true); }
  });
  $('[data-action="wizard-conflict-back"]', root)?.addEventListener('click', () => {
    draft.personFields = createWizardDraft(library, { project }).personFields;
    delete draft.profileConflicts;
    ctx.render();
  });
  $('[data-action="wizard-conflict-apply"]', root)?.addEventListener('click', () => {
    const profileBodyResolution = Object.fromEntries((draft.profileConflicts || []).map(conflict => [conflict.blockId + ':' + conflict.language, 'replace']));
    finishWizard(ctx, form, { profileBodyResolution }).catch(error => ctx.notify(error.message, true));
  });
  form.onsubmit = event => { event.preventDefault(); finishWizard(ctx, form).catch(error => ctx.notify(error.message, true)); };
  updateSummary();
}

function initializeBlankLayout(project, previous = null) {
  if (project.template !== 'blank') return;
  const existingIds = new Set(previous?.blocks.map(block => block.id) || []);
  const alreadyFree = project.mode === 'free';
  const saved = project.freeLayoutByLanguage?.[project.language]?.positions || {};
  const preserved = new Map();
  for (const block of project.blocks) {
    if (alreadyFree && existingIds.has(block.id)) preserved.set(block.id, block);
    else if (saved[block.id]) preserved.set(block.id, saved[block.id]);
  }
  if (alreadyFree && project.blocks.every(block => preserved.has(block.id))) return;
  const staging = document.createElement('div');
  staging.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden';
  document.body.append(staging);
  try {
    const measured = renderResume(staging, { ...project, mode: 'flow' });
    const positions = {};
    let page = 0, bottom = 16;
    for (const [id, frame] of preserved) {
      const block = project.blocks.find(item => item.id === id);
      if (!block || block.hiddenLanguages?.includes(project.language) || ['line', 'shape', 'photo'].includes(block.kind)) continue;
      // Automatic frame.height may predate a long local edit. Measure at the
      // preserved width and styles without rewriting that frame's metadata.
      const actualHeight = frame.fixedHeight ? frame.height : measureTextBlock({ ...block, ...frame }, project, frame.width).height;
      if (frame.page > page) { page = frame.page; bottom = frame.y + actualHeight + 8; }
      else if (frame.page === page) bottom = Math.max(bottom, frame.y + actualHeight + 8);
    }
    for (const block of project.blocks) {
      if (preserved.has(block.id)) continue;
      const position = measured.positions[block.id];
      if (!position) continue;
      if (preserved.size && !['line', 'shape'].includes(block.kind)) {
        if (bottom + position.height > project.paper.height - 16) { page++; bottom = 16; }
        positions[block.id] = { ...position, x: 16, y: bottom, page };
        bottom += position.height + 8;
      } else positions[block.id] = position;
      // An already-free project only needs coordinates for newly selected data.
      if (alreadyFree) Object.assign(block, positions[block.id]);
    }
    applyLayoutMode(project, 'free', positions);
  } finally { staging.remove(); }
}

async function finishWizard(ctx, form, resolution = {}) {
  const draft = ctx.ui.wizard;
  if (draft.busy) return;
  captureSelection(form, draft, ctx);
  const submit = $('[data-action="wizard-create"]', form);
  draft.busy = true; submit.disabled = true;
  try {
    if (draft.isNew) {
      const project = createWizardProject(ctx.state.library, draft, {personalTemplates:ctx.state.personalTemplates || [],measureBlock:measureTextBlock});
      initializeBlankLayout(project);
      if(draft.personalTemplateId){const baseline=createWizardProject(ctx.state.library,{...draft,personalTemplateId:''}),snapshot=JSON.stringify(draft),librarySnapshot=JSON.stringify(ctx.state.library),templateSnapshot=JSON.stringify(ctx.state.personalTemplates);
        if(!await confirmPersonalTemplateImpact(ctx,baseline,project,{name:ctx.state.personalTemplates.find(item=>item.id===draft.personalTemplateId)?.name,isCurrent:()=>ctx.ui.wizard===draft&&JSON.stringify(draft)===snapshot&&JSON.stringify(ctx.state.library)===librarySnapshot&&JSON.stringify(ctx.state.personalTemplates)===templateSnapshot}))return;}
      await ctx.addProject(project);
    } else {
      const previous = currentProject(ctx, draft);
      if (!previous) throw new Error('当前简历已不存在，请返回简历列表重新选择。');
      const project = updateWizardProject(previous, ctx.state.library, draft, {...resolution,personalTemplates:ctx.state.personalTemplates || [],measureBlock:measureTextBlock});
      initializeBlankLayout(project, previous);
      if(draft.personalTemplateId){const baseline=updateWizardProject(previous,ctx.state.library,{...draft,personalTemplateId:''},resolution),snapshot=JSON.stringify(previous),draftSnapshot=JSON.stringify(draft),librarySnapshot=JSON.stringify(ctx.state.library),templateSnapshot=JSON.stringify(ctx.state.personalTemplates);
        if(!await confirmPersonalTemplateImpact(ctx,baseline,project,{name:ctx.state.personalTemplates.find(item=>item.id===draft.personalTemplateId)?.name,isCurrent:()=>currentProject(ctx,draft)?.id===previous.id&&JSON.stringify(currentProject(ctx,draft))===snapshot&&JSON.stringify(draft)===draftSnapshot&&JSON.stringify(ctx.state.library)===librarySnapshot&&JSON.stringify(ctx.state.personalTemplates)===templateSnapshot}))return;}
      ctx.updateProject(next => { Object.keys(next).forEach(key => delete next[key]); Object.assign(next, project); }, { render: false });
      await ctx.flush();
      ctx.navigate('editor');
    }
    clearWizardDraft(ctx); ctx.ui.wizard = null;
  } catch (error) {
    if (error.code !== 'PROFILE_SELECTION_CONFLICT') throw error;
    draft.profileConflicts = error.conflicts;
    ctx.render();
    $('#wizard-profile-conflict')?.scrollIntoView({ block: 'start' });
    $('#wizard-profile-conflict')?.focus();
  } finally { draft.busy = false; if (submit.isConnected) submit.disabled = false; }
}
