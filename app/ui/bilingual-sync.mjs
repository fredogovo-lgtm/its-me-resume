import {createBilingualSyncPlan,createBilingualReviewPlan,createBilingualSyncBaseline,remainingBilingualSyncPlan,rebaseBilingualSyncCandidateTask,assertBilingualSyncCurrent,applyBilingualSync} from '../core/bilingual-sync.mjs';
import {createAiTask,buildAiMessages,assessAiCandidate} from '../core/ai-tasks.mjs';
import {applyAiChanges} from '../core/ai-apply.mjs';
import {isExperienceIdentityField} from '../core/ai-experience.mjs';
import {createContentAiTask} from './ai-content-task.mjs';
import {loadAiRulePreferences,createAiRuleEditor} from './ai-rule-controls.mjs';
import {userMessage} from './user-message.mjs';
const sessions=new WeakMap(),other=language=>language==='zh'?'en':'zh',languageName=language=>language==='zh'?'中文':'English';
const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
const button=(label,attribute,kind='secondary')=>{const b=node('button',label,'button '+kind);b.type='button';b.setAttribute(attribute,'');return b;};
function session(ctx){if(!sessions.has(ctx))sessions.set(ctx,{projects:new Map(),library:new Map(),hosts:new Set(),libraryHosts:new Set()});return sessions.get(ctx);}
const libraryKey=plan=>JSON.stringify([plan.snapshots[0]?.id,plan.sourceLanguage]);
const projectKey=plan=>JSON.stringify([plan.documentId,plan.sourceLanguage]);
const documentFor=(ctx,plan)=>plan.scope==='library'?ctx.state.library:ctx.project;
function current(ctx,plan){

 if(plan.scope==='library'&&(ctx.ui.screen!=='library'||ctx.ui.librarySelection!==plan.snapshots[0]?.id||ctx.ui.libraryLanguage!==plan.sourceLanguage||ctx.ui.dirtyLibrary))throw Error('当前资料或语言已有变化，请重新保存后核对同步。');
 if(plan.scope==='project'&&(ctx.ui.screen!=='editor'||ctx.project?.id!==plan.documentId||ctx.project?.language!==plan.sourceLanguage))throw Error('当前简历或语言已有变化，请重新选择同步。');
 return assertBilingualSyncCurrent(documentFor(ctx,plan),plan);
}
// The first unresolved source snapshot is retained across successive saves.
// Shared URL/category updates only refresh signatures; they do not drop text.
export function rememberLibraryBilingualSync(ctx,plan,{beforeLibrary}={}){
 if(!plan)return null;const state=session(ctx),key=plan.snapshots.length?libraryKey(plan):JSON.stringify([ctx.ui.librarySelection,plan.sourceLanguage]),pending=state.library.get(key);
 if(!pending&&plan.changes.length)state.library.set(key,{before:beforeLibrary?structuredClone(beforeLibrary):createBilingualSyncBaseline(ctx.state.library,plan),plan:structuredClone(plan)});
 refreshLibrarySyncNotice(ctx);return state.library.get(key)?.plan||null;
}
export function getLibraryBilingualSyncPlan(ctx,selection=ctx.ui.librarySelection,language=ctx.ui.libraryLanguage){refreshLibrarySyncNotice(ctx);return session(ctx).library.get(JSON.stringify([selection,language]))?.plan||null;}
function forget(ctx,plan){const state=session(ctx);if(plan.scope==='library')state.library.delete(libraryKey(plan));else state.projects.delete(projectKey(plan));refreshLibrarySyncNotice(ctx);refreshProjectSyncNotice(ctx);}
function consumePending(ctx,plan,keys){
 const state=session(ctx),map=plan.scope==='library'?state.library:state.projects,key=plan.scope==='library'?libraryKey(plan):projectKey(plan),pending=map.get(key);
 if(pending){const consumed=keys.filter(key=>pending.plan.changes.some(change=>change.key===key));pending.before=createBilingualSyncBaseline(documentFor(ctx,plan),pending.plan,{consumedKeys:consumed});}
 refreshLibrarySyncNotice(ctx);refreshProjectSyncNotice(ctx);
}
export function captureProjectSyncChanges(ctx,before,after){
 if(!before||!after||before.id!==after.id)return;
 const state=session(ctx);
 for(const [key,pending]of state.projects)if(pending.plan.documentId===after.id){const plan=createBilingualSyncPlan(pending.before,after,{scope:'project',language:pending.plan.sourceLanguage});if(plan.changes.length)pending.plan=plan;else state.projects.delete(key);}
 const language=before.language,delta=createBilingualSyncPlan(before,after,{scope:'project',language});
 if(delta.changes.length){const key=projectKey(delta);if(!state.projects.has(key))state.projects.set(key,{before:structuredClone(before),plan:delta});}
 refreshProjectSyncNotice(ctx);
}
export function mountProjectSyncNotice(ctx,host){session(ctx).hosts.add(host);refreshProjectSyncNotice(ctx);}
export function refreshProjectSyncNotice(ctx){
 const state=session(ctx),project=ctx.project,pending=project&&state.projects.get(JSON.stringify([project.id,project.language]));
 if(pending){pending.plan=createBilingualSyncPlan(pending.before,project,{scope:'project',language:project.language});if(!pending.plan.changes.length)state.projects.delete(projectKey(pending.plan));}
 for(const host of state.hosts){if(!host.isConnected){state.hosts.delete(host);continue;}host.replaceChildren();host.hidden=ctx.ui.screen!=='editor'||!project;if(host.hidden)continue;
  const hasPending=Boolean(pending?.plan.changes.length);host.classList.toggle('bilingual-sync-notice',hasPending);host.classList.toggle('bilingual-sync-entry',!hasPending);
  if(hasPending){host.append(node('p','本次有 '+pending.plan.changes.length+' 个文字字段可核对并同步至'+languageName(pending.plan.targetLanguage)+'。另一版保持原文，直到你选择保存。'));
   const open=button('核对 / 同步本次变更','data-project-sync-open','quiet'),later=button('稍后','data-project-sync-later','quiet');open.onclick=()=>openBilingualSync(ctx,pending.plan);later.onclick=()=>forget(ctx,pending.plan);host.append(open,later);
  }
  const review=button('核对 / 同步另一版','data-project-sync-review','quiet');review.onclick=()=>{const selected=project.blocks.find(block=>block.id===ctx.ui.selectedBlockId&&!['line','shape','photo'].includes(block.kind)&&!block.hiddenLanguages?.includes(project.language));const plan=createBilingualReviewPlan(project,{scope:'project',language:project.language,...(selected?{ids:[selected.id]}:{})});if(!plan.changes.length)return ctx.notify?.('当前没有可核对的文字，请先选择或填写文本框。');return openBilingualSync(ctx,plan);};host.append(review);
 }
}
export function mountLibrarySyncNotice(ctx,host){session(ctx).libraryHosts.add(host);refreshLibrarySyncNotice(ctx);}
export function refreshLibrarySyncNotice(ctx){
 const state=session(ctx);
 for(const [key,pending]of state.library){const selection=pending.plan.snapshots[0]?.id,plan=createBilingualSyncPlan(pending.before,ctx.state.library,{scope:'library',selection,language:pending.plan.sourceLanguage});if(plan.changes.length)pending.plan=plan;else state.library.delete(key);}
 const plan=state.library.get(JSON.stringify([ctx.ui.librarySelection,ctx.ui.libraryLanguage]))?.plan;
 for(const host of state.libraryHosts){if(!host.isConnected){state.libraryHosts.delete(host);continue;}host.replaceChildren();host.hidden=ctx.ui.screen!=='library'||!plan?.changes.length;if(host.hidden)continue;host.classList.add('bilingual-sync-notice');host.append(node('p','尚有 '+plan.changes.length+' 个已保存文字字段可核对并同步至'+languageName(plan.targetLanguage)+'。'));
 const open=button('核对 / 同步另一版','data-library-sync-open','quiet'),later=button('稍后，保留另一版','data-library-sync-later','quiet');open.onclick=()=>openBilingualSync(ctx,plan);later.onclick=()=>forget(ctx,plan);host.append(open,later);}
}
// Saving is never blocked by a second translation dialog. The persistent bar
// offers an explicit sync/later choice and the ordinary entry stays available.
export async function offerLibraryBilingualSync(ctx,plan,options){if(plan)rememberLibraryBilingualSync(ctx,plan,options);return true;}
// The existing translation protocol supplies its identity/fact protections. Only
// changed eligible fields are retained in targets; unrelated body text is omitted.
export function createBilingualSyncAiTask(document,plan,{ruleOverrides,instruction=''}={}){
 assertBilingualSyncCurrent(document,plan);
 const eligible=plan.changes.filter(change=>change.aiEligible),allowed=new Set(eligible.map(change=>JSON.stringify([change.id,change.field])));
 if(!eligible.length)throw Error('本次字段需要手动核对，没有可发送的翻译内容。');
 const full=createContentAiTask(document,{scope:plan.scope,ids:[...new Set(eligible.map(change=>change.id))],language:plan.sourceLanguage,action:'translate',translationMode:'update-existing',translationDirection:plan.sourceLanguage+'-'+plan.targetLanguage,translationFields:[...new Set(eligible.map(change=>change.field))],instruction});
 const targets=full.targets.map(target=>{const names=Object.keys(target.fields).filter(field=>allowed.has(JSON.stringify([target.id,field])));return {...target,fields:Object.fromEntries(names.map(field=>[field,target.fields[field]])),before:Object.fromEntries(names.map(field=>[field,target.before[field]]))};}).filter(target=>Object.keys(target.fields).length);
 const references=full.references.filter(ref=>allowed.has(JSON.stringify([ref.targetId,ref.field]))||isExperienceIdentityField(ref.field)||['name','title','subtitle','period'].includes(ref.field));
 return createAiTask({...full,targets,references,ruleOverrides});
}
export async function openBilingualSync(ctx,sourcePlan){
 if(ctx.ui.bilingualSyncOpen||ctx.ui.bilingualSyncOpening)return false;ctx.ui.bilingualSyncOpening=true;
 // Candidate evidence must remain tied to the exact snapshot opened here,
 // independently of notice refreshes behind the modal.
 let plan=structuredClone(sourcePlan);
 try{await ctx.flush?.();current(ctx,plan);}catch(error){ctx.notify?.(userMessage(error),true);return false;}finally{ctx.ui.bilingualSyncOpening=false;}
 let root,dialog,closed=false,saving=false,request=null,ruleEditor,ruleStatus,status,stagedProject=null,refreshPreview=()=>{};
 const rows=[],eligible=()=>rows.filter(row=>!row.saved&&row.change.aiEligible);
 const say=(message,error=false)=>{const p=root.querySelector('[data-sync-status]');p.textContent=message;p.classList.toggle('is-error',error);};
 const cancel=()=>{const id=request;request=null;if(id)Promise.resolve(window.resume.aiCancel(id)).catch(()=>{});};
 const cleanup=()=>{ctx.ui.bilingualSyncOpen=false;dialog?.removeEventListener('keydown',onHotkey,true);dialog?.removeEventListener('close',onClosed);dialog?.removeEventListener('cancel',onCancel);document.querySelector('#close-modal')?.removeEventListener('click',onX,true);dialog?.classList.remove('bilingual-sync-modal');};
 const dirty=()=>rows.some(row=>!row.saved&&row.edit.value!==row.change.target);
 const warnUnsaved=()=>say('这里有尚未保存的对照修改。请勾选保存，或点击“放弃本次对照并关闭”明确放弃；已保存原文和译文保持原样。',true);
 const close=(discard=false)=>{if(saving)return say('正在保存所选字段，请稍候。');if(dirty()&&!discard)return warnUnsaved();closed=true;cancel();cleanup();ctx.closeModal();};
 function onClosed(){if(dialog?.open)return;if(saving||dirty()){dialog.showModal();if(!saving)warnUnsaved();return;}closed=true;cancel();cleanup();}
 function onHotkey(event){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopImmediatePropagation();root.querySelector('[data-sync-save]').click();}}
 function onCancel(event){event.preventDefault();close();}
 function onX(event){event.preventDefault();event.stopImmediatePropagation();close();}
 const lock=value=>{for(const row of rows){row.edit.disabled=value||row.saved;row.select.disabled=value||row.saved||Boolean(row.assessment&&!row.assessment.allowed);row.reset.disabled=value||row.saved;}root.querySelector('[data-sync-save]').disabled=value;root.querySelector('[data-sync-generate]').disabled=value||!status?.keyPresent||!eligible().length||!ruleStatus||Boolean(ruleStatus.notice);root.querySelector('[data-sync-cancel]').hidden=!request;ruleEditor?.setDisabled(value);};
 const assess=row=>{
  row.feedback.replaceChildren();row.assessment=null;if(row.saved){row.feedback.append(node('p','已保存此字段。其余未勾选稿仍在本窗口。','panel-help'));return;}
  if(row.candidate){row.candidate.value=row.edit.value;row.assessment=assessAiCandidate(row.candidateTask,row.candidate);if(row.assessment.allowed){try{applyAiChanges(documentFor(ctx,plan),row.candidateTask,[row.candidate],{scope:plan.scope});}catch(error){row.assessment={...row.assessment,allowed:false,errors:[...row.assessment.errors,{message:userMessage(error)}]};}}
   for(const issue of [...row.assessment.errors,...row.assessment.warnings])row.feedback.append(node('p',issue.message,'ai-risk-note'));if(!row.assessment.allowed){row.select.checked=false;row.select.disabled=true;}else row.select.disabled=false;
  }
 };
 const completed=transaction=>{
  if(JSON.stringify(documentFor(ctx,plan))!==transaction.signature)throw Error('保存后的资料已有其它变化，剩余候选保持原快照，请重新核对。');
  const keys=transaction.keys;for(const row of rows)if(transaction.rebasedTasks.has(row.change.key))row.candidateTask=transaction.rebasedTasks.get(row.change.key);
  consumePending(ctx,plan,keys);plan=remainingBilingualSyncPlan(documentFor(ctx,plan),plan,keys);
  for(const row of rows){if(keys.includes(row.change.key)){row.saved=true;row.select.checked=false;row.candidate=null;row.candidateTask=null;row.article.classList.add('is-saved');row.article.querySelector('.bilingual-sync-columns>div:last-child pre').textContent=row.edit.value||'（已清空）';if(!row.article.querySelector('[data-sync-saved-row]')){const details=node('details');details.dataset.syncSavedRow='';details.append(node('summary',row.change.label+' · 已保存（展开查看对照）'));for(const child of [...row.article.childNodes])details.append(child);row.article.append(details);}}else if(!row.saved)row.change=plan.changes.find(change=>change.key===row.change.key);assess(row);}
  stagedProject=null;saving=false;refreshPreview();
  // Keep every unadopted manual/generated draft in view. Untouched remaining
  // fields can be revisited from the notice without an extra forced dialog.
  if(dirty()){lock(false);root.querySelector('[data-sync-save]').textContent='保存勾选的剩余字段';say('所选字段已保存。未勾选的编辑仍保留在此窗口，可继续核对保存；关闭前会提醒未保存修改。');}
  else {closed=true;cleanup();ctx.closeModal();ctx.notify?.('所选对应字段已保存；未处理字段仍可从同步入口核对。');}
 };
 ctx.modal('核对并同步'+languageName(plan.targetLanguage),'仅当前'+(plan.scope==='library'?'资料条目':'简历对应文本框')+(plan.reviewOnly?'的对应文字。':'的本次变更。')+'勾选要保存的字段，未勾选内容保持原样。','<div class="bilingual-sync"><div data-sync-ai><p data-sync-provider></p><div data-sync-rule-host></div><details><summary>查看本次发送内容</summary><pre data-sync-payload></pre></details><div class="button-group"><button type="button" class="button secondary" data-sync-generate disabled>AI 翻译可处理字段</button><button type="button" class="button quiet" data-sync-cancel hidden>取消生成</button></div></div><p data-sync-status role="status"></p><div data-sync-rows></div><div class="modal-actions"><button type="button" class="button secondary" data-sync-close>放弃本次对照并关闭</button><button type="button" class="button primary" data-sync-save>保存勾选的对应字段</button></div></div>',host=>{
  root=host.querySelector('.bilingual-sync');dialog=root.closest('dialog');ctx.ui.bilingualSyncOpen=true;dialog.addEventListener('keydown',onHotkey,true);dialog.classList.add('bilingual-sync-modal');dialog.addEventListener('close',onClosed);dialog.addEventListener('cancel',onCancel);document.querySelector('#close-modal')?.addEventListener('click',onX,true);
  for(const [index,change]of plan.changes.entries()){
   const article=node('article',undefined,'bilingual-sync-field'),heading=node('label',undefined,'check-row'),select=node('input');select.type='checkbox';select.dataset.syncSelect=String(index);heading.append(select,node('strong',change.label));article.append(heading);
   const columns=node('div',undefined,'bilingual-sync-columns');for(const [label,text]of [[languageName(plan.sourceLanguage)+' · 本次保存的原文',change.source||'（已清空）'],[languageName(plan.targetLanguage)+' · 当前已保存内容',change.target||'（尚未填写）']]){const column=node('div');column.append(node('small',label),node('pre',text));columns.append(column);}article.append(columns);
   const label=node('label',undefined,'field'),edit=node('textarea');edit.dataset.syncEdit=String(index);edit.rows=change.field==='body'?5:2;edit.maxLength=change.maxLength;edit.value=change.target;label.append(node('span',languageName(plan.targetLanguage)+' · 本次要保存的内容（可编辑）'),edit);article.append(label);
   if(change.manualReason)article.append(node('p',change.manualReason,'panel-help'));
   if(change.relatedSourceText!==undefined){const details=node('details'),summary=node('summary','查看同源续框的完整文字参考');details.append(summary,node('small',languageName(plan.sourceLanguage)+' · 同源正文合并参考'),node('pre',change.relatedSourceText||'（无正文）'),node('small',languageName(plan.targetLanguage)+' · 同源正文合并参考'),node('pre',change.relatedTargetText||'（无正文）'));article.append(details);}
   const feedback=node('div',undefined,'bilingual-sync-feedback'),reset=button('恢复当前已保存内容','data-sync-reset','quiet');article.append(feedback,reset);const row={change,edit,select,feedback,reset,article,candidate:null,candidateTask:null,assessment:null,manualEdited:false,saved:false};rows.push(row);
   edit.oninput=()=>{row.manualEdited=true;select.checked=false;if(row.candidate)row.candidate.userEdited=true;assess(row);};reset.onclick=()=>{row.candidate=null;row.candidateTask=null;row.manualEdited=false;edit.value=row.change.target;select.checked=false;assess(row);};root.querySelector('[data-sync-rows]').append(article);
  }
  say('可直接离线手改另一版。勾选表示你已对照原文核对该字段；部分采用不会清除其余待核对状态。');
  root.querySelector('[data-sync-close]').onclick=()=>close(true);
  root.querySelector('[data-sync-cancel]').onclick=()=>{cancel();lock(false);say('已取消生成，之前的候选和对照编辑仍保留。迟到结果不会采用。');};
  root.querySelector('[data-sync-save]').onclick=async()=>{
   if(request||saving)return;const selected=rows.filter(row=>!row.saved&&row.select.checked&&!row.select.disabled);if(!stagedProject&&!selected.length)return say('请先勾选已核对、要保存的对应字段。',true);
   try{

    if(stagedProject){if(JSON.stringify(ctx.project)!==stagedProject.signature)throw Error('当前待保存简历已有变化，请关闭对照并使用主窗口重试保存。');saving=true;ctx.ui.bilingualSyncSaving=true;lock(true);await ctx.flush?.();completed(stagedProject);return;}
    current(ctx,plan);for(const row of selected){if(row.edit.value.length>row.change.maxLength)throw Error(row.change.label+'最多'+row.change.maxLength+'个字符。');if(row.candidate){if(!assessAiCandidate(row.candidateTask,row.candidate).allowed)throw Error('翻译候选未通过事实与范围检查，请先修改或恢复当前内容。');applyAiChanges(documentFor(ctx,plan),row.candidateTask,[row.candidate],{scope:plan.scope});}}
    const before=structuredClone(documentFor(ctx,plan)),edits=selected.map(row=>({key:row.change.key,value:row.edit.value})),keys=edits.map(edit=>edit.key),next=applyBilingualSync(before,plan,edits),transaction={keys,signature:JSON.stringify(next),rebasedTasks:new Map()};
    for(const row of rows)if(!row.saved&&row.candidate&&!keys.includes(row.change.key)){try{transaction.rebasedTasks.set(row.change.key,rebaseBilingualSyncCandidateTask(before,next,plan,edits,row.candidateTask,row.candidate));}catch{/* An already stale/invalid remaining candidate stays blocked with its draft intact. */}}
    saving=true;ctx.ui.bilingualSyncSaving=true;lock(true);say('正在保存勾选字段…');
    if(plan.scope==='library')await ctx.saveLibrary(next);else {ctx.updateProject(project=>{for(const key of Object.keys(project))delete project[key];Object.assign(project,next);});const expected=structuredClone(next);expected.updatedAt=ctx.project.updatedAt;if(JSON.stringify(ctx.project)!==JSON.stringify(expected))throw Error('当前简历与本次同步事务不一致，请重新核对。');transaction.signature=JSON.stringify(expected);stagedProject=transaction;await ctx.flush?.();}
    completed(transaction);
   }catch(error){say(userMessage(error)+(stagedProject?' 同步修改仍在当前简历中；请重试保存，或关闭后用主窗口重试。':''),true);}finally{saving=false;ctx.ui.bilingualSyncSaving=false;if(!closed){lock(Boolean(stagedProject));if(stagedProject){root.querySelector('[data-sync-save]').disabled=false;root.querySelector('[data-sync-save]').textContent='重试保存同步修改';}}}
  };
  root.querySelector('[data-sync-generate]').onclick=async()=>{
   if(request||saving||!status?.keyPresent)return;let requestTask;
   try{current(ctx,plan);requestTask=createBilingualSyncAiTask(documentFor(ctx,plan),plan,{ruleOverrides:ruleEditor.getOverrides()});}catch(error){return say(userMessage(error),true);}
   // A previous automatic candidate may be regenerated with new rules; actual
   // hand edits must first be saved or explicitly reset by the user.
   if(eligible().some(row=>row.manualEdited&&row.edit.value!==row.change.target))return say('请先保存手工修改，或点“恢复当前已保存内容”后再生成，避免覆盖你的对照编辑。',true);
   const id=crypto.randomUUID();request=id;lock(true);say('正在翻译本次变更，可以取消。费用由你的 API 账号承担。');
   try{const result=await window.resume.aiGenerate({id,task:requestTask});if(closed||request!==id)return;current(ctx,plan);const seen=new Set(),candidates=[];for(const candidate of result.changes||[]){const key=JSON.stringify([candidate.targetId,candidate.field]);if(seen.has(key))throw Error('翻译返回重复字段，请重新生成。');seen.add(key);const row=eligible().find(row=>row.change.id===candidate.targetId&&row.change.field===candidate.field);if(!row)throw Error('翻译字段超出本次修改范围。');candidates.push([row,candidate]);}for(const [row,candidate]of candidates){row.candidate=structuredClone(candidate);row.candidateTask=requestTask;row.manualEdited=false;row.edit.value=candidate.value;row.select.checked=false;assess(row);}say(candidates.length?'翻译候选已列在对应编辑框。请对照源内容和当前译文核对，必要时手改，再勾选保存。':'本次没有返回需修改的翻译，之前的候选与已保存内容保持原样。');}
   catch(error){if(!closed&&request===id)say(userMessage(error)+' 之前的候选与对照编辑仍保留。',true);}finally{if(!closed&&request===id){request=null;lock(false);}}
  };
 });
 try{status=await window.resume.aiStatus();ruleStatus=await loadAiRulePreferences();if(closed)return true;
  const updatePreview=()=>{
   root.querySelector('[data-sync-provider]').textContent=status.keyPresent?`${status.baseUrl} · ${status.model}。只在点击翻译后发送 ${eligible().length} 个可处理字段；姓名、机构和日期的既有译文保持保护。`:'尚未配置 API Key；可直接离线对照编辑，或稍后到设置接入 AI。';
   try{const preview=createBilingualSyncAiTask(documentFor(ctx,plan),plan,{ruleOverrides:ruleEditor?.getOverrides()});root.querySelector('[data-sync-payload]').textContent=buildAiMessages(preview,{rulePreferences:ruleStatus.preferences}).find(m=>m.role==='user').content;}catch(error){root.querySelector('[data-sync-payload]').textContent=eligible().length?userMessage(error):'本次字段只需手动核对，不发送。';}
  };
  ruleEditor=createAiRuleEditor(root.querySelector('[data-sync-rule-host]'),{preferences:ruleStatus.preferences,action:'translate',onChange:updatePreview});refreshPreview=updatePreview;updatePreview();
  if(ruleStatus.notice)say(ruleStatus.notice+' 请到AI设置重新保存规则后再翻译；手动编辑仍可用。',true);lock(false);
 }catch(error){if(!closed){say('AI设置未能读取，仍可离线手改对应字段。',true);lock(false);}}
 return true;
}
