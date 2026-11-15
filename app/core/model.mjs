import {validateReadingOrder} from './submission.mjs';
import {validateCanvasGroups,validateCanvasTemplate} from './canvas-groups.mjs';
import { validatePhoto } from './photo.mjs';
import {validateDesignBlock} from './design-tools.mjs';
import {validateExperienceFields,materializeExperience} from './library-experience.mjs';
import {validatePersonLinks,validateDocumentStyle,profileContactData} from './document-style.mjs';
import { validateAttachmentList } from './attachments.mjs';
import { validateRichText } from './rich-text.mjs';
import { validatePeriodByLanguage } from './entry-content.mjs';
// Shared by the sandboxed renderer and the desktop store. No filesystem or network access.
const LANGUAGES = ['zh', 'en'];
const MAX_ENTRIES = 2000;
const MAX_BLOCKS = 500;
const MAX_PROJECTS = 500;
const MAX_EXPORTS = 10000;
const clone = value => structuredClone(value);
const uuid = () => globalThis.crypto.randomUUID();
const now = () => new Date().toISOString();
function fail(path, message) { throw new Error(`${path}: ${message}`); }
function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, '必须为普通对象');
}
function string(value, path, max = 200000) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) fail(path, '文本类型、长度或控制字符无效');
}
function number(value, path, min, max, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(path, '数值超出允许范围');
}
function boolean(value, path) { if (typeof value !== 'boolean') fail(path, '必须为布尔值'); }
function oneOf(value, values, path) { if (!values.includes(value)) fail(path, '不支持的值'); }
function array(value, path, max) { if (!Array.isArray(value) || value.length > max) fail(path, '列表类型或长度无效'); }
function id(value, path) {
  string(value, path, 128);
  if (!/^[a-zA-Z0-9_-]+$/u.test(value)) fail(path, '标识符只能包含字母、数字、下划线和连字符');
}
function timestamp(value, path) {
  string(value, path, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || !Number.isFinite(Date.parse(value))) fail(path, '时间格式无效');
}
function uniqueIds(values, path) {
  const ids = new Set();
  values.forEach((value, index) => {
    id(value.id, `${path}[${index}].id`);
    if (ids.has(value.id)) fail(path, '标识符重复');
    ids.add(value.id);
  });
  return ids;
}
// Retain extensions, while rejecting non-JSON values, cycles, prototype keys and excessive input.
function safeData(value, path = 'data') {
  let nodes = 0;
  let characters = 0;
  const ancestors = new Set();
  function visit(current, name, depth) {
    if (++nodes > 300000 || depth > 24) fail(name, '数据过于复杂');
    if (current === null || typeof current === 'boolean') return;
    if (typeof current === 'string') {
      string(current, name);
      characters += current.length;
      if (characters > 40000000) fail(name, '数据总量过大');
      return;
    }
    if (typeof current === 'number') { if (!Number.isFinite(current)) fail(name, '数值必须有限'); return; }
    if (typeof current !== 'object') fail(name, '只能保存JSON数据');
    if (ancestors.has(current)) fail(name, '不能包含循环引用');
    ancestors.add(current);
    if (Array.isArray(current)) {
      array(current, name, MAX_EXPORTS);
      for (let index = 0; index < current.length; index++) visit(current[index], `${name}[${index}]`, depth + 1);
    } else {
      object(current, name);
      const keys = Object.keys(current);
      if (keys.length > 2000) fail(name, '字段过多');
      for (const key of keys) {
        if (['__proto__', 'prototype', 'constructor'].includes(key) || key.length > 128) fail(name, '字段名无效');
        visit(current[key], `${name}.${key}`, depth + 1);
      }
    }
    ancestors.delete(current);
  }
  visit(value, path, 0);
}
function bilingualText(value, path) {
  object(value, path);
  string(value.title, `${path}.title`, 2000);
  string(value.subtitle, `${path}.subtitle`, 5000);
  string(value.body, `${path}.body`);
}
function stale(value, path) {
  object(value, path);
  LANGUAGES.forEach(language => boolean(value[language], `${path}.${language}`));
}
function entryFields(value, path) {
  validateExperienceFields(value,path);
  object(value, path);
  id(value.id, `${path}.id`);
  string(value.category, `${path}.category`, 100);
  string(value.period, `${path}.period`, 500);
  validatePeriodByLanguage(value, path);
  array(value.tags, `${path}.tags`, 100);
  value.tags.forEach((tag, index) => string(tag, `${path}.tags[${index}]`, 120));
  LANGUAGES.forEach(language => bilingualText(value[language], `${path}.${language}`));
  stale(value.stale, `${path}.stale`);
  validateRichText(value, path);
}
function libraryFields(library, path = 'library') {
  object(library, path);
  object(library.person, `${path}.person`);
  validatePersonLinks(library.person,`${path}.person`);
  LANGUAGES.forEach(language => {
    object(library.person[language], `${path}.person.${language}`);
    for (const field of ['name', 'headline', 'city']) string(library.person[language][field], `${path}.person.${language}.${field}`, 2000);
  });
  for (const field of ['email', 'phone', 'website']) string(library.person[field], `${path}.person.${field}`, 2000);
  if (library.person.stale !== undefined) stale(library.person.stale,path+'.person.stale');
  if (library.person.photo !== undefined) validatePhoto(library.person.photo, path + '.person.photo');
  array(library.entries, `${path}.entries`, MAX_ENTRIES);
  library.entries.forEach((entry, index) => entryFields(entry, `${path}.entries[${index}]`));
  uniqueIds(library.entries, `${path}.entries`);
  if (library.attachments !== undefined) validateAttachmentList(library.attachments, `${path}.attachments`);
}
function color(value, path, transparent = false) {
  if (transparent && value === 'transparent') return;
  if (typeof value !== 'string' || !/^#(?:[a-f\d]{3}|[a-f\d]{6}|[a-f\d]{8})$/iu.test(value)) fail(path, '颜色格式无效');
}
function textStyle(value, path) {
  if (value.fixedHeight !== undefined) boolean(value.fixedHeight, path + '.fixedHeight');
  if (value.fontFamily !== undefined) {
    string(value.fontFamily, path + '.fontFamily', 160);
    if (!value.fontFamily || /[{};<>\r\n]|url\s*\(/iu.test(value.fontFamily)) fail(path + '.fontFamily', '字体名称无效');
  }
  if (value.fontWeight !== undefined) oneOf(value.fontWeight, [400, 700], path + '.fontWeight');
  if (value.fontStyle !== undefined) oneOf(value.fontStyle, ['normal', 'italic'], path + '.fontStyle');
  if (value.textDecoration !== undefined) oneOf(value.textDecoration, ['none', 'underline'], path + '.textDecoration');
  if (value.textAlign !== undefined) oneOf(value.textAlign, ['left', 'center', 'right', 'justify'], path + '.textAlign');
  if (value.lineHeight !== undefined) number(value.lineHeight, path + '.lineHeight', 1, 2.5);
}
function position(value, path) {
  object(value, path);
  number(value.x, `${path}.x`, -10000, 10000);
  number(value.y, `${path}.y`, -10000, 10000);
  number(value.width, `${path}.width`, 0.1, 2000);
  number(value.height, `${path}.height`, 0.1, 20000);
  number(value.page, `${path}.page`, 0, 1000, true);
  number(value.fontSize, `${path}.fontSize`, 4, 144);
  textStyle(value, path);
}
function paperFields(value, path) {
  object(value, path);
  string(value.name, `${path}.name`, 100);
  number(value.width, `${path}.width`, 40, 2000);
  number(value.height, `${path}.height`, 40, 2000);
}
function projectFields(project, path = 'project') {
  object(project, path);
  id(project.id, `${path}.id`);
  string(project.name, `${path}.name`, 500);
  if (project.archived !== undefined) boolean(project.archived, `${path}.archived`);
  string(project.jobTitle, `${path}.jobTitle`, 2000);
  string(project.jobDescription, `${path}.jobDescription`);
  oneOf(project.language, LANGUAGES, `${path}.language`);
  oneOf(project.template, ['classic', 'sidebar', 'blank'], `${path}.template`);
  oneOf(project.mode, ['flow', 'free'], `${path}.mode`);
  paperFields(project.paper, `${path}.paper`);
  color(project.accent, `${path}.accent`);
  string(project.fontFamily, `${path}.fontFamily`, 160);
  if (!project.fontFamily || /[{};<>\r\n]|url\s*\(/iu.test(project.fontFamily)) fail(`${path}.fontFamily`, '字体名称无效');
  number(project.fontSize, `${path}.fontSize`, 4, 144);
  timestamp(project.createdAt, `${path}.createdAt`);
  timestamp(project.updatedAt, `${path}.updatedAt`);
  array(project.blocks, `${path}.blocks`, MAX_BLOCKS);
  validateDocumentStyle(project,path);
  project.blocks.forEach((block, index) => {
    const name = `${path}.blocks[${index}]`;
    entryFields(block, name);
    validateDesignBlock(block,name);
    if (block.sourceId !== null) id(block.sourceId, `${name}.sourceId`);
    oneOf(block.kind, ['profile', 'entry', 'text', 'line', 'shape', 'photo'], `${name}.kind`);
    if (block.hiddenLanguages !== undefined) {
      array(block.hiddenLanguages, `${name}.hiddenLanguages`, 2);
      if (new Set(block.hiddenLanguages).size !== block.hiddenLanguages.length) fail(`${name}.hiddenLanguages`, '语言不能重复');
      block.hiddenLanguages.forEach(language => oneOf(language, LANGUAGES, `${name}.hiddenLanguages`));
    }
    if (block.continuation !== undefined) {
      object(block.continuation, `${name}.continuation`);
      id(block.continuation.sourceBlockId, `${name}.continuation.sourceBlockId`);
      number(block.continuation.index, `${name}.continuation.index`, 1, 50, true);
    }
    if (block.kind === 'photo') validatePhoto(block.photo, name + '.photo');
    position(block, name);
    color(block.color, `${name}.color`);
    color(block.background, `${name}.background`, true);
    boolean(block.locked, `${name}.locked`);
    oneOf(block.column, ['main', 'side'], `${name}.column`);
  });
  if (project.attachments !== undefined) validateAttachmentList(project.attachments, `${path}.attachments`);
  if (project.groupSections !== undefined) boolean(project.groupSections, path + '.groupSections');
  if (project.sectionTitles !== undefined) sectionTitleFields(project.sectionTitles, path + '.sectionTitles');
  const blockIds = uniqueIds(project.blocks, `${path}.blocks`);
  for (const key of ['layoutByLanguage', 'freeLayoutByLanguage']) if (project[key] !== undefined) {
    object(project[key], `${path}.${key}`);
    for (const [language, layout] of Object.entries(project[key])) {
      oneOf(language, LANGUAGES, `${path}.${key}`);
      object(layout, `${path}.${key}.${language}`);
      oneOf(layout.mode, key === 'freeLayoutByLanguage' ? ['free'] : ['flow', 'free'], `${path}.${key}.${language}.mode`);
      object(layout.positions, `${path}.${key}.${language}.positions`);
      if (Object.keys(layout.positions).length > MAX_BLOCKS) fail(path, '布局位置过多');
      for (const [blockId, value] of Object.entries(layout.positions)) {
        id(blockId, `${path}.${key}.${language}.positions`);
        if (!blockIds.has(blockId)) fail(`${path}.${key}`, '布局引用了不存在的模块');
        position(value, `${path}.${key}.${language}.positions.${blockId}`);
      }
    }
  }
  if(project.personFieldsByLanguage!==undefined){
    object(project.personFieldsByLanguage,path+'.personFieldsByLanguage');
    for(const [language,fields]of Object.entries(project.personFieldsByLanguage)){oneOf(language,LANGUAGES,path+'.personFieldsByLanguage');array(fields,path+'.personFieldsByLanguage.'+language,6);if(new Set(fields).size!==fields.length)fail(path+'.personFieldsByLanguage','个人字段不能重复');for(const field of fields)oneOf(field,['name','headline','city','email','phone','website'],path+'.personFieldsByLanguage.'+language);}
  }
  validateCanvasGroups(project);
  validateReadingOrder(project);
}
function sectionTitleFields(value,path) {
  object(value,path);for(const [language,labels]of Object.entries(value)){oneOf(language,LANGUAGES,path);object(labels,path+'.'+language);for(const[key,label]of Object.entries(labels)){oneOf(key,['work','project','education','skills','certificate','other'],path);string(label,path+'.'+key,80);}}
}
function personalTemplateFields(value,path) {
  if(value?.documentStyle!==undefined)validateDocumentStyle({documentStyle:value.documentStyle,blocks:[]},path);
  object(value,path);if(value.groupSections!==undefined)boolean(value.groupSections,path+'.groupSections');id(value.id,path+'.id');string(value.name,path+'.name',80);if(!value.name.trim())fail(path,'模板名称为空');timestamp(value.createdAt,path+'.createdAt');oneOf(value.base,['classic','sidebar','blank'],path+'.base');oneOf(value.mode,['flow','free'],path+'.mode');paperFields(value.paper,path+'.paper');color(value.accent,path+'.accent');textStyle({fontFamily:value.fontFamily},path);string(value.fontFamily,path+'.fontFamily',160);number(value.fontSize,path+'.fontSize',4,144);if(value.sectionTitles!==undefined)sectionTitleFields(value.sectionTitles,path+'.sectionTitles');array(value.frames,path+'.frames',MAX_BLOCKS);for(const frame of value.frames){object(frame,path+'.frame');oneOf(frame.kind,['profile','entry','text','line','shape','photo'],path+'.kind');string(frame.category,path+'.category',100);position(frame.style,path+'.style');validateDesignBlock({...frame.style,kind:frame.kind},path+'.style');validateDocumentStyle({blocks:[frame.style]},path+'.style');color(frame.style.color,path+'.color');color(frame.style.background,path+'.background',true);boolean(frame.style.locked,path+'.locked');oneOf(frame.style.column,['main','side'],path+'.column');}
  validateCanvasTemplate(value);
}
function pdfFilename(value, path) {
  string(value, path, 180);
  if (!value || /[\\/:*?"<>|\u0000-\u001f]/u.test(value) || value.includes('..') || !/\.pdf$/iu.test(value) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value) || /[. ]$/u.test(value)) fail(path, '必须为安全的PDF文件名');
}

export function emptyLibrary() {
  return { person: { zh: { name: '', headline: '', city: '' }, en: { name: '', headline: '', city: '' }, email: '', phone: '', website: '' }, entries: [], attachments: [] };
}
export function createState() {
  return { schemaVersion: 1, library: emptyLibrary(), projects: [], activeProjectId: null, backups: [], exports: [] };
}
export function validateLibrary(library) { safeData(library, 'library'); libraryFields(library); return true; }
export function validateProject(project) { safeData(project, 'project'); projectFields(project); return true; }
export function validateState(state) {
  safeData(state, 'state');
  object(state, 'state');
  if (state.schemaVersion !== 1) fail('state.schemaVersion', '不支持的数据版本');
  libraryFields(state.library);
  array(state.projects, 'state.projects', MAX_PROJECTS);
  state.projects.forEach((project, index) => projectFields(project, `state.projects[${index}]`));
  const projectIds = uniqueIds(state.projects, 'state.projects');
  if (state.activeProjectId !== null) {
    id(state.activeProjectId, 'state.activeProjectId');
    if (!projectIds.has(state.activeProjectId)) fail('state.activeProjectId', '当前简历不存在');
  }
  if (state.personalTemplates !== undefined) { array(state.personalTemplates, 'state.personalTemplates', 30); state.personalTemplates.forEach((item,index) => personalTemplateFields(item, 'state.personalTemplates['+index+']')); uniqueIds(state.personalTemplates, 'state.personalTemplates'); }
  array(state.backups, 'state.backups', 5);
  state.backups.forEach((backup, index) => {
    object(backup, `state.backups[${index}]`);
    timestamp(backup.createdAt, `state.backups[${index}].createdAt`);
    string(backup.label, `state.backups[${index}].label`, 500);
    libraryFields(backup.library, `state.backups[${index}].library`);
  });
  uniqueIds(state.backups, 'state.backups');
  array(state.exports, 'state.exports', MAX_EXPORTS);
  state.exports.forEach((item, index) => {
    object(item, `state.exports[${index}]`);
    timestamp(item.createdAt, `state.exports[${index}].createdAt`);
    string(item.projectName, `state.exports[${index}].projectName`, 500);
    string(item.jobTitle, `state.exports[${index}].jobTitle`, 2000);
    string(item.jobDescription, `state.exports[${index}].jobDescription`);
    pdfFilename(item.pdfFile, `state.exports[${index}].pdfFile`);
    if (item.language !== undefined) oneOf(item.language, LANGUAGES, `state.exports[${index}].language`);
    if (item.paper !== undefined) paperFields(item.paper, `state.exports[${index}].paper`);
    if (item.pageCount !== undefined) number(item.pageCount, `state.exports[${index}].pageCount`, 1, 2000, true);
    if (item.attachments !== undefined) validateAttachmentList(item.attachments, `state.exports[${index}].attachments`);
    if (index < 3) projectFields(item.editable, `state.exports[${index}].editable`);
    else if (item.editable !== null) fail(`state.exports[${index}].editable`, '仅最新三次导出保留可编辑快照');
  });
  uniqueIds(state.exports, 'state.exports');
  return true;
}
export function makeBlock(entry) {
  safeData(entry, 'entry');
  entryFields(entry, 'entry');
  return { ...materializeExperience(entry), id: uuid(), sourceId: entry.id, kind: 'entry', fontSizeMode: 'inherit', x: 15, y: 15, width: 180, height: 20, page: 0, fontSize: 10.5, color: '#253746', background: 'transparent', locked: false, column: 'main' };
}
export function createProject(library, options = {}) {
  validateLibrary(library);
  safeData(options, 'options');
  object(options, 'options');
  const template = options.template ?? 'classic';
  const selectedIds = options.entryIds ?? (template === 'blank' ? [] : library.entries.map(entry => entry.id));
  array(selectedIds, 'options.entryIds', MAX_ENTRIES);
  if (new Set(selectedIds).size !== selectedIds.length) fail('options.entryIds', '不能重复选择经历');
  const entries = new Map(library.entries.map(entry => [entry.id, entry]));
  const selected = selectedIds.map(entryId => {
    id(entryId, 'options.entryIds');
    if (!entries.has(entryId)) fail('options.entryIds', '所选经历不存在');
    return entries.get(entryId);
  });
  if (selected.length + 1 > MAX_BLOCKS) fail('options.entryIds', '单份简历最多500个模块，请筛选资料');
  const attachmentIds = options.attachmentIds ?? [];
  if (!Array.isArray(attachmentIds) || attachmentIds.length > 2000 || new Set(attachmentIds).size !== attachmentIds.length) fail('options.attachmentIds', '附件选择无效或重复');
  const attachmentsById = new Map((library.attachments ?? []).map(item => [item.id, item]));
  const attachments = attachmentIds.map(attachmentId => {
    id(attachmentId, 'options.attachmentIds');
    if (!attachmentsById.has(attachmentId)) fail('options.attachmentIds', '所选附件不存在');
    return clone(attachmentsById.get(attachmentId));
  });
  const person = library.person;
  const profile = makeBlock({ id: 'profile', category: 'profile', period: '', tags: [], ...Object.fromEntries(LANGUAGES.map(language => [language, (() => {const {title,subtitle,body}=profileContactData(person,language);return {title,subtitle,body};})()])), stale: clone(person.stale||{zh:false,en:false}) });
  profile.kind = 'profile';
  profile.links=profileContactData(person,options.language??'zh').links;
  profile.sourceId = null;
  const time = now();
  const project = { id: uuid(), name: options.name ?? '未命名简历', jobTitle: options.jobTitle ?? '', jobDescription: options.jobDescription ?? '', language: options.language ?? 'zh', template, mode: 'flow', paper: { name: 'A4', width: 210, height: 297 }, accent: '#167d8d', fontFamily: 'Microsoft YaHei', fontSize: 10.5, blocks: [profile, ...selected.map(makeBlock)], attachments, createdAt: time, updatedAt: time };
  validateProject(project);
  return project;
}
export function addBackup(state, label = '资料库保存前') {
  validateState(state);
  string(label, 'label', 500);
  const next = clone(state);
  next.backups = [{ id: uuid(), createdAt: now(), label, library: clone(state.library) }, ...next.backups].slice(0, 5);
  return next;
}
export function restoreLibrary(state, backupId) {
  validateState(state);
  id(backupId, 'backupId');
  const backup = state.backups.find(item => item.id === backupId);
  if (!backup) fail('backupId', '资料库备份不存在');
  const next = addBackup(state, '恢复资料库前');
  next.library = clone(backup.library);
  return next;
}
export function recordExport(state, project, pdfFile, metadata = {}) {
  validateState(state);
  validateProject(project);
  pdfFilename(pdfFile, 'pdfFile');
  object(metadata, 'exportMetadata');
  if (metadata.pageCount !== undefined) number(metadata.pageCount, 'exportMetadata.pageCount', 1, 2000, true);
  if (state.exports.length >= MAX_EXPORTS) fail('exports', '导出记录已达容量上限');
  const next = clone(state);
  const permanent = { language: project.language, paper: clone(project.paper), ...(metadata.pageCount === undefined ? {} : { pageCount: metadata.pageCount }) };
  next.exports = [{ id: uuid(), createdAt: now(), projectName: project.name, jobTitle: project.jobTitle, jobDescription: project.jobDescription, pdfFile, ...permanent, attachments: clone(project.attachments ?? []), editable: clone(project) }, ...next.exports].map((item, index) => index < 3 ? item : { ...item, editable: null });
  return next;
}
export function reopenExport(state, exportId) {
  validateState(state);
  id(exportId, 'exportId');
  const item = state.exports.find(record => record.id === exportId);
  if (!item) fail('exportId', '导出记录不存在');
  if (!item.editable) fail('exportId', '该PDF的完整可编辑快照已过保留期');
  if (state.projects.length >= MAX_PROJECTS) fail('projects', '简历项目已达容量上限');
  const next = clone(state), time = now(), names = new Set(state.projects.map(project => project.name));
  const base = item.editable.name.trim() || '我的简历', exported = item.createdAt.slice(0, 16).replace('T', ' ') + ' UTC';
  let index = 1, name;
  do {
    const suffix = ' · 历史 ' + exported + (index > 1 ? ' ' + index : '');
    let prefix = base.slice(0, 500 - suffix.length);
    if (/[\uD800-\uDBFF]$/u.test(prefix)) prefix = prefix.slice(0, -1);
    name = prefix.trimEnd() + suffix; index++;
  } while (names.has(name));
  const project = { ...clone(item.editable), id: uuid(), name, archived: false, createdAt: time, updatedAt: time };
  next.projects.push(project);
  next.activeProjectId = project.id;
  return next;
}
function keywords(value) {
  const lower = value.toLocaleLowerCase();
  const found = new Set(lower.match(/[a-z][a-z\d+#.]{1,48}/gu) ?? []);
  const stop = /熟练|掌握|负责|具备|相关|能够|以及|进行|要求|能力|经验|工作|岗位|招聘|任职|使用|了解|熟悉|优先|技能|良好|优秀|团队|合作|以上|具有|专业|知识|和|的|与|及|在|有/gu;
  for (const chunk of lower.match(/[\p{Script=Han}]{2,80}/gu) ?? []) {
    for (const part of chunk.split(stop).filter(part => part.length >= 2)) {
      for (let length = Math.min(part.length, 8); length >= 2; length--) {
        for (let index = 0; index + length <= part.length; index++) found.add(part.slice(index, index + length));
      }
    }
  }
  return [...found].sort((left, right) => right.length - left.length).slice(0, 300);
}
function contains(text, word) {
  if (/^[a-z]/u.test(word)) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`(^|[^a-z\\d])${escaped}($|[^a-z\\d])`, 'u').test(text);
  }
  return text.includes(word);
}
export function rankEntries(entries, jobTitle = '', jd = '') {
  safeData(entries, 'entries');
  array(entries, 'entries', MAX_ENTRIES);
  entries.forEach((entry, index) => entryFields(entry, `entries[${index}]`));
  uniqueIds(entries, 'entries');
  string(jobTitle, 'jobTitle', 2000);
  string(jd, 'jobDescription');
  const terms = keywords(`${jobTitle} ${jd}`);
  if (!terms.length) return [];
  const query = `${jobTitle} ${jd}`.toLocaleLowerCase();
  const results = [];
  for (const entry of entries) {
    const title = `${entry.zh.title} ${entry.en.title} ${entry.zh.subtitle} ${entry.en.subtitle}`.toLocaleLowerCase();
    const body = `${entry.zh.body} ${entry.en.body}`.toLocaleLowerCase();
    let score = 0;
    const reasons = [];
    const matched = [];
    for (const tag of entry.tags) {
      const word = tag.trim().toLocaleLowerCase();
      if (word.length >= 2 && contains(query, word)) { score += 8; reasons.push(`标签匹配：${tag}`); matched.push(word); }
    }
    for (const word of terms) {
      if (matched.some(previous => previous.includes(word))) continue;
      const inTitle = contains(title, word);
      if (inTitle || contains(body, word)) {
        score += inTitle ? 4 : 1;
        if (reasons.length < 6) reasons.push(`${inTitle ? '标题' : '内容'}匹配：${word}`);
        matched.push(word);
      }
    }
    if (score > 0) results.push({ entryId: entry.id, score, reasons });
  }
  return results.sort((left, right) => right.score - left.score);
}
