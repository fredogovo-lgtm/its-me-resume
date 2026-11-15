import {materializeExperience} from './library-experience.mjs';
import {profileContactData,buildPersonLinks,formatLinkLines,safeLinkTarget,adoptLinkLanguage} from './document-style.mjs';
import { getPeriod, setPeriod } from './entry-content.mjs';
import { setBlockText } from './rich-text.mjs';

const languages = ['zh', 'en'];
const personalFields = ['name', 'headline', 'city', 'phone', 'email', 'website'];
const contactFields = ['city', 'phone', 'email', 'website'];
const clone = value => structuredClone(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const own = (value, field) => Object.prototype.hasOwnProperty.call(value || {}, field);
const visible = (block, language) => !block.hiddenLanguages?.includes(language);
const plainWebsite = value => value && !safeLinkTarget(value) ? value : '';
const linkComparisonText = (plain,links,language) => [plainWebsite(plain),formatLinkLines(links,language)].filter(Boolean).join('\n');
const sameLinks = (left,right,language) => formatLinkLines(left,language) === formatLinkLines(right,language);
const personValue = (person, field, language) => String(['name', 'headline', 'city'].includes(field) ? person?.[language]?.[field] || '' : person?.[field] || '');
const selectedPersonFields = (project,language=project.language) => (project.personFieldsByLanguage?.[language] ?? project.personFields ?? personalFields).filter(field => personalFields.includes(field));
function personSnapshot(person,structured=false) {
  const result = Object.fromEntries(languages.map(language => [language, Object.fromEntries(personalFields.map(field => [field, personValue(person, field, language)]))]));
  // The shared values also describe the initial library source, while each
  // language has its own accepted version after a selective refresh.
  for (const field of ['phone', 'email', 'website']) result[field] = personValue(person, field, 'zh');
  if(structured)for(const language of languages)captureLinkBaseline(result[language],person);
  return result;
}
function captureLinkBaseline(values,person) { values.linkFormat=true;values.website=person.website||'';values.websiteLabel=person.websiteLabel||'';values.extraLinks=clone(person.links||[]);values.websiteLinks=buildPersonLinks(person); }
function entrySnapshot(entry) {
  entry=materializeExperience(entry);
  return { category: entry.category, tags: clone(entry.tags || []), ...Object.fromEntries(languages.map(language => [language, { ...clone(entry[language]), period: getPeriod(entry, language) }])) };
}
function blankSnapshot() { return { version: 1, person: { zh: {}, en: {} }, entries: {} }; }
function knownSnapshot(project) { return project.sourceSnapshot?.version === 1 ? project.sourceSnapshot : null; }

// Capture only new sources. Re-opening the material picker must not advance a
// retained source's baseline past changes the user has not reviewed.
export function captureProjectSources(project, library, { previousProject = null } = {}) {
  const existing = knownSnapshot(project);
  if (!existing) project.sourceSnapshot = previousProject ? blankSnapshot() : { version: 1, person: personSnapshot(library.person,project.blocks.some(block=>block.kind==='profile'&&block.links!==undefined)), entries: {} };
  const snapshot = project.sourceSnapshot;
  snapshot.person ||= { zh: {}, en: {} };
  for (const language of languages) {
    const fields=selectedPersonFields(project,language),previousFields=previousProject?selectedPersonFields(previousProject,language):snapshot.personFields||fields;
    const contactSelectionChanged=previousProject&&!same(previousFields.filter(field=>contactFields.includes(field)).sort(),fields.filter(field=>contactFields.includes(field)).sort());
    snapshot.person[language] ||= {};
    const restored = previousProject && project.blocks.some(block => block.kind === 'profile' && visible(block, language)) && !previousProject.blocks.some(block => block.kind === 'profile' && visible(block, language));
    for (const field of fields) if (!previousFields.includes(field) || restored) snapshot.person[language][field] = personValue(library.person, field, language);
    const profiles = project.blocks.filter(block => block.kind === 'profile' && visible(block, language));
    const adoptedBody = profileContactData(library.person,language,fields).body;
    if((restored||!previousFields.includes('website')) && profiles.some(profile=>profile.links!==undefined))captureLinkBaseline(snapshot.person[language],library.person);
    // A material-picker choice can explicitly regenerate a contact body. Only
    // recognize that exact generated result; never infer structure from edits.
    if (contactSelectionChanged && profiles.length === 1 && !profiles[0].continuation && profiles[0][language].body === adoptedBody) {
      for (const field of fields.filter(field => contactFields.includes(field))) snapshot.person[language][field] = personValue(library.person, field, language);
      if(profiles[0].links!==undefined && sameLinks(profiles[0].links,buildPersonLinks(library.person),language))captureLinkBaseline(snapshot.person[language],library.person);
    }
  }
  snapshot.personFields = [...selectedPersonFields(project)];
  snapshot.entries ||= {};
  const sourceIds = new Set(project.blocks.filter(block => block.kind === 'entry' && block.sourceId).map(block => block.sourceId));
  for (const entry of library.entries || []) if (sourceIds.has(entry.id)) {
    const retained = previousProject?.blocks.some(block => block.kind === 'entry' && block.sourceId === entry.id);
    if (!snapshot.entries[entry.id] && !retained) snapshot.entries[entry.id] = entrySnapshot(entry);
    if (retained) for (const language of languages) {
      const restored = project.blocks.some(block => block.sourceId === entry.id && visible(block, language)) && !previousProject.blocks.some(block => block.sourceId === entry.id && visible(block, language));
      if (restored) { snapshot.entries[entry.id] ||= {}; snapshot.entries[entry.id][language] = entrySnapshot(entry)[language]; }
    }
  }
  return project;
}

function contactBody(values, fields) {
  if(values?.linkFormat) return profileContactData({zh:{city:values.city||''},en:{city:values.city||''},phone:values.phone||'',email:values.email||'',website:values.website||'',websiteLabel:values.websiteLabel||'',links:values.extraLinks||[]},'zh',fields).body;
  return contactFields.filter(field => fields.includes(field)).map(field => values?.[field] || '').filter(Boolean).join(' · ');
}
function fieldBaseline(snapshot, field, language) {
  const values = snapshot?.person?.[language];
  if (own(values, field)) return { known: true, value: values[field] };
  // Tolerate snapshots created by an early build with shared contact values.
  if (!['name', 'headline', 'city'].includes(field) && own(snapshot?.person, field)) return { known: true, value: snapshot.person[field] };
  return { known: false };
}
function contactBaseline(snapshot, fields, language) {
  const pairs = fields.filter(field => contactFields.includes(field)).map(field => [field, fieldBaseline(snapshot, field, language)]);
  if (pairs.some(([, value]) => !value.known)) return null;
  return {...Object.fromEntries(pairs.map(([field, value]) => [field, value.value])),...Object.fromEntries(['linkFormat','websiteLabel','extraLinks','websiteLinks'].filter(key=>own(snapshot?.person?.[language],key)).map(key=>[key,snapshot.person[language][key]]))};
}

export function compareProjectSources(project, library) {
  const snapshot = knownSnapshot(project), changes = [], unavailable = [];
  let baselineComplete = Boolean(snapshot);
  for (const language of languages) {
    const fields=selectedPersonFields(project,language);
    const profiles = project.blocks.filter(block => block.kind === 'profile' && visible(block, language));
    if (!profiles.length) continue;
    const primary = profiles.find(block => !block.continuation) || profiles[0];
    const contacts = contactBaseline(snapshot, fields, language);
    const bodyBaseline = contacts ? contactBody(contacts, fields) : undefined;
    for (const field of fields) {
      const baseline = fieldBaseline(snapshot, field, language), next = personValue(library.person, field, language);
      if (!baseline.known) baselineComplete = false;
      const textField = field === 'name' ? 'title' : field === 'headline' ? 'subtitle' : 'body';
      const isContact = textField === 'body';
      const current = isContact ? (baseline.known ? baseline.value : primary[language].body) : primary[language][textField];
      const structuredWebsite=field==='website' && primary.links!==undefined, baselineLinks=snapshot?.person?.[language]?.websiteLinks, nextLinks=buildPersonLinks(library.person);
      if(structuredWebsite&&!Array.isArray(baselineLinks))baselineComplete=false;
      const linksChanged=structuredWebsite && (!Array.isArray(baselineLinks) || !sameLinks(baselineLinks,nextLinks,language));
      if ((baseline.known ? same(baseline.value, next) : same(current, next)) && !linksChanged) continue;
      let blocked = false, reason = '';
      if (isContact && (!contacts || primary[language].body !== bodyBaseline)) {
        blocked = true;
        reason = contacts ? '基本信息正文有局部改写，无法可靠逐项替换。请保留现稿，手动复制新值，或返回选材比较后重新选择联系方式。' : '此旧项目没有联系方式来源基线，无法从组合正文可靠识别单个字段。请保留现稿并手动复制新值，或返回选材重新选择。';
      }
      if (isContact && (profiles.length > 1 || profiles.some(block => block.continuation))) { blocked = true; reason = '基本信息存在分页续框。请保留续稿，手动更新；需要重新选材时先保留当前内容。'; }
      if(structuredWebsite && (!Array.isArray(baselineLinks) || !sameLinks(primary.links,baselineLinks,language))) {blocked=true;reason=Array.isArray(baselineLinks)?'当前简历的链接已有局部修改，请保留链接并手动更新，或返回选材比较。':'此旧项目没有链接来源基线，请保留当前链接并手动更新。';}
      if(structuredWebsite)reason=[reason,'网址中英共用，显示名称按语言单独采用；另一语言的显示名称和正文保留。语言专属网址可保留在对应语言正文。'].filter(Boolean).join(' ');
      changes.push({ id: 'person:'+language+':'+field, kind:'person',language,field,sourceId:null,blockIds:[primary.id],title:'基本信息',baselineKnown:baseline.known && (!structuredWebsite || Array.isArray(baselineLinks)),previous:structuredWebsite ? Array.isArray(baselineLinks)?linkComparisonText(baseline.value,baselineLinks,language):undefined : baseline.value,current:structuredWebsite?linkComparisonText(baseline.value,primary.links,language):current,currentText:structuredWebsite?[primary[language].body,formatLinkLines(primary.links,language)].filter(Boolean).join('\n'):primary[language][textField],next:structuredWebsite?linkComparisonText(next,nextLinks,language):next,...(structuredWebsite?{sourceValue:next,nextLinks,nextWebsiteLabel:library.person.websiteLabel||'',nextExtraLinks:clone(library.person.links||[])}:{}),localChanged:structuredWebsite?!Array.isArray(baselineLinks)||!sameLinks(primary.links,baselineLinks,language):isContact?contacts?primary[language].body!==bodyBaseline:true:baseline.known&&current!==baseline.value,blocked,reason });
    }
  }
  const sources = new Map((library.entries || []).map(entry => [entry.id, entry]));
  const sourceIds = [...new Set(project.blocks.filter(block => block.kind === 'entry' && block.sourceId).map(block => block.sourceId))];
  for (const sourceId of sourceIds) {
    const blocks = project.blocks.filter(block => block.kind === 'entry' && block.sourceId === sourceId), rawSource = sources.get(sourceId), source = rawSource ? materializeExperience(rawSource) : null, previous = snapshot?.entries?.[sourceId];
    if (!source) { unavailable.push({ sourceId, title: blocks[0].zh.title || blocks[0].en.title || '经历', reason: '此来源已不在资料库；简历副本保留，不会删除。' }); continue; }
    for (const language of languages) {
      const active = blocks.filter(block => visible(block, language));
      if (!active.length) continue;
      const primary = active.find(block => !block.continuation) || active[0];
      for (const field of ['title', 'subtitle', 'body', 'period']) {
        const next = field === 'period' ? getPeriod(source, language) : source[language][field];
        const current = field === 'period' ? getPeriod(primary, language) : field === 'body' && active.length > 1 ? active.map(block => block[language].body).join('') : primary[language][field];
        const baselineKnown = own(previous?.[language], field), before = previous?.[language]?.[field];
        if (!baselineKnown) baselineComplete = false;
        if (baselineKnown ? same(before, next) : same(current, next)) continue;
        const blocked = field === 'body' && (active.length > 1 || active.some(block => block.continuation));
        changes.push({ id: `entry:${sourceId}:${language}:${field}`, kind: 'entry', sourceId, language, field, blockIds: [primary.id], title: primary[language].title || source[language].title || '经历', baselineKnown, previous: before, current, next, localChanged: baselineKnown && !same(current, before), blocked, reason: blocked ? '正文已有分页续框，不能直接用完整原文覆盖首框。请保留现有续稿并手动更新；如需重新选材，先复制保留现稿。' : '' });
      }
    }
    for (const field of ['category', 'tags']) {
      const baselineKnown = own(previous, field), before = previous?.[field], current = blocks[0][field], next = source[field];
      if (!baselineKnown) baselineComplete = false;
      if (baselineKnown ? same(before, next) : same(current, next)) continue;
      changes.push({ id: `entry:${sourceId}:${field}`, kind: 'entry', sourceId, language: null, field, blockIds: blocks.map(block => block.id), title: blocks[0].zh.title || source.zh.title || '经历', baselineKnown, previous: before, current: clone(current), next: clone(next), localChanged: baselineKnown && !same(current, before), blocked: false, reason: '' });
    }
  }
  return { baselineKnown: baselineComplete, changes, unavailable, updateCount: changes.filter(row => row.baselineKnown).length };
}

// A pure transaction: caller commits this result once through updateProject,
// providing one undo step. No source changes are selected implicitly.
export function applyProjectSourceUpdates(project, library, selection = []) {
  if (!Array.isArray(selection) || selection.some(id => typeof id !== 'string')) throw new Error('请选择要更新的具体字段。');
  const rows = new Map(compareProjectSources(project, library).changes.map(row => [row.id, row]));
  const chosen = [...new Set(selection)].map(id => { const row = rows.get(id); if (!row) throw new Error('资料来源已变化，请重新打开比较窗口。'); if (row.blocked) throw new Error(row.reason); return row; });
  const next = clone(project);
  if (!chosen.length) return next;
  next.sourceSnapshot = clone(knownSnapshot(next) || blankSnapshot());
  const snapshot = next.sourceSnapshot;
  snapshot.person ||= { zh: {}, en: {} }; snapshot.entries ||= {};
  for (const row of chosen) {
    if (row.kind === 'person') {
      snapshot.person[row.language] ||= {};
      snapshot.person[row.language][row.field] = row.sourceValue ?? row.next;
      if (row.nextLinks) {
        const target = next.blocks.find(block => block.id === row.blockIds[0]);
        target.links = adoptLinkLanguage(target.links || [],row.nextLinks,row.language);
        // Links are shared only by the two visible versions of this same block.
        // A restored independent language profile keeps its own source baseline.
        for (const language of languages.filter(language => visible(target, language))) {
          snapshot.person[language] ||= {};
          // Safe URL changes do not change body text. Plain website notes do:
          // advance their raw source only when this language adopted that body.
          if (language === row.language || plainWebsite(snapshot.person[language].website) === plainWebsite(row.sourceValue)) snapshot.person[language].website = row.sourceValue;
          Object.assign(snapshot.person[language], { linkFormat: true, websiteLinks: adoptLinkLanguage(snapshot.person[language].websiteLinks || [],row.nextLinks,row.language), websiteLabel: row.nextWebsiteLabel, extraLinks: clone(row.nextExtraLinks) });
          if (next.profileSource?.[language]) next.profileSource[language].links = adoptLinkLanguage(next.profileSource[language].links || [],row.nextLinks,row.language);
        }
      }
      const block = next.blocks.find(block => block.id === row.blockIds[0]);
      if (row.field === 'name' || row.field === 'headline') setBlockText(block, row.language, row.field === 'name' ? 'title' : 'subtitle', row.next);
    } else {
      snapshot.entries[row.sourceId] ||= { zh: {}, en: {} };
      const base = snapshot.entries[row.sourceId];
      if (row.language) { base[row.language] ||= {}; base[row.language][row.field] = row.next; }
      else base[row.field] = clone(row.next);
      for (const id of row.blockIds) {
        const block = next.blocks.find(block => block.id === id);
        if (row.field === 'period') setPeriod(block, row.language, row.next);
        else if (row.language) {setBlockText(block, row.language, row.field, row.next);if(row.field==='body'&&library.entries.find(entry=>entry.id===row.sourceId)?.experienceByLanguage?.[row.language])block.experienceByLanguage={...block.experienceByLanguage,[row.language]:clone(library.entries.find(entry=>entry.id===row.sourceId).experienceByLanguage[row.language])};}
        else block[row.field] = clone(row.next);
      }
    }
  }
  for (const language of languages) if (chosen.some(row => row.kind === 'person' && row.language === language && contactFields.includes(row.field))) {
    const body = contactBody(snapshot.person[language], selectedPersonFields(next,language));
    const block = next.blocks.find(block => block.kind === 'profile' && visible(block, language) && !block.continuation);
    setBlockText(block, language, 'body', body);
    next.profileSource ||= {}; next.profileSource[language] = { ...(next.profileSource[language] || {}), body };
  }
  // Adopting a partial source is not a whole-language review. Compare the
  // final transaction so choosing corresponding fields in both languages does
  // not depend on checkbox order; unrelated fields still require review.
  for (const block of next.blocks) {
    const before = project.blocks.find(item => item.id === block.id);
    if (!before) continue;
    for (const language of languages) {
      const other = language === 'zh' ? 'en' : 'zh';
      const value = (item, lang, field) => field === 'period' ? getPeriod(item, lang) : item[lang]?.[field] || '';
      if (['title','subtitle','body','period'].some(field => value(before,language,field) !== value(block,language,field) && value(before,other,field) === value(block,other,field))) {
        block.stale ||= {zh:false,en:false};
        block.stale[other] = true;
      }
    }
  }
  return next;
}
