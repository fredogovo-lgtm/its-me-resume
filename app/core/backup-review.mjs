import {photoCrop} from './photo.mjs';
import {experienceFieldDefinitions} from './library-experience.mjs';
import {linkLabel,personWebsiteLabel} from './document-style.mjs';
// Read-only, direction-aware comparisons: before is replaced by after on restore.
const languages=[['zh','中文'],['en','英文']];
const clone=value=>structuredClone(value);
const title=entry=>entry?.zh?.title || entry?.en?.title || '未命名经历';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(left,right)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
const value=(object,key)=>object?.[key] ?? '';
const effectiveWebsiteLabel=(person,language)=>personWebsiteLabel(person,language) || person?.website || '';
const effectiveLinks=links=>links.map(link=>({url:link.url,...Object.fromEntries(languages.map(([language])=>[language,linkLabel(link,language)]))}));
function changed(changes,path,label,before,after){if(!same(before,after))changes.push({path,label,before:clone(before),after:clone(after)});}
// One description of supported library fields feeds contents, diff and restore review.
const field=(path,label,value,extra={})=>({path,label,value:clone(value),...extra});
export function personBackupFields(person={}, {language}={}) {
  const fields=[];
  for(const [lang,label] of languages)if(!language || language===lang)for(const [key,name] of [['name','姓名'],['headline','职业 / 求职方向'],['city','所在城市']])fields.push(field(`${lang}.${key}`,`${label}${name}`,value(person[lang],key)));
  for(const [key,label] of [['email','电子邮箱'],['phone','联系电话'],['website','个人网站 / 作品集链接'],['websiteLabel','网站显示名称']])fields.push(field(key,label,value(person,key)));
  for(const [lang,label] of languages)if(!language || language===lang)fields.push(field(`websiteLabelByLanguage.${lang}`,`${label}网站显示名称`,effectiveWebsiteLabel(person,lang),{languageOverride:true,hasOverride:Object.hasOwn(person.websiteLabelByLanguage || {},lang)}));
  fields.push(field('links','其他链接',person.links || [],{comparisonValue:effectiveLinks(person.links || [])}));
  return fields;
}
export function entryBackupFields(entry={}, {language}={}) {
  const fields=[field('category','分类',value(entry,'category')),field('tags','标签',entry.tags || []),field('companyGroupId','关联公司经历',entry.companyGroupId || ''),field('attachmentIds','关联补充文件',entry.attachmentIds || [])];
  for(const [lang,label] of languages)if(!language || language===lang){
    fields.push(field(`${lang}.period`,`${label}时间`,entry.periodByLanguage?.[lang] ?? entry.period ?? ''));
    for(const [key,name] of [['title','标题'],['subtitle','补充说明'],['body','正文']]){
      fields.push(field(`${lang}.${key}`,`${label}${name}`,value(entry[lang],key)));
      fields.push(field(`${lang}.${key}.style`,`${label}${name}局部样式`,entry.richText?.[lang]?.[key] || []));
    }
    const experience=entry.experienceByLanguage?.[lang] || {};
    for(const {key,label:name,category} of experienceFieldDefinitions)fields.push(field(`experienceByLanguage.${lang}.${key}`,`${label}${name}`,experience[key] ?? '',{experienceCategory:category}));
    fields.push(field(`experienceByLanguage.${lang}.showCompanyTenure`,`${label}展示公司总任期`,experience.showCompanyTenure ?? false,{experienceCategory:'work'}));
    fields.push(field(`stale.${lang}`,`${label}待核对状态`,Boolean(entry.stale?.[lang])));
  }
  return fields;
}
// Resolve identifiers against the corresponding version, without comparing names
// in place of stable IDs. Missing old relationships remain readable and intact.
export function backupFieldText({path,value},library={}) {
  if(path==='links')return value.length?value.map(link=>`${link.label || link.url} | ${link.url}${link.labels && Object.keys(link.labels).length ? '（'+languages.map(([lang,label])=>label+'：'+linkLabel(link,lang)).join('；')+'）' : ''}`).join('\n'):'无';
  if(path==='companyGroupId'){
    if(!value)return '未关联';
    const entry=library.entries?.find(entry=>entry.id===value);
    return entry?`${title(entry)}（${value}）`:`未找到关联经历（${value}）`;
  }
  if(path==='attachmentIds')return value.length?value.map(id=>{const file=library.attachments?.find(file=>file.id===id);return file?`${file.name}（${id}）`:`未找到补充文件（${id}）`;}).join('\n'):'无';
  if(path.startsWith('stale.'))return value?'待核对':'已核对';
  if(typeof value==='boolean')return value?'是':'否';
  return value;
}
function compareFields(changes,before,after){
  const oldMap=new Map(before.map(item=>[item.path,item]));
  for(const item of after){
    const previous=oldMap.get(item.path);
    // A shared legacy default already has its own change row. Only compare a
    // language row when either version explicitly overrides that default.
    if(item.languageOverride && !item.hasOverride && !previous?.hasOverride)continue;
    // Equivalent explicit labels do not become false display changes. Keep the
    // original detached before/after link objects for the actual review text.
    if(!same(previous?.comparisonValue ?? previous?.value ?? '',item.comparisonValue ?? item.value))changed(changes,item.path,item.label,previous?.value ?? '',item.value);
  }
}
function entriesDiff(before,after){
  const oldMap=new Map(before.map(entry=>[entry.id,entry])),newMap=new Map(after.map(entry=>[entry.id,entry]));
  const added=after.filter(entry=>!oldMap.has(entry.id)).map(entry=>({id:entry.id,title:title(entry),entry:clone(entry)}));
  const removed=before.filter(entry=>!newMap.has(entry.id)).map(entry=>({id:entry.id,title:title(entry),entry:clone(entry)}));
  const modified=[];
  for(const entry of after){
    const old=oldMap.get(entry.id);if(!old)continue;
    const changes=[];compareFields(changes,entryBackupFields(old),entryBackupFields(entry));
    if(changes.length)modified.push({id:entry.id,title:title(entry),beforeTitle:title(old),changes});
  }
  const oldCommon=before.filter(entry=>newMap.has(entry.id)).map(entry=>entry.id),newCommon=after.filter(entry=>oldMap.has(entry.id)).map(entry=>entry.id);
  return {added,removed,modified,reordered:!same(oldCommon,newCommon)};
}
function attachmentsDiff(before,after){
  const oldMap=new Map(before.map(file=>[file.id,file])),newMap=new Map(after.map(file=>[file.id,file]));
  const added=after.filter(file=>!oldMap.has(file.id)).map(file=>({...clone(file)}));
  const removed=before.filter(file=>!newMap.has(file.id)).map(file=>({...clone(file)}));
  const modified=[];
  for(const file of after){const old=oldMap.get(file.id);if(!old)continue;const changes=[];
    for(const [key,label] of [['name','文件名'],['size','文件大小'],['mime','文件类型'],['addedAt','添加时间'],['storedFile','文件内容'],['sha256','文件版本校验']])changed(changes,key,label,old[key] ?? '',file[key] ?? '');
    if(changes.length)modified.push({id:file.id,name:file.name || old.name || '未命名文件',changes});
  }
  return {added,removed,modified};
}
function photoSummary(photo){
  if(!photo)return null;return{...Object.fromEntries(['id','name','width','height','updatedAt'].map(key=>[key,value(photo,key)])),crop:photoCrop(photo)};
}
function photoDiff(before,after){
  const changes=[],old=photoSummary(before),next=photoSummary(after);
  if(!before||!after){const action=before?'removed':after?'added':'unchanged';if(action!=='unchanged')changed(changes,'presence','个人照片',before?'已保存照片':'无照片',after?'已保存照片':'无照片');return{action,before:old,after:next,changes};}
  // Compare image bytes, but expose only a readable change marker in the diff.
  if(before.dataUrl!==after.dataUrl)changes.push({path:'dataUrl',label:'照片图像内容',before:'原照片图像',after:'此版本照片图像（已变更）'});
  for(const[key,label]of[['id','照片版本'],['name','照片名称'],['width','图片宽度'],['height','图片高度'],['updatedAt','保存时间']])changed(changes,key,label,value(before,key),value(after,key));
  for(const[key,label]of[['x','取景水平位置'],['y','取景垂直位置'],['zoom','取景放大倍数'],['shape','照片形状']])changed(changes,'crop.'+key,label,old.crop[key],next.crop[key]);
  return{action:changes.length?'modified':'unchanged',before:old,after:next,changes};
}
export function reviewLibraryChanges(before,after){
  const person=[];compareFields(person,personBackupFields(before?.person),personBackupFields(after?.person));
  const entries=entriesDiff(before?.entries || [],after?.entries || []),attachments=attachmentsDiff(before?.attachments || [],after?.attachments || []),photo=photoDiff(before?.person?.photo,after?.person?.photo);
  const summary={photosAdded:Number(photo.action==='added'),photosRemoved:Number(photo.action==='removed'),photosModified:Number(photo.action==='modified'),personalFields:person.length,entriesAdded:entries.added.length,entriesRemoved:entries.removed.length,entriesModified:entries.modified.length,attachmentsAdded:attachments.added.length,attachmentsRemoved:attachments.removed.length,attachmentsModified:attachments.modified.length};
  return {person,photo,entries,attachments,summary,hasChanges:Object.values(summary).some(Boolean)||entries.reordered};
}
