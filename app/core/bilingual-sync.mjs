import {createAiTask} from './ai-tasks.mjs';
import {applyAiChanges,readAiField} from './ai-apply.mjs';
import {getPeriod,setPeriod} from './entry-content.mjs';
import {experienceAiFields,readExperienceAiField,setExperienceAiField,isExperienceIdentityField,aiExperienceFieldLabels,aiExperienceFieldLimits} from './ai-experience.mjs';
import {personWebsiteLabel} from './document-style.mjs';
import {setBlockText} from './rich-text.mjs';
import {validateLibrary,validateProject} from './model.mjs';
const languages=['zh','en'],plainFields=['title','subtitle','body'];
const fieldLabels={name:'姓名',headline:'职业方向',city:'城市',title:'标题',subtitle:'补充说明',body:'正文',period:'时间',websiteLabel:'网站显示名称',linkLabel:'链接显示名称',...aiExperienceFieldLabels};
const limits={name:80,headline:160,city:160,title:240,subtitle:500,body:30000,period:120,websiteLabel:200,linkLabel:200,...aiExperienceFieldLimits};
const other=language=>language==='zh'?'en':'zh';
const rowFor=(document,scope,id)=>scope==='library'?(id==='person'?document.person:document.entries.find(row=>row.id===id)):document.blocks.find(row=>row.id===id);
const rawLabel=(row,language)=>String(row?.labels?.[language]??row?.label??'');
function read(row,field,language,url){
 if(field==='period')return getPeriod(row,language);
 if(field.startsWith('experience.'))return readExperienceAiField(row,language,field);
 if(field==='websiteLabel')return personWebsiteLabel(row,language);
 if(field==='linkLabel')return rawLabel(row.links?.find(link=>link.url===url),language);
 return row[language]?.[field]||'';
}
function descriptors(row,scope,id){
 const person=scope==='library'&&id==='person';
 const fields=person?['name','headline','city',...(row.website?['websiteLabel']:[])]:[...plainFields,...(scope==='library'||row.kind==='entry'?['period']:[]),...(scope==='library'?experienceAiFields(row):[])];
 return [...fields.map(field=>({field})),...(row.links||[]).map(link=>({field:'linkLabel',url:link.url}))];
}
function snapshot(row,scope,id){
 if(!row)return null;
 const all={kind:row.kind||'',category:row.category||'',locked:Boolean(row.locked),hiddenLanguages:row.hiddenLanguages||[],links:row.links||[],website:row.website||''};
 for(const language of languages)all[language]=descriptors(row,scope,id).map(d=>[d.field,d.url||'',read(row,d.field,language,d.url)]);
 return JSON.stringify(all);
}
function manualReason(row,scope,id,field,source,target){
 if(!source.trim())return '源内容已清空；请手动决定保留或清空另一版。';
 if(['websiteLabel','linkLabel'].includes(field))return '链接显示名称可在这里手动核对；网址保持共用。';
 if(scope==='project'&&row.kind==='profile'&&field==='body')return '联系信息请手动核对，不发送给翻译服务。';
 if(target.trim()&&(isExperienceIdentityField(field)||field==='name'||field==='period'||(row.kind==='profile'&&field==='title')||(field==='subtitle'&&['work','education'].includes(row.category))))return '已有姓名、机构或日期受到保护；请手动核对。';
 return '';
}
function continuationFamily(document,row){
 if(!document?.blocks)return [];
 const byId=new Map(document.blocks.map(block=>[block.id,block]));
 const ancestor=id=>{const seen=new Set([id]);while(byId.get(id)?.continuation){const parent=byId.get(id).continuation.sourceBlockId;if(!byId.has(parent)||seen.has(parent))break;seen.add(parent);id=parent;}return id;};
 const root=ancestor(row.id);return document.blocks.filter(block=>ancestor(block.id)===root);
}
function continuationContext(document,row,language){
 const family=continuationFamily(document,row);
 if(family.length<2&&!row.continuation)return null;
 return {relatedSourceText:family.filter(block=>!block.hiddenLanguages?.includes(language)).map(block=>block[language]?.body||'').join(''),relatedTargetText:family.filter(block=>!block.hiddenLanguages?.includes(other(language))).map(block=>block[other(language)]?.body||'').join('')};
}
function familySignature(document,row){const family=continuationFamily(document,row);return family.length>1||row.continuation?JSON.stringify(family.map(block=>({id:block.id,continuation:block.continuation||null,hidden:block.hiddenLanguages||[],zh:block.zh,en:block.en}))):'';}
function savedSnapshot(document,row,scope,id,targetWasStale){return {id,signature:snapshot(row,scope,id),targetWasStale,...(scope==='project'?{familySignature:familySignature(document,row)}:{})};}
function contextualChange(document,row,scope,language,change){
 const context=scope==='project'&&change.field==='body'?continuationContext(document,row,language):null;
 return context?{...change,...context,aiEligible:false,manualReason:'该模块包含分语言续框；另一版完整正文可能仍保留在首框。请结合完整来源手动合并核对，本字段不会用AI片段覆盖完整译文。'}:change;
}
export function createBilingualSyncPlan(before,after,{scope='library',selection='person',ids,language=after?.language||'zh'}={}){
 if(!['library','project'].includes(scope)||!languages.includes(language))throw Error('双语同步范围或语言无效。');
 const selected=scope==='library'?[selection]:ids||after.blocks.filter(row=>!['line','shape','photo'].includes(row.kind)&&!row.hiddenLanguages?.includes(language)).map(row=>row.id);
 const changes=[],snapshots=[];
 for(const id of [...new Set(selected)]){
  const row=rowFor(after,scope,id),old=rowFor(before,scope,id);if(!row||scope==='project'&&(['line','shape','photo'].includes(row.kind)||row.hiddenLanguages?.includes(language)))continue;
  const existing=old?descriptors(old,scope,id):[];
  for(const descriptor of descriptors(row,scope,id)){
   const {field,url}=descriptor,source=read(row,field,language,url),target=read(row,field,other(language),url);
   let prior=old&&existing.some(d=>d.field===field&&d.url===url)?read(old,field,language,url):'';
   if(field==='linkLabel'&&old&&!existing.some(d=>d.url===url)){
    const equivalent=(old.links||[]).filter(link=>rawLabel(link,language)===source);
    if(equivalent.length)prior=source; // Changing only a shared URL is not a text edit.
   }
   if(source===prior||!old&&target.trim()&&!row.stale?.[other(language)])continue;
   const reason=manualReason(row,scope,id,field,source,target);
   changes.push(contextualChange(after,row,scope,language,{id,field,...(url?{url}:{}),key:JSON.stringify([id,field,url||'']),label:fieldLabels[field]||field,source,beforeSource:prior,target,maxLength:limits[field]||2000,aiEligible:!reason,manualReason:reason}));
  }
  if(changes.some(change=>change.id===id))snapshots.push(savedSnapshot(after,row,scope,id,Boolean(old?.stale?.[other(language)]))); 
 }
 return {scope,documentId:scope==='project'?after.id:null,sourceLanguage:language,targetLanguage:other(language),changes,snapshots};
}
// An explicit user-requested review can include every counterpart, even when
// there is no pending save delta (for example after a restart or old data).
export function createBilingualReviewPlan(document,{scope='library',selection='person',ids,language=document?.language||'zh'}={}){
 const plan=createBilingualSyncPlan(document,document,{scope,selection,ids,language});plan.reviewOnly=true;
 const selected=scope==='library'?[selection]:ids||document.blocks.filter(row=>!['line','shape','photo'].includes(row.kind)&&!row.hiddenLanguages?.includes(language)).map(row=>row.id);
 for(const id of [...new Set(selected)]){const row=rowFor(document,scope,id);if(!row||scope==='project'&&(['line','shape','photo'].includes(row.kind)||row.hiddenLanguages?.includes(language)))continue;
  for(const {field,url}of descriptors(row,scope,id)){const source=read(row,field,language,url),target=read(row,field,other(language),url);if(!source&&!target)continue;const reason=manualReason(row,scope,id,field,source,target);plan.changes.push(contextualChange(document,row,scope,language,{id,field,...(url?{url}:{}),key:JSON.stringify([id,field,url||'']),label:fieldLabels[field]||field,source,beforeSource:source,target,maxLength:limits[field]||2000,aiEligible:!reason,manualReason:reason}));}
  if(plan.changes.some(change=>change.id===id))plan.snapshots.push(savedSnapshot(document,row,scope,id,false));
 }return plan;
}
export function assertBilingualSyncCurrent(document,plan){
 if(!plan||!['library','project'].includes(plan.scope)||!languages.includes(plan.sourceLanguage)||plan.targetLanguage!==other(plan.sourceLanguage)||!Array.isArray(plan.changes)||!Array.isArray(plan.snapshots))throw Error('双语同步计划无效，请重新选择。');
 if(plan.scope==='project'&&document.id!==plan.documentId)throw Error('当前简历已有变化，请重新选择同步范围。');
 for(const saved of plan.snapshots){const row=rowFor(document,plan.scope,saved.id);if(!row)throw Error('对应资料已不存在，请重新选择同步范围。');if(snapshot(row,plan.scope,saved.id)!==saved.signature||plan.scope==='project'&&familySignature(document,row)!==saved.familySignature)throw Error('源内容或另一版已有变化，请重新核对后同步。');}
 const keys=new Set();for(const change of plan.changes){const row=rowFor(document,plan.scope,change.id),known=row&&descriptors(row,plan.scope,change.id).some(d=>d.field===change.field&&d.url===change.url);if(!known||!plan.snapshots.some(saved=>saved.id===change.id)||change.key!==JSON.stringify([change.id,change.field,change.url||''])||change.maxLength!==(limits[change.field]||2000)||keys.has(change.key)||read(row,change.field,plan.sourceLanguage,change.url)!==change.source||read(row,change.field,plan.targetLanguage,change.url)!==change.target)throw Error('同步计划字段超出本次范围，请重新选择。');keys.add(change.key);}
 return true;
}
function checkedConsumption(document,plan,consumedKeys){
 if(!plan||!['library','project'].includes(plan.scope)||!languages.includes(plan.sourceLanguage)||!Array.isArray(plan.changes)||!Array.isArray(plan.snapshots)||!Array.isArray(consumedKeys))throw Error('同步剩余范围无效。');
 if(plan.scope==='project'&&document.id!==plan.documentId)throw Error('当前简历已有变化，请重新核对。');
 const keys=new Set(plan.changes.map(change=>change.key)),consumed=new Set();
 for(const key of consumedKeys){if(!keys.has(key)||consumed.has(key))throw Error('同步消费选择超出范围或重复。');consumed.add(key);}
 for(const change of plan.changes){const row=rowFor(document,plan.scope,change.id);if(!row||!descriptors(row,plan.scope,change.id).some(d=>d.field===change.field&&d.url===change.url)||change.key!==JSON.stringify([change.id,change.field,change.url||'']))throw Error('同步字段超出剩余范围。');if(read(row,change.field,plan.sourceLanguage,change.url)!==change.source)throw Error('源内容已有变化，请重新核对。');}
 return consumed;
}
function writeSyncField(row,scope,id,field,language,value,url){
 if(field==='period')setPeriod(row,language,value);
 else if(field.startsWith('experience.'))setExperienceAiField(row,language,field,value);
 else if(field==='websiteLabel')row.websiteLabelByLanguage={...row.websiteLabelByLanguage,[language]:value};
 else if(field==='linkLabel'){const link=row.links.find(link=>link.url===url);if(!link)throw Error('链接已有变化，请重新核对。');link.labels={...link.labels,[language]:value};}
 else if(scope==='library'&&id==='person')row[language][field]=value;
 else setBlockText(row,language,field,value);
}
// Rebuild a local pending baseline after selected fields have been accepted.
// Counterpart text is never copied back into source, and preexisting review
// obligations survive until an explicit complete review acknowledges them.
export function createBilingualSyncBaseline(document,plan,{consumedKeys=[]}={}){
 const consumed=checkedConsumption(document,plan,consumedKeys),baseline=structuredClone(document);
 for(const change of plan.changes)if(!consumed.has(change.key))writeSyncField(rowFor(baseline,plan.scope,change.id),plan.scope,change.id,change.field,plan.sourceLanguage,change.beforeSource,change.url);
 for(const saved of plan.snapshots){const row=rowFor(baseline,plan.scope,saved.id);if(row){row.stale||={zh:false,en:false};row.stale[plan.targetLanguage]=saved.targetWasStale;}}
 return baseline;
}
// A partial save changes the counterpart signature. Rebase the remaining rows
// on that committed document while retaining their original review obligation.
export function remainingBilingualSyncPlan(document,plan,consumedKeys=[]){
 const consumed=checkedConsumption(document,plan,consumedKeys),next={...structuredClone(plan),changes:[],snapshots:[]};
 for(const change of plan.changes){if(consumed.has(change.key))continue;const row=rowFor(document,plan.scope,change.id),target=read(row,change.field,plan.targetLanguage,change.url),reason=manualReason(row,plan.scope,change.id,change.field,change.source,target);next.changes.push(contextualChange(document,row,plan.scope,plan.sourceLanguage,{...structuredClone(change),target,aiEligible:!reason,manualReason:reason}));}
 for(const saved of plan.snapshots)if(next.changes.some(change=>change.id===saved.id))next.snapshots.push(savedSnapshot(document,rowFor(document,plan.scope,saved.id),plan.scope,saved.id,saved.targetWasStale));
 return next;
}
export function applyBilingualSync(document,plan,edits){
 assertBilingualSyncCurrent(document,plan);
 if(!Array.isArray(edits)||!edits.length)throw Error('请勾选要保存的对应字段。');
 const next=structuredClone(document),seen=new Set();
 for(const edit of edits){
  const change=plan.changes.find(item=>item.key===edit?.key);
  if(!change)throw Error('同步字段超出本次变更范围。');
  if(seen.has(edit.key))throw Error('同步字段重复。');seen.add(edit.key);
  if(typeof edit.value!=='string'||edit.value.length>change.maxLength||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(edit.value))throw Error(change.label+'最多'+change.maxLength+'个字符，且不能包含控制字符。');
  const row=rowFor(next,plan.scope,change.id),language=plan.targetLanguage;
  if(plan.scope==='project'&&row.locked)throw Error('对应文本框已锁定，请解锁后同步。');
  writeSyncField(row,plan.scope,change.id,change.field,language,edit.value,change.url);
  if(row.hiddenLanguages?.includes(language))row.hiddenLanguages=row.hiddenLanguages.filter(item=>item!==language);
 }
 for(const saved of plan.snapshots){const row=rowFor(next,plan.scope,saved.id),changes=plan.changes.filter(c=>c.id===saved.id);row.stale||={zh:false,en:false};row.stale[plan.targetLanguage]=saved.targetWasStale||!changes.every(change=>seen.has(change.key));}
 if(plan.scope==='library')validateLibrary(next);else validateProject(next);return next;
}

