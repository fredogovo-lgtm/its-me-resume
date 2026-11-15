import {pruneCanvasGroups} from '../core/canvas-groups.mjs';
import {pruneReadingOrder} from '../core/submission.mjs';
import {profileContactData,buildPersonLinks,formatLinkLines} from '../core/document-style.mjs';
import { makePhotoBlock } from '../core/photo.mjs';
import { captureProjectSources } from '../core/source-updates.mjs';
import { applyPersonalTemplate } from '../core/personal-templates.mjs';
import { createProject, makeBlock, rankEntries, validateProject } from '../core/model.mjs';
import { setBlockText } from '../core/rich-text.mjs';
import { findJobPreset } from './jobs.mjs';
import { applyLanguageLayout, applyLayoutMode } from './language-layout.mjs';

export const personFields = ['name', 'headline', 'city', 'email', 'phone', 'website'];
const clone = value => structuredClone(value);
const selected = (values, allowed) => [...new Set(Array.isArray(values) ? values : [])].filter(value => !allowed || allowed.includes(value));
const defaultName = title => title?.trim() ? title.trim() + '简历' : '我的简历';
const hasRole = draft => Boolean(draft.jobTitle?.trim() || draft.jobDescription?.trim() || findJobPreset(draft.jobPreset));
const visibleIn = (block,language) => !block.hiddenLanguages?.includes(language);
const profileSelection = (project,language=project?.language) => !project?.blocks.some(block => block.kind === 'profile' && visibleIn(block,language)) ? [] : selected(project.personFieldsByLanguage?.[language] ?? project.personFields ?? personFields,personFields);
export function availablePersonFields(library) {
  return personFields.filter(key => ['name', 'headline', 'city'].includes(key) ? [library.person.zh[key], library.person.en[key]].some(value => value.trim()) : key==='website' ? Boolean(library.person.website.trim()||buildPersonLinks(library.person).length) : library.person[key].trim());
}

// Photo choice describes this language, including legacy shared photo blocks.
export function wizardPhotoState(library, project = null, language = project?.language || 'zh') {
  const photos = (project?.blocks || []).filter(block => block.kind === 'photo');
  const current = photos.find(block => !block.hiddenLanguages?.includes(language)) || null;
  return { current, available: current?.photo || library.person.photo || photos[0]?.photo || null };
}

export function createWizardDraft(library, { project = null } = {}) {
  return {
    isNew: !project, projectId: project?.id || null, step: 1, jobPreset: '',
    jobTitle: project?.jobTitle || '', jobDescription: project?.jobDescription || '',
    projectName: project?.name || '', template: project?.template || 'classic', language: project?.language || 'zh',
    entryIds: project ? selected(project.blocks.filter(block => block.kind === 'entry' && visibleIn(block,project.language)).map(block => block.sourceId).filter(Boolean)) : [],
    personFields: project ? profileSelection(project) : availablePersonFields(library),
    attachmentIds: project ? selected((project.attachments || []).map(item => item.id)) : [],
    usePhoto: Boolean(wizardPhotoState(library, project).current), photoFromLibrary: false, personalTemplateId: '',
    selectionInitialized: Boolean(project),
  };
}

export function recommendSelection(library, draft) {
  if (!hasRole(draft)) return { entryIds: library.entries.map(entry => entry.id), ranking: [], hasRole: false };
  const preset = findJobPreset(draft.jobPreset);
  const description = [draft.jobDescription || '', ...(preset?.keywords || [])].join(' ');
  const ranking = rankEntries(library.entries, draft.jobTitle || preset?.name || '', description);
  return { entryIds: ranking.map(item => item.entryId), ranking, hasRole: true };
}

// Initialize once so returning to the first step cannot discard manual selections.
export function initializeSelection(library, draft) {
  const next = clone(draft);
  if (!next.selectionInitialized) {
    next.entryIds = recommendSelection(library, next).entryIds;
    next.selectionInitialized = true;
  }
  if (!next.projectName.trim()) next.projectName = defaultName(next.jobTitle);
  return next;
}

export function selectionEntries(library, project = null) {
  const rows = library.entries.map(entry => ({ ...entry, savedOnly: false }));
  const known = new Set(rows.map(entry => entry.id));
  for (const block of project?.blocks || []) {
    if (block.kind !== 'entry' || !block.sourceId || known.has(block.sourceId)) continue;
    rows.push({ ...block, id: block.sourceId, savedOnly: true });
    known.add(block.sourceId);
  }
  return rows;
}

