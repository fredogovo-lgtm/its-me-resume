// Pure save-time optimization: one current-language form, no credentials or mutations.
import {createAiTask,validateAiChanges,assessAiCandidate} from './ai-tasks.mjs';
import {experienceFieldDefinitions} from './library-experience.mjs';
import {isExperienceIdentityField} from './ai-experience.mjs';

const personFacts=['name','city','phone','email','website','websiteLabel','linksText'];
const has=(values,field)=>Object.hasOwn(values,field);
function formValues(values){
 const entries=values&&typeof values.entries==='function'?Array.from(values.entries()):values&&typeof values==='object'&&!Array.isArray(values)?Object.entries(values):null;
 if(!entries||entries.some(([field,value])=>typeof field!=='string'||typeof value!=='string'))throw new Error('本次填写的表单内容无效。');
 return Object.fromEntries(entries);
}
function metadataFor(category){return experienceFieldDefinitions.filter(field=>field.category==='all'||field.category===category);}
function taskFromValues(category,language,values){
 const fields={},facts={};
 const add=(destination,field,key=field)=>{if(has(values,key)&&values[key].trim())destination[field]=values[key];};
 if(category==='person'){
  add(fields,'headline');for(const field of personFacts)add(facts,field);
 }else{
  add(category==='certificate'?facts:fields,'title');add(fields,'body');add(facts,'tags');
  add(['work','education'].includes(category)?facts:fields,'subtitle');add(facts,'period');
  for(const definition of metadataFor(category)){const field='experience.'+definition.key;add(isExperienceIdentityField(field)?facts:fields,field,definition.key);}
 }
 if(!Object.keys(fields).length)throw new Error('本次填写没有可优化的文字，事实信息已原样保存。');
 return createAiTask({protocolVersion:2,action:'optimize',sourceLanguage:language,targetLanguage:language,targets:[{id:'current',fields,context:{category,facts}}],constraints:{maxTags:100}});
}

// Uses the submitted form rather than silently reloading its last saved version.
// Real entry, attachment and company relationship ids are never sent to the model.
export function createLibrarySaveAiTask(library,{selection='person',language='zh',values={}}={}){
 if(!['zh','en'].includes(language))throw new Error('资料语言无效。');
 const submitted=formValues(values);
 if(selection==='person'){
  if(!library?.person)throw new Error('个人资料已不存在，请重新打开资料库。');
  return taskFromValues('person',language,submitted);
 }
 const entry=library?.entries?.find(item=>item.id===selection);
 if(!entry)throw new Error('正在编辑的经历已不存在，请保留本次填写后重新选择。');
 const category=has(submitted,'category')?submitted.category:entry.category;
 if(typeof category!=='string'||!category.trim())throw new Error('资料分类无效。');
 return taskFromValues(category,language,submitted);
}

// This validates only model output. Later manual edits use the ordinary library
// form validator, so the user can correct facts in either comparison column.
export function librarySaveAiCandidate(input,result,values){
 const task=createAiTask(input),original=formValues(values);
 if(task.protocolVersion!==2||task.action!=='optimize'||task.targets.length!==1||task.targets[0].id!=='current')throw new Error('不是本次保存的资料优化任务。');
 const target=task.targets[0],category=target.context.category;
 if(category!=='person'&&has(original,'category')&&original.category!==category)throw new Error('本次填写的资料分类已有变化，请重新优化。');
 const expected=taskFromValues(category,task.sourceLanguage,original).targets[0];
 if(JSON.stringify({fields:target.fields,context:target.context})!==JSON.stringify({fields:expected.fields,context:expected.context}))throw new Error('本次填写的文字或事实信息已有修改，请重新优化。');
 if(!result||!Array.isArray(result.changes))throw new Error('AI未返回可比较的完整结果。');
 const changes=validateAiChanges(task,result.changes),candidate={...original},risks=[];
 for(const change of changes){
  const field=change.field,key=field.startsWith('experience.')?field.slice('experience.'.length):field;
  if(!has(original,key))throw new Error('AI结果涉及本次填写以外的字段。');
  candidate[key]=change.value;
  for(const warning of assessAiCandidate(task,change).warnings)risks.push({field,...warning});
 }
 return {values:candidate,changes,risks,needsReview:risks.length>0};
}
