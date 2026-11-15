// Reusable local rule editors. No credentials, network, or direct data mutations.
import {AI_RULE_ACTIONS,getDefaultAiRulePreferences,normalizeAiRulePreferences,normalizeAiRuleOverrides,resolveAiRulePreferences} from '../core/ai-rule-preferences.mjs';
export const aiRuleActionLabels={optimize:'保存时统一优化',polish:'优化表达',shorten:'精简文字',proofread:'检查用词与错别字',expand:'补充资料',translate:'翻译另一语言',review:'检查简历内容',role:'分析岗位要求',select:'推荐相关经历',layout:'提供版式建议',tags:'整理技能与标签',organize:'梳理经历内容',questions:'建议补充的问题'};
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
const field=(label,name,rows=4)=>{const wrap=el('label',undefined,'field'),area=el('textarea');area.name=name;area.rows=rows;area.maxLength=8000;wrap.append(el('span',label),area);return {wrap,area};};
const button=(label,attribute)=>{const n=el('button',label,'button quiet');n.type='button';n.setAttribute(attribute,'');return n;};
const safeError=e=>String(e?.message||'操作失败，请重试。').replace(/^(?:Error invoking remote method[^:]*:\s*|Error:\s*)+/u,'').slice(0,500);
export async function loadAiRulePreferences(){
 if(typeof window.resume.aiRulesStatus!=='function')return {preferences:getDefaultAiRulePreferences()};
 const status=await window.resume.aiRulesStatus();return {...status,preferences:normalizeAiRulePreferences(status?.preferences??getDefaultAiRulePreferences())};
}
export function readGlobalAiRuleDraft(host){return host.querySelector('[data-ai-global-rules]')?.readRuleDraft?.();}
export async function renderGlobalAiRules(host,{draft,ctx}={}){
 const section=el('section',undefined,'ai-global-rules');section.dataset.aiGlobalRules='';host.append(section);
 section.append(el('h3','AI 规则'),el('p','在本机调整所有 AI 调用的写法。通用规则适用于全部任务，每类任务还可单独设置；调用时也能临时修改。规则不含 Key，不随资料备份迁移。','ai-muted'));
 let status;try{status=await loadAiRulePreferences();}catch(error){section.append(el('p','规则未能读取：'+safeError(error),'ai-feedback error'));return;}
 if(!section.isConnected)return;
 let baseline=structuredClone(status.preferences);
 let preferences=structuredClone(draft?.preferences||status.preferences),action=AI_RULE_ACTIONS.includes(draft?.action)?draft.action:'optimize',busy=false;
 const form=el('form',undefined,'ai-rule-settings-form'),general=field('通用规则','aiGlobalGeneral',5),choice=el('label',undefined,'field'),select=el('select');select.name='aiGlobalAction';
 for(const key of AI_RULE_ACTIONS){const option=el('option',aiRuleActionLabels[key]||key);option.value=key;select.append(option);}choice.append(el('span','单独设置任务规则'),select);
 const task=field('该任务的默认规则','aiGlobalActionRule',5),actions=el('div',undefined,'ai-settings-actions'),save=button('保存规则','data-ai-save-rules'),reset=button('恢复全部默认','data-ai-reset-rules'),feedback=el('p','','ai-feedback');feedback.dataset.aiRulesFeedback='';feedback.setAttribute('role','status');save.type='submit';save.className='button primary';
 general.area.value=preferences.general;select.value=action;task.area.value=preferences.actions[action];actions.append(save,reset);form.append(general.wrap,choice,task.wrap,el('p','每段最多 8000 字，全部规则合计最多 24000 字。留空可停用该段表达偏好；事实、隐私、来源与修改范围保护仍生效。规则中请勿填写密码、Key或个人资料。','ai-muted'),actions,feedback);section.append(form);
 const capture=()=>{preferences.general=general.area.value;preferences.actions[action]=task.area.value;return {preferences:structuredClone(preferences),action};};section.readRuleDraft=capture;
 const isDirty=()=>JSON.stringify(capture().preferences)!==JSON.stringify(baseline);
 const refreshDirty=()=>{if(ctx?.ui){ctx.ui.dirtyAiRules=isDirty();ctx.refreshSaveStatus?.({clearError:true});}};
 select.onchange=()=>{capture();action=select.value;task.area.value=preferences.actions[action];feedback.textContent=isDirty()?'修改尚未保存。':'';};
 general.area.oninput=task.area.oninput=()=>{refreshDirty();feedback.textContent=isDirty()?'修改尚未保存。':'与已保存规则一致。';feedback.classList.remove('error');};
 reset.onclick=()=>{if(busy||host.aiSettingsBusy)return;preferences=getDefaultAiRulePreferences();general.area.value=preferences.general;task.area.value=preferences.actions[action];refreshDirty();feedback.textContent=isDirty()?'已填入默认规则，点击“保存规则”后生效。':'当前已是默认规则。';feedback.classList.remove('error');};
 const saveRules=async()=>{
  if(busy||host.aiSettingsBusy||!form.reportValidity())return false;
  let candidate;try{candidate=normalizeAiRulePreferences(capture().preferences);}catch(e){feedback.textContent=safeError(e);feedback.classList.add('error');return false;}
  busy=true;host.aiSettingsBusy=true;const locks=Array.from(host.querySelectorAll('form input,form textarea,form select,form button'),n=>[n,n.disabled]);for(const [n]of locks)n.disabled=true;
  try{if(typeof window.resume.aiRulesConfigure!=='function')throw Error('当前版本不支持保存规则。');const result=await window.resume.aiRulesConfigure(candidate);preferences=normalizeAiRulePreferences(result.preferences);baseline=structuredClone(preferences);general.area.value=preferences.general;task.area.value=preferences.actions[action];refreshDirty();feedback.textContent='规则已保存在本机，下次主动发送时生效。';feedback.classList.remove('error');return true;}
  catch(e){feedback.textContent=safeError(e);feedback.classList.add('error');ctx?.notify?.('规则未能保存：'+safeError(e),true);return false;}
  finally{busy=false;host.aiSettingsBusy=false;for(const [n,disabled]of locks)if(n.isConnected)n.disabled=disabled;}
 };
 form.onsubmit=event=>{event.preventDefault();return saveRules();};
 if(ctx)ctx.aiRuleSettings={connected:()=>section.isConnected,isBusy:()=>busy||Boolean(host.aiSettingsBusy),isDirty,save:saveRules,discard(){preferences=structuredClone(baseline);general.area.value=preferences.general;task.area.value=preferences.actions[action];refreshDirty();feedback.textContent='已放弃本次规则修改，保留已保存规则。';feedback.classList.remove('error');}};
 refreshDirty();
 if(status.notice){feedback.textContent=status.notice;feedback.classList.add('error');}
 return section;
}
// Navigation and native close share this guard. Unsaved rules stay only in the
// editor's memory; provider fields and API credentials are never captured here.
export async function saveGlobalAiRules(ctx){
 const editor=ctx.aiRuleSettings;
 if(!editor?.connected()){if(ctx.ui.dirtyAiRules){ctx.notify?.('请等待规则编辑器就绪后保存。',true);return false;}return true;}
 if(editor.isBusy()){ctx.notify?.('正在保存 AI 设置，请稍候。');return false;}
 return editor.save();
}
function chooseAiRuleNavigation(ctx){
 if(ctx.chooseAiRuleNavigation)return ctx.chooseAiRuleNavigation();
 return new Promise(resolve=>{
  let settled=false;const dialog=document.querySelector('#modal');
  const cancel=()=>finish('cancel');
  const finish=choice=>{if(settled)return;settled=true;dialog?.removeEventListener('close',cancel);dialog?.removeEventListener('cancel',cancel);resolve(choice);};
  ctx.modal('保存 AI 规则后继续？','规则有未保存修改。保存后继续，或明确放弃本次修改；返回编辑会保留当前内容。','<div class="modal-actions"><button class="button secondary" data-ai-rules-leave="cancel">返回编辑</button><button class="button quiet danger" data-ai-rules-leave="discard">放弃修改并继续</button><button class="button primary" data-ai-rules-leave="save">保存并继续</button></div>',root=>{
   for(const control of root.querySelectorAll('[data-ai-rules-leave]'))control.onclick=()=>{finish(control.dataset.aiRulesLeave);ctx.closeModal();};
  });
  dialog?.addEventListener('close',cancel,{once:true});dialog?.addEventListener('cancel',cancel,{once:true});
 });
}
export async function requestAiRuleNavigation(ctx){
 if(ctx.ui?.screen!=='settings')return true;
 const editor=ctx.aiRuleSettings;
 if(editor?.isBusy()){ctx.notify?.('正在保存 AI 设置，请稍候。');return false;}
 if(!editor?.connected()){if(ctx.ui.dirtyAiRules){ctx.notify?.('规则编辑尚未就绪，请稍候。');return false;}return true;}
 if(!editor.isDirty())return true;
 if(ctx.ui.aiRuleNavigationPending)return false;
 ctx.ui.aiRuleNavigationPending=true;
 try{const choice=await chooseAiRuleNavigation(ctx);if(choice==='save')return await saveGlobalAiRules(ctx);if(choice==='discard'){editor.discard();return true;}return false;}
 finally{ctx.ui.aiRuleNavigationPending=false;}
}
export function createAiRuleEditor(host,{preferences,action,state,onChange}={}){
 const global=normalizeAiRulePreferences(preferences??getDefaultAiRulePreferences());let current=action,general,overrides={};
 if(state&&typeof state==='object'){
  try{const clean=normalizeAiRuleOverrides(Object.hasOwn(state,'general')?{general:state.general}:{});general=clean.general;for(const [key,value]of Object.entries(state.actions||{}))if(AI_RULE_ACTIONS.includes(key))overrides[key]=normalizeAiRuleOverrides({action:value}).action;}catch{general=undefined;overrides={};}
 }
 const details=el('details',undefined,'ai-rules ai-rule-editor');details.dataset.aiRuleEditor='';const summary=el('summary'),intro=el('p','可直接改写下面的规则，只用于本次任务。留空会停用该段偏好；事实、来源和范围保护始终生效。','ai-muted'),g=field('本次通用规则','aiRuleGeneral',4),a=field('本次任务规则','aiRuleAction',4),gReset=button('通用规则沿用全局','data-ai-inherit-general'),aReset=button('任务规则沿用全局','data-ai-inherit-action'),effective=el('pre',undefined,'ai-effective-rules');effective.dataset.aiEffectiveRules='';effective.hidden=true;details.append(summary,intro,g.wrap,gReset,a.wrap,aReset,effective);host.append(details);
 const read=()=>normalizeAiRuleOverrides({...((general!==undefined)?{general}:{}),...(Object.hasOwn(overrides,current)?{action:overrides[current]}:{})});
 const refresh=()=>{const value=resolveAiRulePreferences(global,current,read());if(g.area.value!==value.general)g.area.value=value.general;if(a.area.value!==value.action)a.area.value=value.action;summary.textContent='本次 AI 规则 · '+(Object.keys(read()).length?'已临时修改':'沿用全局');effective.textContent='通用规则：\n'+(value.general||'（本次停用）')+'\n\n本次任务规则：\n'+(value.action||'（本次停用）');};
 const changed=()=>{refresh();onChange?.();};
 g.area.oninput=()=>{general=g.area.value;changed();};a.area.oninput=()=>{overrides[current]=a.area.value;changed();};gReset.onclick=()=>{general=undefined;changed();};aReset.onclick=()=>{delete overrides[current];changed();};refresh();
 return {getOverrides:read,getState:()=>({...((general!==undefined)?{general}:{}),actions:{...overrides}}),setAction(next){current=next;refresh();},setDisabled(value){for(const n of details.querySelectorAll('textarea,button'))n.disabled=value;},effectiveText:()=>effective.textContent};
}
