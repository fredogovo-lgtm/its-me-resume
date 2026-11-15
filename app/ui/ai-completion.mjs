import {installAiDraftDialog,prepareAiDraftDialog} from './ai-draft-dialog.mjs';
import { getPeriod } from '../core/entry-content.mjs';
import { formatLinkLines,personWebsiteLabel } from '../core/document-style.mjs';
import { setBlockText } from '../core/rich-text.mjs';
import { updateLanguageReview } from '../core/bilingual-review.mjs';
import { saveLibraryDraft, applyLibraryDraft, libraryFormValues } from './library-drafts.mjs';
const text = (value,max=6000) => typeof value==='string'?value.slice(0,max):'';
const uncertain = value => /可能|大概|估计|也许|或许|似乎|不清楚|不确定|记不清|待核实|待确认|\b(?:maybe|might|perhaps|probably|unsure|not sure|roughly)\b/iu.test(value);
const statuses = ['answered','skipped','unknown'];

function cleanTargets(rows) {
  const candidates=(Array.isArray(rows)?rows:[]).filter(row=>row&&typeof row.id==='string'&&row.id.length<=200).map((row,index)=>({id:row.id,label:text(row.label||row.fields?.title||('经历 '+(index+1)),240),body:row.body===true||Object.hasOwn(row.fields||{},'body')}));
  const body=candidates.filter(row=>row.body);return (body.length?body:candidates).filter((row,index,all)=>all.findIndex(other=>other.id===row.id)===index).slice(0,200);
}
function candidateIds(draft,index){const declared=draft.questions[index].targetIds;return draft.targets.map(row=>row.id).filter(id=>!declared.length||declared.includes(id));}
export function createCompletionDraft({questions=[],scope='project',id='',language='zh',projectId='',targets,task,manualDrafts={},manualSelectedId='',personalManualDraft}={}) {
  const questionRows=questions.slice(0,3).map(row=>({question:text(typeof row==='string'?row:row.question,2000),targetIds:[...new Set((Array.isArray(row?.targetIds)?row.targetIds:[id]).filter(value=>typeof value==='string'&&value.length<=200))].slice(0,200)}));
  const targetRows=cleanTargets(targets||task?.targets||[...new Set(questionRows.flatMap(row=>row.targetIds).concat(id||[]))].map(id=>({id,body:true})));
  const draft={scope:scope==='library'?'library':'project',id:text(id,200),projectId:text(projectId,200),language:language==='en'?'en':'zh',overflowCount:Math.max(0,questions.length-3),targets:targetRows,questions:questionRows,answers:[]};
  draft.manualDrafts=Object.fromEntries(Object.entries(manualDrafts&&typeof manualDrafts==='object'?manualDrafts:{}).filter(([id,row])=>targetRows.some(target=>target.id===id)&&row&&typeof row.snapshot==='string'&&typeof row.body==='string'&&row.snapshot.length<=200000&&row.body.length<=200000).map(([id,row])=>[id,{snapshot:row.snapshot,body:row.body}]));
  if(targetRows.some(target=>target.id===manualSelectedId))draft.manualSelectedId=manualSelectedId;
  if(personalManualDraft&&typeof personalManualDraft==='object'&&targetRows.some(target=>target.id==='person')){const clean=object=>Object.fromEntries(['name','headline','city'].filter(key=>typeof object?.[key]==='string').map(key=>[key,object[key].slice(0,6000)]));draft.personalManualDraft={snapshot:clean(personalManualDraft.snapshot),values:clean(personalManualDraft.values),field:['name','headline','city'].includes(personalManualDraft.field)?personalManualDraft.field:'headline'};}
  draft.answers=questionRows.map((_,index)=>{const ids=candidateIds(draft,index);return{status:'unknown',text:'',confirmed:false,targetId:ids.length===1?ids[0]:''};});return draft;
}
export function setCompletionAnswer(draft,index,{status,text:answer,confirmed=false,targetId}){
  if(!Number.isInteger(index)||!draft?.questions?.[index])throw new Error('补充问题已变化，请重新打开。');
  const selected=targetId===undefined?draft.answers[index]?.targetId||'':targetId;
  if(selected&&!candidateIds(draft,index).includes(selected))throw new Error('回答对应的资料超出本次范围，请重新选择。');
  const next=structuredClone(draft);next.answers[index]={status:statuses.includes(status)?status:'unknown',text:text(answer),confirmed:status==='answered'&&Boolean(confirmed),targetId:selected};return next;
}
export function completionFacts(draft){return (draft?.answers||[]).flatMap((answer,index)=>answer.status==='answered'&&answer.confirmed&&answer.text.trim()&&answer.text.length<=3000&&!uncertain(answer.text)&&answer.targetId&&candidateIds(draft,index).includes(answer.targetId)?[{question:draft.questions[index].question,answer:answer.text.trim(),targetIds:[answer.targetId]}]:[]);}
export function buildCompletionEditDraft(originalBody,draft,targetId=draft.id){
  const supplements=draft.questions.flatMap((question,index)=>{const answer=draft.answers[index];return answer?.status==='answered'&&answer.text.trim()&&answer.targetId===targetId?[question.question+'\n'+answer.text.trim()]:[];});
  return [String(originalBody||''),supplements.length?'补充资料（待整理）：\n'+supplements.join('\n\n'):''].filter(Boolean).join('\n\n');
}
export async function generateCompletionDraft(draft,options={}) {
  await options.assertCurrent?.();const facts=completionFacts(draft);
  if(!facts.length)throw new Error('请先确认回答、选择对应资料，并将每条回答控制在3000字符内。');
  if(typeof options.onGenerate!=='function')throw new Error('当前任务暂不能整理回答。');
  return options.onGenerate({task:options.task,scope:draft.scope,id:draft.id,language:draft.language,answers:structuredClone(draft.answers),facts});
}
export function applyProjectCompletionDraft(ctx,draft,id,body,{snapshot,assertCurrent}={}) {
  assertCurrent?.();
  if(draft.scope!=='project'||ctx.project?.id!==draft.projectId||ctx.project.language!==draft.language||!draft.targets.some(target=>target.id===id))throw new Error('当前简历、语言或资料范围已变化，请重新打开。');
  const block=ctx.project.blocks.find(block=>block.id===id);
  if(!block||block.locked||block.hiddenLanguages?.includes(draft.language))throw new Error('当前模块已删除、隐藏或锁定，请重新打开。');
  if(block[draft.language]?.body!==snapshot)throw new Error('原资料已变化，请返回重新整理，现有内容未覆盖。');
  if(typeof body!=='string'||body.length>30000)throw new Error('正文超过30000字符，请先缩短草稿。');
  ctx.updateProject(project=>{const target=project.blocks.find(block=>block.id===id),before=structuredClone(target);setBlockText(target,draft.language,'body',body);updateLanguageReview(before,target,draft.language);});
  return true;
}
const storage=ctx=>{try{return ctx.draftStorage||globalThis.localStorage;}catch{return null;}};
const identity = draft => [draft.scope,draft.projectId||'',draft.id,draft.language].join(':');
const key=(ctx,draft)=>`its-me:completion-draft:v1:${ctx.draftScope||'default'}:${identity(draft)}`;
export function saveCompletionDraft(ctx,draft){
  const clean=createCompletionDraft(draft);clean.overflowCount=Number.isInteger(draft.overflowCount)?Math.max(0,draft.overflowCount):0;
  clean.answers=clean.questions.map((_,index)=>{const answer=draft.answers?.[index]||{};return{status:statuses.includes(answer.status)?answer.status:'unknown',text:text(answer.text),confirmed:answer.status==='answered'&&Boolean(answer.confirmed),targetId:candidateIds(clean,index).includes(answer.targetId)?answer.targetId:clean.answers[index].targetId};});
  try{const store=storage(ctx);if(!store)return false;const value=JSON.stringify(clean);if(value.length>2*1024*1024)return false;store.setItem(key(ctx,clean),value);return true;}catch{ctx.notify?.('补充问答草稿未能写入本机，请先保留回答。',true);return false;}
}
export function loadCompletionDraft(ctx,options){try{const raw=storage(ctx)?.getItem(key(ctx,options));if(!raw)return null;const row=JSON.parse(raw);if(!row||!Array.isArray(row.questions)||!Array.isArray(row.answers))return null;const clean=createCompletionDraft(row);clean.answers=clean.questions.map((_,index)=>({status:statuses.includes(row.answers[index]?.status)?row.answers[index].status:'unknown',text:text(row.answers[index]?.text),confirmed:Boolean(row.answers[index]?.confirmed)&&row.answers[index]?.status==='answered',targetId:candidateIds(clean,index).includes(row.answers[index]?.targetId)?row.answers[index].targetId:clean.answers[index].targetId}));clean.overflowCount=Number.isInteger(row.overflowCount)?Math.max(0,row.overflowCount):0;return clean;}catch{return null;}}
const create=(tag,value,className)=>{const node=document.createElement(tag);if(value!==undefined)node.textContent=value;if(className)node.className=className;return node;};
function protectCompletionDialog(ctx,host,persist,busy=()=>false){
 const status=create('p','','ai-feedback error');status.dataset.completionStatus='';status.setAttribute('role','status');host.append(status);
 const guard=installAiDraftDialog(ctx,host.closest('dialog'),{persist,busy,onError:message=>{status.textContent=message;ctx.notify?.(message,true);}});
 const discard=create('button','放弃尚未保存内容并关闭','button quiet danger');discard.type='button';discard.dataset.completionDiscard='';discard.onclick=()=>guard.close({discard:true});host.append(discard);return guard;
}
function originalBody(ctx,draft,id){if(draft.scope==='project')return ctx.project?.id===draft.projectId?ctx.project.blocks.find(block=>block.id===id)?.[draft.language]?.body:undefined;return ctx.state.library.entries.find(entry=>entry.id===id)?.[draft.language]?.body;}
const personalFields = { headline: { label: '职业 / 求职方向', max: 160 }, city: { label: '所在城市', max: 160 }, name: { label: '姓名', max: 80 } };
function manualTargetAvailable(ctx,draft,id) { return draft.targets.some(target=>target.id===id) && ((draft.scope==='library'&&id==='person'&&ctx.state.library.person?.[draft.language]) || typeof originalBody(ctx,draft,id)==='string'); }
export function stagePersonalCompletionDraft(ctx,draft,field,value,{snapshot,assertCurrent}={}) {
  assertCurrent?.();
  if(draft.scope!=='library'||!draft.targets.some(target=>target.id==='person')||!Object.hasOwn(personalFields,field))throw new Error('当前补充范围不支持此字段，请重新选择。');
  const person=ctx.state.library.person,current=person?.[draft.language];
  if(!snapshot||!current||Object.keys(personalFields).some(key=>String(current[key]||'')!==String(snapshot[key]||'')))throw new Error('原资料已变化，请返回重新整理，现有内容未覆盖。');
  if(typeof value!=='string'||value.length>personalFields[field].max)throw new Error('当前字段超过字数限制，请先缩短草稿。');
  const same=ctx.ui.librarySelection==='person'&&ctx.ui.libraryLanguage===draft.language;
  if(ctx.ui.dirtyLibrary&&!same)throw new Error('其他资料表单仍有未保存内容，请先处理后再带入。');
  const existing=same?libraryFormValues(globalThis.document?.querySelector('#library-form')):{};
  if(existing[field]!==undefined&&existing[field]!==String(snapshot[field]||''))throw new Error('原表单草稿已变化，请先保留未保存内容后重新整理。');
  const values={...current,email:person.email||'',phone:person.phone||'',website:person.website||'',websiteLabel:personWebsiteLabel(person,draft.language)||'',linksText:formatLinkLines(person.links,draft.language),...existing,[field]:value};
  const previous={selection:ctx.ui.librarySelection,language:ctx.ui.libraryLanguage};ctx.ui.librarySelection='person';ctx.ui.libraryLanguage=draft.language;
  if(!saveLibraryDraft(ctx,values)){ctx.ui.librarySelection=previous.selection;ctx.ui.libraryLanguage=previous.language;throw new Error('草稿未能保存，请先保留当前内容。');}
  ctx.closeModal();ctx.ui.screen='library';ctx.render();applyLibraryDraft(ctx,{id:'person:'+draft.language,values});ctx.notify('已带入基本信息表单草稿，请检查后手工保存；另一语言未改动。');return true;
}
function openPersonalManualDraft(ctx,draft,options) {
  if(!prepareAiDraftDialog(ctx))return;
  const saved=draft.personalManualDraft||options.personalManualDraft,current=structuredClone(ctx.state.library.person[draft.language]),snapshot=saved?.snapshot||current;
  const sameSource=saved&&Object.keys(personalFields).every(key=>String(saved.snapshot?.[key]||'')===String(snapshot[key]||''));
  const values={...snapshot,...(saved?Object.fromEntries(Object.entries(saved.values||{}).filter(([key,value])=>Object.hasOwn(personalFields,key)&&typeof value==='string')):{})};let field=saved&&Object.hasOwn(personalFields,saved.field)?saved.field:'headline';
  ctx.modal('手工补充基本信息','选择一个字段，参考回答手工整理。仅把当前字段带入本语言表单草稿，请检查后保存。','<div data-completion-person></div>',root=>{
    const host=root.querySelector('[data-completion-person]'),reference=create('section');reference.append(create('strong','回答参考（不会自动写入资料）'));
    for(const [index,answer]of draft.answers.entries())if(answer.status==='answered'&&answer.targetId==='person'&&answer.text.trim())reference.append(create('p',draft.questions[index].question),create('p',answer.text));host.append(reference);
    const selectLabel=create('label','要补充的字段','field'),select=create('select');select.dataset.completionPersonField='';select.setAttribute('aria-label','要补充的基本信息字段');
    for(const [key,definition]of Object.entries(personalFields)){const option=create('option',definition.label);option.value=key;select.append(option);}select.value=field;selectLabel.append(select);host.append(selectLabel);
    const editLabel=create('label','整理后的字段内容','field'),edit=create('textarea');edit.dataset.completionPersonText='';edit.setAttribute('aria-label','整理后的基本信息');edit.rows=4;edit.maxLength=personalFields[field].max;edit.value=values[field]||'';editLabel.append(edit);host.append(editLabel);
    const capture=()=>{values[field]=edit.value;draft.personalManualDraft={snapshot,values:{...values},field};return saveCompletionDraft(ctx,draft);};edit.oninput=capture;select.onchange=()=>{capture();field=select.value;edit.maxLength=personalFields[field].max;edit.value=values[field]||'';capture();};
    const actions=create('div',undefined,'modal-actions'),back=create('button','返回问答','button secondary'),save=create('button','带入资料表单草稿','button primary');back.type=save.type='button';save.dataset.completionStagePerson='';actions.append(back,save);host.append(actions);
    const guard=protectCompletionDialog(ctx,host,capture);back.onclick=()=>{if(guard.persist())openAiCompletion(ctx,{...options,personalManualDraft:{snapshot,values,field}});};save.onclick=()=>{try{if(!guard.persist())return;stagePersonalCompletionDraft(ctx,draft,field,edit.value,{snapshot,assertCurrent:options.assertCurrent});}catch(error){ctx.notify(error.message,true);}};
  });
}
function openManualDraft(ctx,draft,options){
  try{options.assertCurrent?.();}catch(error){return ctx.notify(error.message,true);}
  const candidates=[...new Set(draft.answers.filter(answer=>answer.status==='answered'&&answer.text.trim()).map(answer=>answer.targetId).filter(Boolean))].filter(id=>typeof originalBody(ctx,draft,id)==='string');
  if(draft.scope==='library'&&draft.answers.some(answer=>answer.status==='answered'&&answer.text.trim()&&answer.targetId==='person')&&manualTargetAvailable(ctx,draft,'person'))return openPersonalManualDraft(ctx,draft,options);
  if(!candidates.length)return ctx.notify('当前范围没有可手工补充的经历正文；请使用已确认回答整理，或返回相应资料手工填写。',true);
  if(!prepareAiDraftDialog(ctx))return;
  let id=candidates.includes(draft.manualSelectedId)?draft.manualSelectedId:candidates.includes(draft.id)?draft.id:candidates[0];
  draft.manualDrafts||={};for(const candidate of candidates)if(!Object.hasOwn(draft.manualDrafts,candidate)){const snapshot=originalBody(ctx,draft,candidate);Object.defineProperty(draft.manualDrafts,candidate,{value:{snapshot,body:buildCompletionEditDraft(snapshot,draft,candidate)},enumerable:true,writable:true,configurable:true});}
  let snapshot=draft.manualDrafts[id].snapshot;
  ctx.modal('手工补充原资料','回答只带入可编辑草稿。切换模块、返回问答或关闭时保留手稿；原资料变化时不会自动覆盖。','<div data-completion-manual></div>',root=>{
    const host=root.querySelector('[data-completion-manual]');let body,guard;
    const capture=()=>{draft.manualDrafts[id].body=body.value;draft.manualSelectedId=id;return saveCompletionDraft(ctx,draft);};
    if(candidates.length>1){const label=create('label','选择要补充的模块','field'),select=create('select');for(const candidate of candidates){const option=create('option',draft.targets.find(target=>target.id===candidate)?.label||'所选经历');option.value=candidate;option.selected=candidate===id;select.append(option);}label.append(select);host.append(label);select.onchange=()=>{capture();id=select.value;snapshot=draft.manualDrafts[id].snapshot;body.value=draft.manualDrafts[id].body;capture();};}
    const label=create('label','正文草稿','field');body=create('textarea');body.rows=12;body.maxLength=30000;body.value=draft.manualDrafts[id].body;body.oninput=capture;label.append(body);host.append(label);
    const actions=create('div',undefined,'modal-actions'),back=create('button','返回问答','button secondary'),save=create('button',draft.scope==='library'?'带入资料表单草稿':'保存到当前简历','button primary');back.type=save.type='button';actions.append(back,save);host.append(actions);guard=protectCompletionDialog(ctx,host,capture);
    back.onclick=()=>{if(guard.persist())openAiCompletion(ctx,options);};
    save.onclick=()=>{try{
      if(!guard.persist())return;options.assertCurrent?.();
      if(body.value.length>30000)throw new Error('正文超过30000字符，请先缩短草稿。');
      if(originalBody(ctx,draft,id)!==snapshot)throw new Error('原资料已变化，请返回重新整理，现有内容未覆盖。');
      if(draft.scope==='project'){
        applyProjectCompletionDraft(ctx,draft,id,body.value,{snapshot,assertCurrent:options.assertCurrent});ctx.closeModal();ctx.ui.selectedBlockId=id;ctx.render();ctx.notify('已保存到当前简历，可一次撤销；资料库未改动。');
      }else{
        const entry=ctx.state.library.entries.find(entry=>entry.id===id);if(!entry)throw new Error('原资料已不存在，请保留草稿。');
        if(ctx.ui.dirtyLibrary&&(ctx.ui.librarySelection!==id||ctx.ui.libraryLanguage!==draft.language))throw new Error('其他资料表单仍有未保存内容，请先处理后再带入。');
        const existing=ctx.ui.librarySelection===id&&ctx.ui.libraryLanguage===draft.language?libraryFormValues(document.querySelector('#library-form')):{};
        const values={category:entry.category,period:getPeriod(entry,draft.language),title:entry[draft.language].title,subtitle:entry[draft.language].subtitle,body:entry[draft.language].body,tags:entry.tags.join('，'),...existing};
        if(existing.body!==undefined&&existing.body!==snapshot)throw new Error('原表单草稿已变化，请返回重新整理。');
        values.body=body.value;const previous={selection:ctx.ui.librarySelection,language:ctx.ui.libraryLanguage};ctx.ui.librarySelection=id;ctx.ui.libraryLanguage=draft.language;if(!saveLibraryDraft(ctx,values)){ctx.ui.librarySelection=previous.selection;ctx.ui.libraryLanguage=previous.language;throw Error('正文表单草稿未能写入本机，请保留此窗口。');}guard.dispose();ctx.closeModal();ctx.ui.screen='library';ctx.render();applyLibraryDraft(ctx,{id:id+':'+draft.language,values});ctx.notify('已带入资料表单草稿，请检查后手工保存。');
      }
    }catch(error){ctx.notify(error.message,true);}};
  });
}
export function openAiCompletion(ctx,options={}){
  if(!prepareAiDraftDialog(ctx))return false;
  const targets=(options.task?.targets||options.targets||[]).map((target,index)=>{const item=options.scope==='library'?(target.id==='person'?ctx.state.library.person:ctx.state.library.entries.find(entry=>entry.id===target.id)):ctx.project?.blocks.find(block=>block.id===target.id);return{...target,label:item?.[options.language]?.title||target.fields?.title||(target.id==='person'?'基本信息':'经历 '+(index+1))};});
  const fresh=createCompletionDraft({...options,...(targets.length?{targets}:{}),projectId:options.scope==='library'?'':ctx.project?.id||options.projectId||''});
  if(!fresh.id)fresh.id=fresh.questions.flatMap(question=>question.targetIds)[0]||'';
  const saved=loadCompletionDraft(ctx,fresh);let draft=saved&&JSON.stringify(saved.questions)===JSON.stringify(fresh.questions)&&JSON.stringify(saved.targets.map(row=>row.id))===JSON.stringify(fresh.targets.map(row=>row.id))?{...saved,targets:fresh.targets}:fresh;
  if(!draft.questions.length)return ctx.notify('本次没有补充问题。');saveCompletionDraft(ctx,draft);
  ctx.modal('补充资料','每次最多3问。可回答、跳过或选择不清楚；回答先保存在本机草稿，不自动成为成果。','<div data-completion-questions></div>',root=>{
    const host=root.querySelector('[data-completion-questions]'),rows=[];let guard,generating=false;
    if(draft.overflowCount)host.append(create('p',`本次只处理前3问，其余 ${draft.overflowCount} 问未带入。`));
    draft.questions.forEach((question,index)=>{
      const row=create('section',undefined,'inspector-section');row.append(create('h3',`${index+1}. ${question.question}`));
      const status=create('select');status.setAttribute('aria-label','回答状态');for(const [value,label]of [['answered','回答'],['skipped','跳过'],['unknown','不清楚']]){const option=create('option',label);option.value=value;option.selected=draft.answers[index].status===value;status.append(option);}
      const target=create('select');target.setAttribute('aria-label','回答对应的资料');const candidates=candidateIds(draft,index);if(candidates.length!==1){const empty=create('option','请选择本条回答对应的资料');empty.value='';target.append(empty);}for(const id of candidates){const option=create('option',draft.targets.find(row=>row.id===id)?.label||'所选经历');option.value=id;target.append(option);}target.value=draft.answers[index].targetId;target.disabled=candidates.length===1;
      const answer=create('textarea');answer.rows=3;answer.maxLength=3000;answer.placeholder='每条最多3000字符；仅填写已确认内容，不确定时选择“不清楚”。';answer.value=draft.answers[index].text;
      const label=create('label',undefined,'check-row'),confirmed=create('input');confirmed.type='checkbox';confirmed.checked=draft.answers[index].confirmed;label.append(confirmed,create('span','以上回答是已确认的个人事实'));
      const note=create('p',undefined,'panel-help');row.append(status,target,answer,label,note);host.append(row);rows.push({status,target,answer,confirmed,note});
      const capture=()=>{draft=setCompletionAnswer(draft,index,{status:status.value,text:answer.value,confirmed:confirmed.checked,targetId:target.value});saveCompletionDraft(ctx,draft);refresh();};status.onchange=target.onchange=answer.oninput=confirmed.onchange=capture;
    });
    const actions=create('div',undefined,'modal-actions'),close=create('button','关闭并保留草稿','button quiet'),manual=create('button','手工补充原资料','button secondary'),generate=create('button','根据已确认回答整理','button primary');for(const button of [close,manual,generate])button.type='button';actions.append(close,manual,generate);host.append(actions);
    function refresh(){rows.forEach((row,index)=>{const answer=draft.answers[index];row.answer.disabled=answer.status!=='answered';row.confirmed.disabled=answer.status!=='answered';row.note.textContent=answer.status!=='answered'?'不会作为事实发送。':!answer.targetId?'请先选择本条回答对应的资料，不会将答案广播到多个模块。':answer.text.length>3000?'每条最多3000字符，请先缩短；超限内容仍保留在本机。':uncertain(answer.text)?'包含不确定措辞，仅留草稿，不作为已确认事实发送。':'仅勾选已确认的回答可用于主动整理。';});generate.disabled=typeof options.onGenerate!=='function'||!completionFacts(draft).length;manual.disabled=!draft.answers.some(answer=>answer.status==='answered'&&answer.text.trim()&&manualTargetAvailable(ctx,draft,answer.targetId));manual.title=draft.targets.some(target=>manualTargetAvailable(ctx,draft,target.id))?'只带入可编辑草稿，检查后保存。':'当前范围没有可手工补充的经历正文，请使用已确认回答整理或返回资料库填写。';}
    guard=protectCompletionDialog(ctx,host,()=>saveCompletionDraft(ctx,draft),()=>generating);close.onclick=()=>guard.close();manual.onclick=()=>openManualDraft(ctx,draft,options);
    generate.onclick=async()=>{const facts=completionFacts(draft);if(!facts.length||!guard.persist())return;generate.disabled=true;generating=true;try{await generateCompletionDraft(draft,{...options,onGenerate:async packet=>{if(!saveCompletionDraft(ctx,draft))throw Error('问答草稿未能保存，请保留此窗口。');guard.dispose();try{return await options.onGenerate(packet);}catch(error){if(host.isConnected&&host.closest('dialog')?.open)guard=protectCompletionDialog(ctx,host,()=>saveCompletionDraft(ctx,draft),()=>generating);throw error;}}});}catch(error){ctx.notify(error.message,true);refresh();}finally{generating=false;}};
    refresh();
  });return draft;
}