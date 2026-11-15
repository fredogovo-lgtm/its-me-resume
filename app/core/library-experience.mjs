import {canonicalHttpLink} from './document-style.mjs';
import { getPeriod } from './entry-content.mjs';
import { setBlockText } from './rich-text.mjs';
import { entryLanguageStatus } from './content-check.mjs';

const languages = ['zh', 'en'];
export const experienceFieldDefinitions = Object.freeze([
  {key:'gpa',category:'education',label:'GPA / 成绩',max:160,placeholder:'例如：3.8 / 4.0（可选）'},
  {key:'courses',category:'education',label:'相关课程',max:3000,placeholder:'只列与这次申请有关的课程（可选）'},
  {key:'expectedGraduation',category:'education',label:'预计毕业时间',max:500,placeholder:'例如：预计 2027.06 毕业（可选）'},
  {key:'certificateIssuer',category:'certificate',label:'颁发方',max:500,placeholder:'可选'},
  {key:'certificateNumber',category:'certificate',label:'证书编号',max:500,placeholder:'可选；不需要公开的编号可留空'},
  {key:'certificateValidity',category:'certificate',label:'证书有效期',max:500,placeholder:'例如：2023.06—2026.12；原样保留'},
  {key:'certificateUrl',category:'certificate',label:'证书核验链接',max:2000,placeholder:'https://…（可选）'},
  {key:'careerBreak',category:'all',label:'职业间隔 / 补充说明',max:3000,placeholder:'可选，只填写你愿意在简历展示的说明'},
  {key:'companyGroup',category:'work',label:'关联公司的显示名称',max:500,placeholder:'可选，例如：远岭机电'},
  {key:'companyTenure',category:'work',label:'公司总任期',max:500,placeholder:'可选，由你填写，不自动推算'},
]);
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/u;
const fail = (path,message) => { throw new Error(path + ': ' + message); };
function plain(value,path) { if(!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) fail(path,'必须为普通对象'); }
function text(value,path,max) { if(typeof value !== 'string' || value.length > max || controls.test(value)) fail(path,'文本类型、长度或控制字符无效'); }
export function validateExperienceFields(entry,path='entry') {
  plain(entry,path);
  if(entry.companyGroupId !== undefined && (typeof entry.companyGroupId !== 'string' || (entry.companyGroupId !== '' && !idPattern.test(entry.companyGroupId)))) fail(path+'.companyGroupId','公司关联编号无效');
  if(entry.attachmentIds !== undefined) {
    if(!Array.isArray(entry.attachmentIds) || entry.attachmentIds.length > 2000 || new Set(entry.attachmentIds).size !== entry.attachmentIds.length) fail(path+'.attachmentIds','附件关联列表无效或重复');
    entry.attachmentIds.forEach(id=>{if(typeof id !== 'string' || !idPattern.test(id)) fail(path+'.attachmentIds','附件关联编号无效');});
  }
  if(entry.experienceByLanguage === undefined) return true;
  plain(entry.experienceByLanguage,path+'.experienceByLanguage');
  for(const [language,value] of Object.entries(entry.experienceByLanguage)) {
    if(!languages.includes(language)) fail(path+'.experienceByLanguage','仅支持中文和英文');
    const name=path+'.experienceByLanguage.'+language; plain(value,name);
    for(const [key,content] of Object.entries(value)) {
      if(key==='showCompanyTenure') { if(typeof content !== 'boolean') fail(name+'.'+key,'必须为布尔值'); continue; }
      const definition=experienceFieldDefinitions.find(field=>field.key===key);
      if(!definition) fail(name+'.'+key,'未知职业字段');
      text(content,name+'.'+key,definition.max);
      if(key==='certificateUrl' && content.trim()) { let url;try{url=new URL(content);}catch{fail(name+'.'+key,'核验链接需要完整http或https地址');} if(!['https:','http:'].includes(url.protocol) || !url.hostname || url.username || url.password || /[\r\n\t]/u.test(content)) fail(name+'.'+key,'核验链接需要完整http或https地址'); }
    }
  }
  return true;
}
export function getExperience(entry,language='zh') {
  if(!languages.includes(language)) throw new Error('资料语言无效。');
  return entry.experienceByLanguage?.[language] || {};
}
const labels={zh:{gpa:'GPA / 成绩',courses:'相关课程',expectedGraduation:'预计毕业',certificateIssuer:'颁发方',certificateNumber:'证书编号',certificateValidity:'有效期',certificateUrl:'核验链接',careerBreak:'职业间隔 / 补充说明',companyTenure:'公司总任期'},en:{gpa:'GPA',courses:'Relevant courses',expectedGraduation:'Expected graduation',certificateIssuer:'Issuer',certificateNumber:'Credential ID',certificateValidity:'Validity',certificateUrl:'Verification',careerBreak:'Career break / additional information',companyTenure:'Company tenure'}};
export function experienceLines(entry,language='zh') {
  const values=getExperience(entry,language), lines=[];
  for(const definition of experienceFieldDefinitions) {
    const {key,category}=definition, value=values[key]?.trim();
    if(!value || key==='companyGroup' || category!=='all' && category!==entry.category || key==='companyTenure' && !values.showCompanyTenure) continue;
    const company=key==='companyTenure' && values.companyGroup?.trim();
    lines.push(labels[language][key]+': '+(company ? company+' · ' : '')+(key==='certificateUrl' ? canonicalHttpLink(value)||value : value));
  }
  return lines;
}
// Generate only fresh source blocks. Retained local edits and continuations stay intact.
export function materializeExperience(entry) {
  validateExperienceFields(entry); const result=structuredClone(entry);
  for(const language of languages) {
    const body=String(result[language]?.body||''), normalized=body.replace(/\r\n/gu,'\n');
    const added=experienceLines(entry,language).filter(line=>{line=line.replace(/\r\n/gu,'\n');return normalized!==line&&!normalized.startsWith(line+'\n')&&!normalized.endsWith('\n'+line)&&!normalized.includes('\n'+line+'\n');});
    if(added.length) setBlockText(result,language,'body',[body,...added].filter(Boolean).join('\n'));
  }
  return result;
}
export function entryDisplay(entry,language='zh') {
  const current=entry[language]||{}, other=language==='zh'?'en':'zh', alternate=entry[other]||{}, status=entryLanguageStatus(entry,language);
  const sourceTitle=!String(current.title||'').trim() && status.hasReference ? String(alternate.title||'').trim():'';
  return {title:String(current.title||'').trim() || (sourceTitle ? sourceTitle+'（'+(other==='zh'?'中文':'英文')+'来源）':'未命名经历'),sourceTitle,missingFields:status.missingFields,sourceLanguage:other};
}
export function entryTags(entries) {return [...new Set(entries.flatMap(entry=>entry.tags||[]))].sort((a,b)=>a.localeCompare(b,'zh-CN'));}
function timeKey(entry,language) {
  const value=getPeriod(entry,language);
  if(/至今|现在|present|current/iu.test(value)) return Infinity;
  const matches=[...value.matchAll(/(?:^|[^\d])((?:19|20)\d{2})(?:[.\-/年]\s*(1[0-2]|0?[1-9]))?/gu)];
  if(!matches.length) return null;
  const match=matches.at(-1);return Number(match[1])*12+Number(match[2]||1);
}
export function filterExperienceEntries(entries,{query='',category='',tag='',sort='default'}={},language='zh') {
  const terms=String(query).toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  const rows=entries.filter(entry=>(!category || entry.category===category || category==='other' && !['work','project','education','skills','certificate'].includes(entry.category)) && (!tag || (entry.tags||[]).includes(tag)) && terms.every(term=>[entry.zh?.title,entry.zh?.subtitle,entry.zh?.body,entry.en?.title,entry.en?.subtitle,entry.en?.body,getPeriod(entry,language),...(entry.tags||[]),...Object.values(getExperience(entry,'zh')),...Object.values(getExperience(entry,'en'))].join(' ').toLocaleLowerCase().includes(term)));
  if(!['newest','oldest'].includes(sort)) return rows;
  return rows.map((entry,index)=>({entry,index,key:timeKey(entry,language)})).sort((a,b)=>a.key===null ? b.key===null ? a.index-b.index:1 : b.key===null ? -1 : a.key===b.key ? a.index-b.index : (a.key>b.key?1:-1)*(sort==='newest'?-1:1)).map(row=>row.entry);
}
export function attachmentSelectionWarnings(entries,entryIds=[],attachmentIds=[]) {
  const selectedEntries=new Set(entryIds), selectedAttachments=new Set(attachmentIds), relationships=new Map();
  for(const entry of entries) for(const id of entry.attachmentIds||[]) { const links=relationships.get(id)||[]; links.push(entry); relationships.set(id,links); }
  return [...relationships].filter(([id,links])=>selectedAttachments.has(id) && !links.some(entry=>selectedEntries.has(entry.id))).map(([attachmentId,links])=>({attachmentId,entryIds:links.map(entry=>entry.id),titles:links.map(entry=>entry.zh?.title||entry.en?.title||'未命名项目')}));
}