export function selectionAttachments(library, project = null) {
  const rows = (library.attachments || []).map(item => ({ ...item, savedOnly: false }));
  const known = new Set(rows.map(item => item.id));
  for (const attachment of project?.attachments || []) if (!known.has(attachment.id)) {
    rows.push({ ...attachment, savedOnly: true });
    known.add(attachment.id);
  }
  return rows;
}

function filteredLibrary(library, fields) {
  const filtered = clone(library);
  for (const key of personFields) if (!fields.includes(key)) {
    if (['name', 'headline', 'city'].includes(key)) for (const language of ['zh', 'en']) filtered.person[language][key] = '';
    else {filtered.person[key] = '';if(key==='website'){filtered.person.links=[];filtered.person.websiteLabel='';}}
  }
  return filtered;
}
function optionsFromDraft(draft) {
  return {
    name: draft.projectName?.trim() || defaultName(draft.jobTitle), jobTitle: draft.jobTitle?.trim() || '', jobDescription: draft.jobDescription?.trim() || '',
    template: draft.template || 'classic', language: draft.language || 'zh', entryIds: selected(draft.entryIds), attachmentIds: selected(draft.attachmentIds),
  };
}
function attachmentSnapshot(library, ids, project = null) {
  const sources = new Map([...(library.attachments || []), ...(project?.attachments || [])].map(item => [item.id, item]));
  return ids.filter(id => sources.has(id)).map(id => clone(sources.get(id)));
}

const contactFields = ['city', 'phone', 'email', 'website'];
const sameFields = (left, right) => left.length === right.length && left.every(key => right.includes(key));
function profileText(library, fields, language) { return profileContactData(library.person,language,fields); }
function sourceBody(project, library, fields, language) {
  return typeof project.profileSource?.[language]?.body === 'string' ? project.profileSource[language].body : profileText(library, fields, language).body;
}

export function getProfileSelectionConflicts(project, library, draft) {
  const language=draft.language||project.language,profiles = project.blocks.filter(block => block.kind === 'profile' && visibleIn(block,language));
  if (!profiles.length) return [];
  const previousFields = profileSelection(project,language);
  const fields = selected(draft.personFields, personFields);
  if (sameFields(previousFields.filter(key => contactFields.includes(key)), fields.filter(key => contactFields.includes(key)))) return [];
  return profiles.flatMap(profile => [language].filter(language => profile[language].body !== sourceBody(project, library, previousFields, language) || fields.includes('website')!==previousFields.includes('website') && formatLinkLines(profile.links,language)!==formatLinkLines(project.profileSource?.[language]?.links||profileText(library,previousFields,language).links,language)).map(language => ({ blockId: profile.id, blockTitle: profile[language].title || '基本信息', language, currentBody: profile[language].body, nextBody: profileText(library, fields, language).body })));
}

function usePersonalTemplate(project, draft, templates, measureBlock) {
  if (!draft.personalTemplateId) return project;
  const template = templates.find(item => item.id === draft.personalTemplateId);
  if (!template) throw new Error('所选个人模板已不存在，请重新选择。');
  return applyPersonalTemplate(project, template, {measureBlock});
}

export function createWizardProject(library, draft, { personalTemplates = [], measureBlock } = {}) {
  const fields = selected(draft.personFields, personFields);
  const project = createProject(filteredLibrary(library, fields), optionsFromDraft(draft));
  if (!fields.length) project.blocks = project.blocks.filter(block => block.kind !== 'profile');
  else project.profileSource = Object.fromEntries(['zh', 'en'].map(language => [language, { body: project.blocks[0][language].body, links:clone(project.blocks[0].links||[]) }]));
  project.personFields = fields;
  project.attachments = attachmentSnapshot(library, selected(draft.attachmentIds));
  if (draft.usePhoto) {
    if (!library.person.photo) throw new Error('资料库尚未添加照片，请先添加或取消勾选。');
    const photo = makePhotoBlock(library.person.photo); photo.x = project.paper.width - 16 - photo.width; project.blocks.push(photo);
  }
  captureProjectSources(project, library);
  pruneCanvasGroups(project);pruneReadingOrder(project);
  validateProject(project);
  return usePersonalTemplate(project, draft, personalTemplates, measureBlock);
}

