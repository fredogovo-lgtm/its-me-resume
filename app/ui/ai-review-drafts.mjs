import {createAiTask} from '../core/ai-tasks.mjs';
const storage=ctx=>{try{return ctx.draftStorage||globalThis.localStorage;}catch{return null;}};
export const aiReviewDraftKey=(ctx,identity)=>`its-me:ai-review-draft:v1:${ctx.draftScope||'default'}:${identity}`;
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
const fields=['summary','notes','changes','requirements','recommendations','findings','questions'];
function cleanReview(input){
 if(!plain(input)||!plain(input.result))throw Error('候选草稿格式无效。');
 const cache=new WeakMap(),cleanTask=value=>{if(!plain(value))throw Error('候选任务无效。');if(cache.has(value))return cache.get(value);const task=createAiTask(value);delete task.ruleOverrides;cache.set(value,task);return task;};
 const task=cleanTask(input.task);let rawTasks=input.candidateTasks||{};
 if(input.candidateTaskRefs!==undefined){if(!plain(input.candidateTaskRefs)||!Array.isArray(input.candidateTaskPool)||input.candidateTaskPool.length>500)throw Error('候选任务引用无效。');rawTasks=Object.fromEntries(Object.entries(input.candidateTaskRefs).map(([key,index])=>{if(!Number.isInteger(index)||index < -1||index>=input.candidateTaskPool.length)throw Error('候选任务引用无效。');return[key,index===-1?input.task:input.candidateTaskPool[index]];}));}
 const candidateTasks=Object.fromEntries(Object.entries(rawTasks).map(([key,value])=>[key,cleanTask(value)]));
 const result=Object.fromEntries(fields.filter(key=>Object.hasOwn(input.result,key)).map(key=>[key,structuredClone(input.result[key])]));
 if(!Array.isArray(result.changes)||result.changes.length>500)throw Error('候选草稿字段无效。');
 result.changes=result.changes.map(change=>{if(!plain(change)||typeof change.value!=='string'||change.value.length>200000||!task.targets.some(t=>t.id===change.targetId&&Object.hasOwn(t.fields,change.field))&&!candidateTasks[JSON.stringify([change.targetId,change.field])]?.targets.some(t=>t.id===change.targetId&&Object.hasOwn(t.fields,change.field)))throw Error('候选草稿超出原任务范围。');return Object.fromEntries(['targetId','field','value','reason','sources','userEdited'].filter(key=>Object.hasOwn(change,key)).map(key=>[key,structuredClone(change[key])]));});
 const keys=new Set(result.changes.map(change=>JSON.stringify([change.targetId,change.field]))),appliedKeys=(Array.isArray(input.appliedKeys)?input.appliedKeys:[]).filter(key=>keys.has(key));
 return {task,result,appliedKeys:[...new Set(appliedKeys)],candidateTasks:Object.fromEntries(Object.entries(candidateTasks).filter(([key])=>keys.has(key)))};
}
function encodeReview(review){const pool=[],refs={},known=new Map([[JSON.stringify(review.task),-1]]);for(const [key,task]of Object.entries(review.candidateTasks)){const signature=JSON.stringify(task);if(!known.has(signature)){known.set(signature,pool.length);pool.push(task);}refs[key]=known.get(signature);}return{task:review.task,result:review.result,appliedKeys:review.appliedKeys,candidateTaskPool:pool,candidateTaskRefs:refs};}
export function loadAiReviewDraft(ctx,identity){try{const raw=storage(ctx)?.getItem(aiReviewDraftKey(ctx,identity));if(!raw)return{review:null};return {review:cleanReview(JSON.parse(raw))};}catch{return{review:null,corrupt:true,notice:'本机候选草稿未能读取，原记录已保留。请先复制需要的文字，再明确丢弃此草稿。'};}}
export function saveAiReviewDraft(ctx,identity,input){try{if(loadAiReviewDraft(ctx,identity).corrupt)return false;const value=JSON.stringify(encodeReview(cleanReview(input)));if(value.length>2*1024*1024)return false;const store=storage(ctx);if(!store)return false;store.setItem(aiReviewDraftKey(ctx,identity),value);return true;}catch{return false;}}
export function clearAiReviewDraft(ctx,identity){try{const store=storage(ctx);if(!store)return false;store.removeItem(aiReviewDraftKey(ctx,identity));return true;}catch{return false;}}
const origin=task=>JSON.stringify([task.action,task.sourceLanguage,task.targetLanguage,task.jobTitle||'',task.jobDescription||'',task.entries||[]]);
const hash=value=>{let a=2166136261,b=2246822519;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b^value.charCodeAt(i),3266489917);}return (a>>>0).toString(16)+(b>>>0).toString(16)+'-'+value.length;};
export function aiReviewOriginMatches(ctx,saved,current){return ctx.ui?.screen!=='wizard'||origin(saved)===origin(current);}
export function aiReviewIdentity(ctx,task,range=[]){return JSON.stringify([ctx.ui?.screen==='library'?'library':ctx.ui?.screen==='wizard'?'wizard':'project',ctx.ui?.screen==='editor'?ctx.project?.id||'':'',task.action,task.sourceLanguage,task.targetLanguage,task.targets.map(t=>[t.id,Object.keys(t.fields).sort()]).sort((a,b)=>a[0].localeCompare(b[0])),range,...(ctx.ui?.screen==='wizard'?[hash(origin(task))]:[])]);}

// Partial adoption can narrow fields, but cannot move a draft to another saved location.
function sameReviewLocation(saved,current){
 try{const a=JSON.parse(saved),b=JSON.parse(current);return Array.isArray(a)&&Array.isArray(b)&&a.length>=7&&a.length===b.length&&JSON.stringify(a.filter((_,index)=>index!==5))===JSON.stringify(b.filter((_,index)=>index!==5));}catch{return false;}
}
export function findAiReviewDraft(ctx,identity,current,range=[]){
 const direct=loadAiReviewDraft(ctx,identity);if(direct.review||direct.notice)return{...direct,identity};
 try{const store=storage(ctx),prefix=aiReviewDraftKey(ctx,''),keys=typeof store?.key==='function'?Array.from({length:Math.min(store.length,2000)},(_,i)=>store.key(i)):Object.keys(store||{});for(const key of keys.filter(key=>key?.startsWith(prefix)).slice(0,200)){const id=key.slice(prefix.length),saved=loadAiReviewDraft(ctx,id);if(saved.review&&sameReviewLocation(id,identity)&&aiReviewIdentity(ctx,saved.review.task,range)===identity&&aiReviewOriginMatches(ctx,saved.review.task,current))return{...saved,identity:id};}}catch{}
 return{review:null,identity};
}
