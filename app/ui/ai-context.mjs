import {rebaseAiReviewAfterApply} from './ai-review-apply.mjs';
import {openAiAssistant} from './ai-assistant.mjs';
import {createAiTask} from '../core/ai-tasks.mjs';
import {applyAiChanges} from '../core/ai-apply.mjs';
import {getPeriod} from '../core/entry-content.mjs';
import {createExperienceAiContext} from '../core/ai-experience.mjs';
import {applyLanguageLayout} from './language-layout.mjs';
import {requestLibraryNavigation} from './library-navigation.mjs';
import {createContentAiTask,assertAiContextCurrent} from './ai-content-task.mjs';
const writing=['polish','shorten','proofread','expand','organize','translate','review','questions'];
const clone=value=>structuredClone(value);
const labelsFor=(rows,language)=>Object.fromEntries(rows.map((row,index)=>[row.id,row[language]?.title||(row.id==='person'?'基本信息':'经历 '+(index+1))]));
function settingsReturn(ctx,state,resume){
 if(typeof ctx.openAiSettings==='function')return ctx.openAiSettings({resume:()=>resume(state),label:'返回刚才的 AI 任务'});
 return ctx.navigate?.('settings');
}
export function factsForTask(task,facts){
 const allowed=new Set(task.targets.map(t=>t.id));
 return facts.map(f=>{let ids=(f.targetIds||[]).filter(id=>allowed.has(id));if(!ids.length&&allowed.size===1)ids=[...allowed];if(ids.length!==1)throw Error('请为这条回答选择一个对应模块，再整理文案。');const text=f.answer.trim();if(!text||text.length>3000)throw Error('每条确认回答应为1至3000字符，请先精简回答。');return{targetId:ids[0],text};});
}
async function answerQuestions(ctx,{questions,task,scope,id,language,assertCurrent,onGenerate}){
 const {openAiCompletion}=await import('./ai-completion.mjs');
 return openAiCompletion(ctx,{questions,task,scope,id,language,assertCurrent,onGenerate:async packet=>{assertCurrent();const confirmedFacts=factsForTask(task,packet.facts);if(!confirmedFacts.length)throw Error('请先填写并确认一条事实。');ctx.closeModal();return onGenerate(confirmedFacts);}});
}
export function openLibraryAi(ctx,action='polish',initialState,extras={}){
 return requestLibraryNavigation(ctx,async()=>{
  const id=ctx.ui.librarySelection,language=ctx.ui.libraryLanguage;
  if(id==='attachments')return ctx.notify('请先选择要处理的基本信息或经历。');
  const assertCurrent=task=>{if(ctx.ui.screen!=='library'||ctx.ui.librarySelection!==id||ctx.ui.libraryLanguage!==language||ctx.ui.dirtyLibrary)throw Error('资料编辑状态已变化，请关闭后重新生成建议。');return assertAiContextCurrent(ctx.state.library,task,{scope:'library'});};
  return openAiAssistant(ctx,{action,initialState,translationScopeNote:'职业字段按当前分类逐项处理，采用后只更新对应字段，不会追加或覆盖正文。',targetLabels:labelsFor([{id,...(id==='person'?ctx.state.library.person:ctx.state.library.entries.find(e=>e.id===id))}],language),actions:id==='person'?writing:[...writing,'tags'],assertCurrent,createTask:(nextAction,instruction,options={})=>createContentAiTask(clone(ctx.state.library),{scope:'library',ids:[id],language,action:nextAction,instruction,...options,confirmedFacts:extras.confirmedFacts||[]}),
   onSettings:state=>settingsReturn(ctx,state,saved=>{ctx.ui.librarySelection=id;ctx.ui.libraryLanguage=language;return openLibraryAi(ctx,saved.action,saved,extras);}),
   onQuestions:(questions,task)=>answerQuestions(ctx,{questions,task,scope:'library',id,language,assertCurrent:()=>assertCurrent(task),onGenerate:confirmedFacts=>openLibraryAi(ctx,'polish',{action:'polish'},{confirmedFacts})}),
   apply:async(changes,result,task)=>{assertCurrent(task);const before=clone(ctx.state.library),next=applyAiChanges(before,task,changes,{scope:'library'});await ctx.saveLibrary(next);const selected=new Set(changes.map(c=>JSON.stringify([c.targetId,c.field]))),done=new Set(result.appliedKeys||[]),remaining=result.changes.filter(c=>!selected.has(JSON.stringify([c.targetId,c.field]))&&!done.has(JSON.stringify([c.targetId,c.field])));if(remaining.length)return rebaseAiReviewAfterApply(before,ctx.state.library,task,changes,result.changes,{scope:'library',candidateTasks:result.candidateTasks});if(task.action==='translate'){ctx.ui.libraryLanguage=task.targetLanguage;ctx.render();}}
  });
 }).catch(error=>ctx.notify(error.message,true));
}
export async function openProjectAi(ctx,{action,selection,initialState,targetIds,confirmedFacts=[],layoutReady=false}={}){
 try{
  document.activeElement?.blur();await ctx.flush();
  const initial=clone(ctx.project);if(!initial)return;
  if(action==='layout'&&!layoutReady){const {openAiLayoutCheck}=await import('./ai-layout.mjs');return openAiLayoutCheck(ctx,{onGenerate:()=>openProjectAi(ctx,{action:'layout',layoutReady:true,initialState,targetIds})});}
  const language=initial.language,ranges={};
  const blocks=selection?initial.blocks.filter(b=>b.id===selection.blockId):targetIds?.length?initial.blocks.filter(b=>targetIds.includes(b.id)):ctx.ui.selectedBlockId?initial.blocks.filter(b=>b.id===ctx.ui.selectedBlockId):initial.blocks.filter(b=>!b.hiddenLanguages?.includes(language)&&!['line','shape','photo'].includes(b.kind));
  if(!blocks.length||blocks.some(b=>['line','shape','photo'].includes(b.kind)))return ctx.notify('请先选中文字模块，或取消选择后检查整份简历。');
  if(blocks.some(b=>b.locked))return ctx.notify('所选文字包含锁定模块，请先解锁。');
  if(selection){if(selection.projectId!==initial.id||selection.language!==language||blocks[0][language]?.[selection.field]!==selection.textSnapshot)throw Error('原选区已变化，请重新选中文字。');ranges[selection.blockId]={field:selection.field,start:selection.start,end:selection.end,snapshot:selection.textSnapshot};}
  const ids=blocks.map(b=>b.id),whole=!selection&&!ctx.ui.selectedBlockId&&!targetIds?.length;
  const actions=selection?['polish','shorten','proofread','expand','review','questions']:whole?['review','translate','layout','questions']:[...writing,'layout',...(blocks[0].kind==='entry'?['tags']:[])];
  const layout=await import('./ai-layout.mjs');
  const assertCurrent=task=>{if(ctx.ui.screen!=='editor'||ctx.project?.id!==initial.id||ctx.project.language!==language)throw Error('当前简历或语言已变化，请重新生成建议。');if(task.action==='layout'){if(!layout.isAiLayoutContextCurrent(ctx,task.layoutContext?.signature))throw Error('版面已变化，请重新检查。');return true;}return assertAiContextCurrent(ctx.project,task,{ranges,jobTitle:ctx.project.jobTitle,jobDescription:ctx.project.jobDescription});};
  return openAiAssistant(ctx,{action:action||(whole?'review':'polish'),initialState,translationScopeNote:'本次只翻译实际简历文字，已有职业信息随正文处理；不会另改资料库职业字段或把已删除内容补回。',targetLabels:labelsFor(blocks,language),actions,assertCurrent,reviewRange:Object.entries(ranges).map(([id,r])=>[id,r.field,r.start,r.end]),
   createTask:(nextAction,instruction,options={})=>{if(ctx.project?.id!==initial.id||ctx.project.language!==language)throw Error('当前简历或语言已变化，请关闭窗口重新选择。');return createContentAiTask(clone(ctx.project),{scope:'project',ids,language,action:nextAction,instruction,...options,ranges,jobTitle:ctx.project.jobTitle,jobDescription:ctx.project.jobDescription,confirmedFacts,layoutContext:nextAction==='layout'?layout.buildAiLayoutContext(ctx):undefined});},
   onLocalLayout:layoutReady?undefined:state=>openProjectAi(ctx,{action:'layout',initialState:state,targetIds:ids}),
   onSettings:state=>settingsReturn(ctx,state,saved=>openProjectAi(ctx,{action:saved.action,selection,initialState:saved,targetIds:ids,confirmedFacts,layoutReady:true})),
   onQuestions:(questions,task)=>answerQuestions(ctx,{questions,task,scope:'project',id:ids.length===1?ids[0]:'',language,assertCurrent:()=>assertCurrent(task),onGenerate:facts=>openProjectAi(ctx,{action:'polish',initialState:{action:'polish'},targetIds:[...new Set(facts.map(f=>f.targetId))],confirmedFacts:facts})}),
   onLayout:(_findings,task)=>{assertCurrent(task);return layout.openAiLayoutCheck(ctx,{onGenerate:()=>openProjectAi(ctx,{action:'layout',targetIds:ids,layoutReady:true})});},
   apply:async(changes,result,task)=>{
    assertCurrent(task);
    const selected=new Set(changes.map(c=>JSON.stringify([c.targetId,c.field]))),done=new Set(result.appliedKeys||[]),remaining=result.changes.filter(c=>!selected.has(JSON.stringify([c.targetId,c.field]))&&!done.has(JSON.stringify([c.targetId,c.field])));
    if(typeof ctx.commitProject!=='function')throw Error('暂时无法保存选中修改，请保留候选后重试。');
    let outcome;
    const committed=await ctx.commitProject(project=>{
     const before=clone(project),next=applyAiChanges(before,task,changes,{ranges});
     if(task.action==='translate'&&!remaining.length)applyLanguageLayout(next,task.targetLanguage);
     // Validate remaining candidates before writing; a failed save must leave both source and review untouched.
     if(remaining.length)outcome=rebaseAiReviewAfterApply(before,next,task,changes,result.changes,{ranges,candidateTasks:result.candidateTasks});
     Object.keys(project).forEach(key=>delete project[key]);Object.assign(project,next);
    },{assertCurrent:()=>assertCurrent(task)});
    if(!committed)throw Error('选中修改尚未保存，请保留候选后重试。');
    ctx.ui.richSelection=null;return outcome;
   }
  });
 }catch(error){ctx.notify(error.message,true);}
}
const entryPacket=(entries,language)=>entries.map(e=>({id:e.id,title:e[language].title,subtitle:e[language].subtitle,body:e[language].body,period:getPeriod(e,language),tags:e.tags,category:e.category,context:createExperienceAiContext(e,language)}));
export function createWizardAiTask(library,draft,action,instruction='',options={}){
 let candidates=action==='role'?[]:library.entries;
 if(candidates.length>200){candidates=candidates.filter(entry=>draft.entryIds.includes(entry.id));if(!candidates.length||candidates.length>200)throw Error('资料库超过200条经历，请先在选材页将本次候选勾选到1至200条，再使用AI推荐；未勾选的经历不会发送。');}
 return createAiTask({protocolVersion:2,action,sourceLanguage:draft.language,entries:entryPacket(candidates,draft.language),jobTitle:draft.jobTitle,jobDescription:draft.jobDescription,instruction,constraints:options.constraints});
}
export function openWizardAi(ctx,action='role',initialState){
 const draft=ctx.ui.wizard;if(!draft)return;
 const language=draft.language,entries=entryPacket(ctx.state.library.entries,language),jobTitle=draft.jobTitle,jobDescription=draft.jobDescription,identity=JSON.stringify({entries,jobTitle,jobDescription,language});
 return openAiAssistant(ctx,{action,initialState,targetLabels:labelsFor(ctx.state.library.entries,language),actions:['role','select'],readonly:true,createTask:(nextAction,instruction,options)=>createWizardAiTask(ctx.state.library,draft,nextAction,instruction,options),
  onSettings:state=>settingsReturn(ctx,state,saved=>openWizardAi(ctx,saved.action,saved)),
  applyRecommendations:async(result,task)=>{const now=ctx.ui.wizard;if(ctx.ui.screen!=='wizard'||now!==draft||JSON.stringify({entries:entryPacket(ctx.state.library.entries,now.language),jobTitle:now.jobTitle,jobDescription:now.jobDescription,language:now.language})!==identity)throw Error('岗位要求或经历已有变化，请重新分析。');const expected=createWizardAiTask(ctx.state.library,now,task.action,task.instruction,{constraints:task.constraints});if(JSON.stringify([task.action,task.sourceLanguage,task.jobTitle,task.jobDescription,task.entries])!==JSON.stringify([expected.action,expected.sourceLanguage,expected.jobTitle,expected.jobDescription,expected.entries]))throw Error('该推荐属于其它岗位或资料快照，请重新分析当前岗位。');now.entryIds=result.recommendations.map(r=>r.entryId);now.selectionInitialized=true;now.aiRecommendations={jobTitle,jobDescription,language,items:clone(result.recommendations)};ctx.render();}
 }).catch(error=>ctx.notify(error.message,true));
}
