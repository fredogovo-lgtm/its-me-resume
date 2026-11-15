import {createAiTask,assessAiCandidate} from '../core/ai-tasks.mjs';
import {applyAiChanges,readAiField} from '../core/ai-apply.mjs';
import {assertAiContextCurrent} from './ai-content-task.mjs';
const key=change=>JSON.stringify([change.targetId,change.field]);
const sameSource=(a,b)=>a.kind===b.kind&&a.origin===b.origin&&a.targetId===b.targetId&&a.entryId===b.entryId&&a.field===b.field&&a.text===b.text;
const origin=task=>JSON.stringify([task.protocolVersion,task.action,task.sourceLanguage,task.targetLanguage,task.jobTitle,task.jobDescription,task.instruction,task.constraints,task.translationMode,task.confirmedFacts]);

// Each visible row retains its own generation snapshot. Merge those snapshots,
// not their source numbers; the final write list still contains selected rows only.
export function prepareAiReviewSelection(review,selected,{allowedTask=review.task,assertCurrent}={}){
 const base=createAiTask(review.task),allowed=createAiTask(allowedTask),seen=new Set(),packets=[],targets=new Map(),references=new Map();
 if(!selected.length||base.protocolVersion!==2||allowed.action!==base.action||allowed.sourceLanguage!==base.sourceLanguage||allowed.targetLanguage!==base.targetLanguage)throw Error('本次建议任务或范围已变化，请重新选择。');
 for(const change of selected){
  const id=key(change),task=createAiTask(review.candidateTasks?.[id]||base);
  if(seen.has(id)||review.appliedKeys?.includes(id)||!review.result.changes.some(c=>key(c)===id&&JSON.stringify(c)===JSON.stringify(change)))throw Error('选中建议已采用或超出本次范围。');
  if(!allowed.targets.some(t=>t.id===change.targetId&&Object.hasOwn(t.fields,change.field))||origin(task)!==origin(base))throw Error('选中建议任务或范围不一致，请重新生成。');
  const assessed=assessAiCandidate(task,change);if(!assessed.allowed)throw Error(assessed.errors[0]?.message||'选中建议未通过本机检查。');assertCurrent?.(task);seen.add(id);packets.push({task,change});
  for(const target of task.targets){
   const current=targets.get(target.id);if(!current){targets.set(target.id,structuredClone(target));continue;}
   if(JSON.stringify(current.context)!==JSON.stringify(target.context))throw Error('选中建议的原文上下文快照不一致，请重新生成。');
   for(const [field,text]of Object.entries(target.fields)){
    if(Object.hasOwn(current.fields,field)&&(current.fields[field]!==text||current.before[field]!==target.before[field]))throw Error('选中建议的原文或目标快照不一致，请重新生成。');
    current.fields[field]=text;current.before[field]=target.before[field];
   }
  }
  for(const ref of task.references){const old=references.get(ref.id);if(old&&JSON.stringify(old)!==JSON.stringify(ref))throw Error('选中建议的引用快照不一致，请重新生成。');references.set(ref.id,structuredClone(ref));}
 }
 const task=createAiTask({...packets[0].task,targets:[...targets.values()],references:[...references.values()]});
 const changes=packets.map(({task:original,change})=>({...structuredClone(change),sources:change.sources.map(ref=>{const source=original.sources.find(s=>s.sourceId===ref.sourceId),mapped=source&&task.sources.find(s=>sameSource(s,source));if(!mapped)throw Error('选中建议的原文依据无法合并，请重新生成。');return{...ref,sourceId:mapped.sourceId};})}));
 for(const change of changes)if(!assessAiCandidate(task,change).allowed)throw Error('选中建议的原文依据无法合并，请重新生成。');
 return{task,changes};
}
function advanceTask(task,after,selected,scope){
 const next=structuredClone(task);
 for(const change of selected){const target=next.targets.find(t=>t.id===change.targetId);if(!target||!Object.hasOwn(target.fields,change.field))continue;
  for(const ref of next.references)if(ref.targetId===target.id&&ref.field===change.field){ref.sourceText=readAiField(after,scope,target.id,task.sourceLanguage,change.field);ref.targetText=readAiField(after,scope,target.id,task.targetLanguage,change.field);}
  delete target.fields[change.field];delete target.before[change.field];
 }
 next.targets=next.targets.filter(t=>Object.keys(t.fields).length);return createAiTask(next);
}
export function rebaseAiReviewAfterApply(before,after,input,selected,all,{scope='project',ranges={},candidateTasks={}}={}){
 const task=createAiTask(input),expected=applyAiChanges(before,task,selected,{scope,ranges});
 // Only the ordinary top-level save timestamp may differ from the identified transaction.
 if(Object.hasOwn(after,'updatedAt'))expected.updatedAt=after.updatedAt;
 if(JSON.stringify(after)!==JSON.stringify(expected))throw Error('保存后的资料与本次采用事务不一致，旧候选保持原快照。');
 const cache=new Map(),advance=original=>{const signature=JSON.stringify(original);if(!cache.has(signature)){try{cache.set(signature,{task:advanceTask(original,after,selected,scope)});}catch{cache.set(signature,{task:original,limited:true});}}return cache.get(signature);};
 const main=advance(task),changes=all.map(change=>structuredClone(change)),consumed=new Set(selected.map(key)),nextTasks={};let limited=Boolean(main.limited);
 for(let i=0;i<changes.length;i++){
  const original=changes[i],own=createAiTask(candidateTasks[key(original)]||task);nextTasks[key(original)]=own;
  if(consumed.has(key(original))||!own.targets.some(t=>t.id===original.targetId&&Object.hasOwn(t.fields,original.field)))continue;
  const advanced=advance(own);limited||=Boolean(advanced.limited);if(advanced.limited)continue;const mapped=structuredClone(original);let unchanged=true;
  mapped.sources=(original.sources||[]).map(ref=>{const old=own.sources.find(s=>s.sourceId===ref.sourceId),current=old&&advanced.task.sources.find(s=>sameSource(s,old));if(!current){unchanged=false;return ref;}return{...ref,sourceId:current.sourceId};});
  try{if(!unchanged)throw Error('来源已变化');assertAiContextCurrent(after,advanced.task,{scope,ranges});applyAiChanges(after,advanced.task,[mapped],{scope,ranges});changes[i]=mapped;nextTasks[key(original)]=advanced.task;}catch{}
 }
 return{task:main.task,changes,candidateTasks:nextTasks,...(limited?{warning:'本次选中字段已采用。部分剩余候选超出可继续校验的任务容量，已保留旧稿，请缩小范围后重新生成；原文过期保护继续生效。'}:{})};
}
