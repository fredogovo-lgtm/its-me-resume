import {createAiTask} from '../core/ai-tasks.mjs';
import {readAiField} from '../core/ai-apply.mjs';
import {experienceAiFields,createExperienceAiContext,isExperienceAiField,isExperienceIdentityField} from '../core/ai-experience.mjs';
const other=language=>language==='en'?'zh':'en';
const readonly=new Set(['review','layout','questions','expand']);
const itemFor=(document,scope,id)=>scope==='library'?(id==='person'?document.person:document.entries.find(e=>e.id===id)):document.blocks.find(b=>b.id===id);
const textFields=(item,scope,id,metadata=false)=>id==='person'&&scope==='library'?['name','headline','city']:['title','subtitle','body',...(item.kind==='entry'||scope==='library'?['period']:[]),...(metadata&&scope==='library'?experienceAiFields(item):[])];
const identityField=(item,scope,id,field)=>isExperienceIdentityField(field)||field==='name'||field==='period'||(item.kind==='profile'&&field==='title')||(field==='subtitle'&&['work','education'].includes(item.category));
function read(document,scope,id,language,field){return readAiField(document,scope,id,language,field);}
function initialDirection(document,scope,ids,language,mode){
 if(mode==='fill-empty'&&language==='en'&&ids.some(id=>{const item=itemFor(document,scope,id);return item&&textFields(item,scope,id,true).some(field=>field!=='period'&&!read(document,scope,id,'en',field).trim()&&read(document,scope,id,'zh',field).trim());}))return ['zh','en'];
 return [language,other(language)];
}
export function createContentAiTask(document,{scope='project',ids,language='zh',action='polish',instruction='',constraints={},translationMode='fill-empty',translationDirection='auto',includeDetails=false,ranges={},jobTitle='',jobDescription='',layoutContext,confirmedFacts=[],translationFields}={}){
 if(!['library','project'].includes(scope)||!['zh','en'].includes(language)||!Array.isArray(ids)||!ids.length)throw Error('请先选择要处理的资料。');
 if(translationFields!==undefined&&(!Array.isArray(translationFields)||new Set(translationFields).size!==translationFields.length||translationFields.some(field=>!['name','headline','city','title','subtitle','body','period'].includes(field)&&!isExperienceAiField(field))))throw Error('翻译字段选择超出允许范围。');
 const mode=translationMode==='update'||translationMode==='update-existing'?'update-existing':'fill-empty';
 let [sourceLanguage,targetLanguage]=action==='translate'?(translationDirection==='zh-en'?['zh','en']:translationDirection==='en-zh'?['en','zh']:initialDirection(document,scope,ids,language,mode)):[language,language];
 const references=[],targets=[];
 for(const [index,id]of ids.entries()){
  const item=itemFor(document,scope,id);if(!item)throw Error('原资料已变化，请重新选择。');
  if(action==='layout'){targets.push({id,fields:{title:'模块 '+(index+1)},before:{title:'模块 '+(index+1)}});continue;}
  const fields=textFields(item,scope,id,action==='translate'),range=ranges[id];
  let names;
  if(range)names=[range.field];
  else if(action==='tags')names=[...fields,'tags'];
  else if(readonly.has(action)||action==='translate')names=fields;
  else if(id==='person'&&scope==='library')names=['headline'];
  else names=includeDetails?['title','subtitle','body']:['body'];
  if(action==='layout'&&item.kind==='profile')names=names.filter(f=>f!=='body');
  if(action==='translate'&&item.kind==='profile')names=names.filter(f=>f!=='body');
  if(action==='translate'){
   for(const field of fields){
    if(isExperienceAiField(field)&&translationFields!==undefined&&!translationFields.includes(field))continue;
    if(item.kind==='profile'&&field==='body')continue;
    const sourceText=read(document,scope,id,sourceLanguage,field),targetText=read(document,scope,id,targetLanguage,field);
    if(sourceText.trim()&&targetText.trim()&&field!=='period'&&(field!=='body'||mode==='update-existing'))references.push({id:'ref_'+index+'_'+field.replace(/\./gu,'_'),targetId:id,field,sourceText,targetText,kind:identityField(item,scope,id,field)||field==='title'?'name':'translation'});
   }
   names=names.filter(field=>{
    const source=read(document,scope,id,sourceLanguage,field),before=read(document,scope,id,targetLanguage,field);
    if(!source.trim())return false;
    if(mode==='fill-empty')return !before.trim();
    return !identityField(item,scope,id,field)||!before.trim();
   });
  }
  if(action==='translate'&&translationFields!==undefined)names=names.filter(field=>translationFields.includes(field));
  if(!names.length)continue;
  const source={},before={};for(const field of names){source[field]=range?range.snapshot.slice(range.start,range.end):read(document,scope,id,sourceLanguage,field);before[field]=range?source[field]:read(document,scope,id,targetLanguage,field);}
  const context=scope==='library'&&id!=='person'&&!range&&['review','questions','expand'].includes(action)?createExperienceAiContext(item,sourceLanguage):undefined;
  targets.push({id,fields:source,before,...(context?{context}:{})});
 }
 if(!targets.length)throw Error(action==='translate'?'没有待补的空白内容。已有译文已保留，可选择“更新已有译文”或切换翻译方向。':'没有可处理的文字，请先补充资料。');
 return createAiTask({protocolVersion:2,action,sourceLanguage,targetLanguage,targets,references,constraints,confirmedFacts:action==='layout'?[]:confirmedFacts,translationMode:mode,jobTitle:action==='layout'?'':jobTitle,jobDescription:action==='layout'?'':jobDescription,instruction,...(layoutContext?{layoutContext:{summary:layoutContext.summary,signature:layoutContext.signature}}:{})});
}
export function assertAiContextCurrent(document,task,{scope='project',ranges={},jobTitle=task.jobTitle,jobDescription=task.jobDescription}={}){
 if(jobTitle!==task.jobTitle||jobDescription!==task.jobDescription)throw Error('岗位上下文已有变化，请重新生成建议。');
 for(const target of task.targets){
  if(target.context){const item=itemFor(document,scope,target.id);if(scope!=='library'||!item||JSON.stringify(createExperienceAiContext(item,task.sourceLanguage))!==JSON.stringify(target.context))throw Error('只读职业依据已有变化，请重新生成建议。');}
  for(const [field,value]of Object.entries(target.fields)){
  const range=ranges[target.id];let source=read(document,scope,target.id,task.sourceLanguage,field),before=read(document,scope,target.id,task.targetLanguage,field);
  if(range){if(source!==range.snapshot)throw Error('选区原文已有修改，请重新生成建议。');source=source.slice(range.start,range.end);before=source;}
  if(source!==value||before!==target.before[field])throw Error('原文或目标语言已有修改，请重新生成建议。');
 }}
 for(const ref of task.references||[]){if(!ref.targetId||!ref.field)continue;if(read(document,scope,ref.targetId,task.sourceLanguage,ref.field)!==ref.sourceText||read(document,scope,ref.targetId,task.targetLanguage,ref.field)!==ref.targetText)throw Error('引用的资料已有变化，请重新生成建议。');}
 return true;
}