// Only a successful, exactly identified local partial transaction may advance
// target references for its remaining candidates. Source evidence and target
// before-fields deliberately retain the original generation snapshots.
export function rebaseBilingualSyncCandidateTask(before,after,plan,edits,input,candidate){
 const expected=applyBilingualSync(before,plan,edits);
 if(JSON.stringify(after)!==JSON.stringify(expected))throw Error('实际资料与本次同步事务不一致，不能刷新候选引用。');
 const task=createAiTask(input);
 if(task.protocolVersion!==2||task.action!=='translate'||task.sourceLanguage!==plan.sourceLanguage||task.targetLanguage!==plan.targetLanguage)throw Error('候选不属于本次翻译事务。');
 applyAiChanges(before,task,[candidate],{scope:plan.scope});
 const selected=edits.map(edit=>plan.changes.find(change=>change.key===edit.key)),next=structuredClone(task);
 for(const ref of next.references)if(selected.some(change=>change.id===ref.targetId&&change.field===ref.field&&!change.url))ref.targetText=readAiField(after,plan.scope,ref.targetId,plan.targetLanguage,ref.field);
 const rebased=createAiTask(next);
 if(JSON.stringify(rebased.sources)!==JSON.stringify(task.sources))throw Error('候选来源发生变化，不能刷新引用。');
 applyAiChanges(after,rebased,[candidate],{scope:plan.scope});
 return rebased;
}