export function updateWizardProject(project, library, draft, { profileBodyResolution = {}, personalTemplates = [], measureBlock } = {}) {
  const conflicts = getProfileSelectionConflicts(project, library, draft);
  if (conflicts.some(conflict => profileBodyResolution[conflict.blockId + ':' + conflict.language] !== 'replace')) {
    const error = new Error('联系方式有局部修改，请比较后选择如何继续。');
    error.code = 'PROFILE_SELECTION_CONFLICT'; error.conflicts = conflicts;
    throw error;
  }
  const next = clone(project);
  const options = optionsFromDraft(draft);
  const fields = selected(draft.personFields, personFields);
  const previousFields = profileSelection(project,options.language);
  const contactsChanged = !sameFields(previousFields.filter(key => contactFields.includes(key)), fields.filter(key => contactFields.includes(key)));
  applyLanguageLayout(next, options.language);
  // This edition has no geometry for hidden portraits. Ignore obsolete saved
  // target coordinates for them and keep the other edition's original frame.
  const hiddenPhotos = new Map(project.blocks.filter(block => block.kind === 'photo' && block.hiddenLanguages?.includes(next.language)).map(block => [block.id, block]));
  next.blocks = next.blocks.map(block => hiddenPhotos.has(block.id) ? clone(hiddenPhotos.get(block.id)) : block);
  const ids = new Set(options.entryIds),language=next.language,otherLanguage=language==='zh'?'en':'zh';
  next.personFieldsByLanguage={...next.personFieldsByLanguage,[otherLanguage]:profileSelection(project,otherLanguage),[language]:fields};
  next.blocks = next.blocks.filter(block => {
    if(!visibleIn(block,language))return true;
    const removed=block.kind==='profile'?!fields.length:block.kind==='entry'&&block.sourceId&&!ids.has(block.sourceId);
    if(!removed)return true;
    if(!visibleIn(block,otherLanguage))return false;
    block.hiddenLanguages=[...(block.hiddenLanguages||[]),language];return true;
  });
  // Link lists are shared by a block. Split only when changing website choices;
  // language-local title/body edits otherwise retain the original frame ID.
  if(fields.length && fields.includes('website')!==previousFields.includes('website')) {
    const mapping=new Map();
    next.blocks=next.blocks.flatMap(block=>{
      if(block.kind!=='profile'||!visibleIn(block,language)||!visibleIn(block,otherLanguage))return[block];
      const current=clone(block);current.id=crypto.randomUUID();current.hiddenLanguages=[otherLanguage];mapping.set(block.id,current.id);
      block.hiddenLanguages=[...(block.hiddenLanguages||[]),language];return[current,block];
    });
    for(const group of next.canvasGroupsByLanguage?.[language]||[])group.blockIds=group.blockIds.map(id=>mapping.get(id)||id);
    if(next.readingOrderByLanguage?.[language])next.readingOrderByLanguage[language]=next.readingOrderByLanguage[language].map(id=>mapping.get(id)||id);
    for(const maps of [next.layoutByLanguage,next.freeLayoutByLanguage])for(const [oldId,newId]of mapping)if(maps?.[language]?.positions[oldId])maps[language].positions[newId]=clone(maps[language].positions[oldId]);
  }
  const profiles = next.blocks.filter(block => block.kind === 'profile' && visibleIn(block,language));
  if (fields.length) {
    let restoredProfile = null;
    if (!profiles.some(profile => !profile.hiddenLanguages?.includes(next.language))) {
      restoredProfile = createProject(filteredLibrary(library, fields), { entryIds: [], attachmentIds: [] }).blocks[0];
      if (next.blocks.some(block=>block.kind==='profile')) {
        const other = next.language === 'en' ? 'zh' : 'en';
        restoredProfile[other] = { title: '', subtitle: '', body: '' };
        restoredProfile.hiddenLanguages = [other];
      }
      next.blocks.unshift(restoredProfile);
    } else for (const profile of profiles) {
      const generated = profileText(library, fields, language);
      if (!fields.includes('name') && previousFields.includes('name')) setBlockText(profile, language, 'title', '');
      else if (fields.includes('name') && !previousFields.includes('name')) setBlockText(profile, language, 'title', generated.title);
      if (!fields.includes('headline') && previousFields.includes('headline')) setBlockText(profile, language, 'subtitle', '');
      else if (fields.includes('headline') && !previousFields.includes('headline')) setBlockText(profile, language, 'subtitle', generated.subtitle);
      if (contactsChanged) setBlockText(profile, language, 'body', generated.body);
      if(fields.includes('website')!==previousFields.includes('website'))profile.links=clone(generated.links);
    }
    next.profileSource||={};next.profileSource[language]={body:contactsChanged||restoredProfile?profileText(library,fields,language).body:sourceBody(project,library,previousFields,language),links:clone(restoredProfile?restoredProfile.links||[]:fields.includes('website')!==previousFields.includes('website')?profileText(library,fields,language).links:project.profileSource?.[language]?.links||project.blocks.find(block=>block.kind==='profile'&&visibleIn(block,language))?.links||[])};
  }
  const retainedSources = new Set(next.blocks.filter(block => block.kind === 'entry').map(block => block.sourceId));
  const visibleSources = new Set(next.blocks.filter(block => block.kind === 'entry' && !block.hiddenLanguages?.includes(next.language)).map(block => block.sourceId));
  const libraryEntries = new Map(library.entries.map(entry => [entry.id, entry]));
  for (const sourceId of ids) if (!visibleSources.has(sourceId) && !libraryEntries.has(sourceId)) {
    const saved = next.blocks.find(block => block.kind === 'entry' && block.sourceId === sourceId);
    const title = saved?.[next.language]?.title || saved?.zh.title || saved?.en.title || '所选经历';
    const label = next.language === 'en' ? '英文' : '中文';
    const error = new Error(`“${title}”的${label}原文已不在当前简历和资料库，无法恢复。请先在资料库重新补充该语言，或取消勾选这段经历。`);
    error.code = 'ENTRY_LANGUAGE_SOURCE_MISSING'; error.sourceId = sourceId; error.language = next.language;
    throw error;
  }
  for (const entry of library.entries) if (ids.has(entry.id) && !visibleSources.has(entry.id)) {
    const restored = makeBlock(entry);
    if (retainedSources.has(entry.id)) {
      // The other language can have customized continuation frames. Restore only
      // the missing current language rather than duplicating or replacing them.
      const other = next.language === 'en' ? 'zh' : 'en';
      restored[other] = { title: '', subtitle: '', body: '' };
      if (restored.richText) delete restored.richText[other];
      restored.hiddenLanguages = [other];
    }
    next.blocks.push(restored); visibleSources.add(entry.id);
  }
  if (next.template !== options.template) applyLayoutMode(next, 'flow');
  Object.assign(next, { name: options.name, jobTitle: options.jobTitle, jobDescription: options.jobDescription, template: options.template, personFields: fields, attachments: attachmentSnapshot(library, options.attachmentIds, project) });
  const {current: photo, available: availablePhoto} = wizardPhotoState(library, next);
  const other = next.language === 'zh' ? 'en' : 'zh';
  if (!draft.usePhoto) {
    next.blocks = next.blocks.filter(block => {
      if (block.kind !== 'photo' || block.hiddenLanguages?.includes(next.language)) return true;
      // Shared portraits remain intact for the other version. Current-only
      // copies can be removed, along with their now-unused layout references.
      if (block.hiddenLanguages?.includes(other)) return false;
      block.hiddenLanguages = [...(block.hiddenLanguages || []), next.language];
      return true;
    });
  } else if (!photo || draft.photoFromLibrary) {
    const sourcePhoto = draft.photoFromLibrary ? library.person.photo : availablePhoto;
    if (!sourcePhoto) throw new Error('资料库尚未添加照片，当前简历也没有可用照片，请先添加或取消勾选。');
    if (!photo) {
      const added = makePhotoBlock(sourcePhoto);
      added.hiddenLanguages = [other]; added.x = next.paper.width - 16 - added.width;
      next.blocks.push(added);
    } else if (JSON.stringify(photo.photo) !== JSON.stringify(sourcePhoto)) {
      let target = photo;
      if (!photo.hiddenLanguages?.includes(other)) {
        // Replacing a legacy shared portrait must not change the other
        // language's picture, crop, coordinates, ID or saved layout.
        target = clone(photo); target.id = crypto.randomUUID(); target.hiddenLanguages = [other];
        photo.hiddenLanguages = [...(photo.hiddenLanguages || []), next.language];
        next.blocks.splice(next.blocks.indexOf(photo), 0, target);
      }
      target.photo = clone(sourcePhoto); target.sourceId = sourcePhoto.id;
    }
  }
  captureProjectSources(next, library, { previousProject: project });
  const blockIds = new Set(next.blocks.map(block => block.id));
  for (const layouts of [next.layoutByLanguage, next.freeLayoutByLanguage]) for (const layout of Object.values(layouts || {})) for (const id of Object.keys(layout.positions)) if (!blockIds.has(id)) delete layout.positions[id];
  pruneCanvasGroups(next);pruneReadingOrder(next);
  validateProject(next);
  return usePersonalTemplate(next, draft, personalTemplates, measureBlock);
}
