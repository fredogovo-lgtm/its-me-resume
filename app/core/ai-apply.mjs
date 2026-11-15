import {isExperienceAiField,readExperienceAiField,setExperienceAiField} from './ai-experience.mjs';
import {createAiTask,validateAiChanges} from './ai-tasks.mjs';
import {splitAiTags} from './ai-policy.mjs';
import {setBlockText} from './rich-text.mjs';import {getPeriod,setPeriod} from './entry-content.mjs';import {updateLanguageReview,markLanguageReviewed} from './bilingual-review.mjs';
import {validateLibrary,validateProject} from './model.mjs';
const personFields=new Set(['name','headline','city']);
const textFields=new Set(['title','subtitle','body']);
export function readAiField(document,scope,id,language,field){
  const entry=scope==='library'?(id==='person'?document.person:document.entries.find(e=>e.id===id)):document.blocks.find(b=>b.id===id);
  if(!entry)throw new Error('原资料已不存在，请重新生成AI建议。');
  if(id==='person'&&scope==='library'){if(!personFields.has(field))throw new Error('个人资料字段超出范围。');return entry[language][field]||'';}
  if(textFields.has(field))return entry[language]?.[field]||'';
  if(field==='period')return getPeriod(entry,language);
  if(isExperienceAiField(field)){if(scope!=='library')throw new Error('职业字段仅可在资料库逐项翻译，项目请翻译实际正文。');return readExperienceAiField(entry,language,field);}
  if(field==='tags')return (entry.tags||[]).join('，');
  throw new Error('AI修改字段超出范围。');
}
export function applyAiChanges(document,input,changes,{scope='project',ranges={}}={}){
  if(!['project','library'].includes(scope))throw new Error('AI应用范围无效。');
  const task=createAiTask(input),validated={changes:validateAiChanges(task,changes)},next=structuredClone(document);
  if(task.protocolVersion===2)for(const ref of task.references||[]){
    if(!ref.targetId||!ref.field)continue;
    if(readAiField(document,scope,ref.targetId,task.sourceLanguage,ref.field)!==ref.sourceText||readAiField(document,scope,ref.targetId,task.targetLanguage,ref.field)!==ref.targetText)throw new Error('引用的资料已有变化，请重新生成AI建议。');
  }
  for(const change of validated.changes){
    const target=task.targets.find(t=>t.id===change.targetId),range=ranges[change.targetId];
    let source=readAiField(document,scope,target.id,task.sourceLanguage,change.field),current=readAiField(document,scope,target.id,task.targetLanguage,change.field);
    if(range){
      if(task.sourceLanguage!==task.targetLanguage||range.field!==change.field||source!==range.snapshot||!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<0||range.end<=range.start||range.end>source.length)throw new Error('原选区已变化，请重新选择文字并生成建议。');
      const edges=new Set([0,source.length,...Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(source),part=>part.index)]);if(!edges.has(range.start)||!edges.has(range.end))throw new Error('选区需要包含完整字符，请重新选择文字。');
      source=source.slice(range.start,range.end);current=source;
    }
    if(source!==target.fields[change.field]||current!==target.before[change.field])throw new Error('原文或目标语言已有修改，请重新生成AI建议。');
    // Recheck every cited context field, not just the field being edited.
    if(task.protocolVersion===2)for(const ref of change.sources){
      const cited=task.sources.find(source=>source.sourceId===ref.sourceId);
      if(cited?.kind==='confirmed_fact')continue;
      if(cited?.kind!=='target')throw new Error('原文依据超出本次资料范围。');
      let actual=readAiField(document,scope,cited.targetId,task.sourceLanguage,cited.field);
      const citedRange=ranges[cited.targetId];
      if(citedRange?.field===cited.field){if(actual!==citedRange.snapshot)throw new Error('引用的原文上下文已有变化，请重新生成AI建议。');actual=actual.slice(citedRange.start,citedRange.end);}
      if(actual!==cited.text)throw new Error('引用的原文上下文已有修改，请重新生成AI建议。');
    }
    const item=scope==='library'?(target.id==='person'?next.person:next.entries.find(e=>e.id===target.id)):next.blocks.find(b=>b.id===target.id);
    if(scope==='project'&&item.locked)throw new Error('模块已锁定，请先解锁再采用建议。');
    const previous=structuredClone(item),value=range?range.snapshot.slice(0,range.start)+change.value+range.snapshot.slice(range.end):change.value;
    if(target.id==='person'&&scope==='library')item[task.targetLanguage][change.field]=value;
    else{
      if(textFields.has(change.field))setBlockText(item,task.targetLanguage,change.field,value);
      else if(isExperienceAiField(change.field))setExperienceAiField(item,task.targetLanguage,change.field,value);
      else if(change.field==='period')setPeriod(item,task.targetLanguage,value);
      else item.tags=[...new Set(splitAiTags(value))];
      if(task.action==='translate'){
        if(task.protocolVersion!==2)markLanguageReviewed(item,task.targetLanguage);
        if(item.hiddenLanguages?.includes(task.targetLanguage))item.hiddenLanguages=item.hiddenLanguages.filter(language=>language!==task.targetLanguage);
      }else updateLanguageReview(previous,item,task.targetLanguage);
    }
  }
  if(scope==='library')validateLibrary(next);else validateProject(next);
  return next;
}
