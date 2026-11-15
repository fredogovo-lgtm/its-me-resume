import {createBilingualSyncPlan} from '../core/bilingual-sync.mjs';
import {rememberLibraryBilingualSync,getLibraryBilingualSyncPlan,offerLibraryBilingualSync,openBilingualSync} from './bilingual-sync.mjs';
import {createLibrarySaveAiTask,librarySaveAiCandidate} from '../core/library-save-ai.mjs';
import {validateLibrary} from '../core/model.mjs';
import {getPeriod} from '../core/entry-content.mjs';
import {getExperience} from '../core/library-experience.mjs';
import {libraryFormValues,preserveLibraryDraftVariants,clearLibraryDraft} from './library-drafts.mjs';
import {readLibraryForm} from './library-navigation.mjs';
import {updateExperienceCategory} from './experience-controls.mjs';
import {userMessage} from './user-message.mjs';
import {createAiTask,buildAiMessages} from '../core/ai-tasks.mjs';
import {loadAiRulePreferences,createAiRuleEditor} from './ai-rule-controls.mjs';
import {aiFieldLabels} from './ai-translation-fields.mjs';

const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function sourceSnapshot(library,selection,language){
 const row=selection==='person'?library.person:library.entries.find(e=>e.id===selection);if(!row)return null;
 return selection==='person'?{text:row[language],email:row.email,phone:row.phone,website:row.website,websiteLabel:row.websiteLabel||'',websiteLabelByLanguage:row.websiteLabelByLanguage||{},links:row.links||[]}:{category:row.category,text:row[language],period:getPeriod(row,language),tags:row.tags,experience:getExperience(row,language),companyGroupId:row.companyGroupId||'',attachmentIds:row.attachmentIds||[]};
}
function setValues(form,values){
 for(const [name,value]of Object.entries(values)){
  if(name==='attachmentIdsText'){let ids=[];try{ids=JSON.parse(value);}catch{}for(const c of form.querySelectorAll('[name="linkedAttachment"]'))c.checked=ids.includes(c.value);continue;}
  const c=form.elements.namedItem(name);if(!c||typeof c.value!=='string')continue;
  if(c.type==='checkbox')c.checked=value==='true'||value==='on';else c.value=value;
 }
 updateExperienceCategory(form);
}
function comparisonForm(template,values,version){
 const form=template.cloneNode(true);form.removeAttribute('id');form.dataset.saveAiVersion=version;form.inert=false;
 for(const n of form.querySelectorAll('[id]'))n.removeAttribute('id');
 for(const n of form.querySelectorAll('.form-footer,.ai-context-actions,.bilingual-note,.bilingual-sync-notice'))n.remove();
 // Photos are shared local assets, outside this text-only comparison transaction.
 for(const photo of form.querySelectorAll('.library-personal-photo')){
  photo.querySelector('.button-group')?.remove();photo.querySelector('small')?.remove();
  const title=photo.querySelector('strong'),hint=photo.querySelector('p');
  if(title)title.textContent='个人图片 · 只读预览';
  if(hint)hint.textContent='照片不参与 AI 优化，仅供对照。需要更换、裁剪或移除，请返回资料库修改。';
 }
 for(const c of form.querySelectorAll('input,textarea,select')){c.disabled=false;c.removeAttribute('autofocus');}
 for(const d of form.querySelectorAll('details'))d.open=true;
 setValues(form,values);return form;
}

// Called only after a successful ordinary local save. An invitation is not a
// network request: the user must choose AI optimization inside this dialog.
export async function offerLibrarySaveAi(ctx,{form,values,selection,language,savedLibrary,beforeLibrary,syncPlan}={}){
 if(ctx.ui.librarySaveReviewPending||!form?.cloneNode)return false;
 let status,task,ruleStatus,ruleEditor;
 const fallback=()=>syncPlan?.changes.length?offerLibraryBilingualSync(ctx,syncPlan,{beforeLibrary}):true;
 try{status=await window.resume.aiStatus();if(!status.keyPresent)return fallback();task=createLibrarySaveAiTask(savedLibrary,{selection,language,values});}
 catch{return fallback();}
 try{ruleStatus=await loadAiRulePreferences();if(ruleStatus.notice){ctx.notify?.(ruleStatus.notice+' 请到AI设置重新保存规则后再优化。',true);return fallback();}}catch{ctx.notify?.('AI规则未能读取，本次填写已正常保存。请稍后再试。',true);return fallback();}
 const base=structuredClone(values),saved=structuredClone(savedLibrary),template=form.cloneNode(true);
 let dialog,root,request=null,closed=false,saving=false,originalForm,optimizedForm,originalValues=base,optimizedValues,comparisonReady=false,risks=[];
 const draftIds=[0,1].map(()=>`${selection}:${language}:preserved:${crypto.randomUUID()}`);
 ctx.ui.librarySaveReviewPending=true;
 return new Promise(resolve=>{
  const current=()=>{
   if(ctx.ui.screen!=='library'||ctx.ui.librarySelection!==selection||ctx.ui.libraryLanguage!==language||ctx.ui.dirtyLibrary||!equal(sourceSnapshot(ctx.state.library,selection,language),sourceSnapshot(saved,selection,language)))throw new Error('资料或语言已变化，请保留当前编辑后重新保存并优化。');
  };
  const read=(f,fallback)=>f?{...fallback,...libraryFormValues(f)}:{...fallback};
  const keepDrafts=()=>{
   if(!comparisonReady)return true;
   return preserveLibraryDraftVariants({...ctx,ui:{...ctx.ui,librarySelection:selection,libraryLanguage:language}},[{label:'填写版 · 对比编辑',values:read(originalForm,originalValues)},{label:'AI优化版 · 对比编辑',values:read(optimizedForm,optimizedValues||base)}],{ids:draftIds});
  };
  const state=(message,error=false)=>{const n=root.querySelector('[data-save-ai-status]');n.textContent=message;n.classList.toggle('is-error',error);};
  const cancel=()=>{const id=request;request=null;if(id)Promise.resolve(window.resume.aiCancel(id)).catch(()=>{});};
  const cleanup=()=>{dialog?.removeEventListener('cancel',onCancel);dialog?.removeEventListener('close',onClosed);dialog?.removeEventListener('click',onBackdrop,true);document.querySelector('#close-modal')?.removeEventListener('click',onX,true);dialog?.classList.remove('save-ai-modal');ctx.ui.librarySaveReviewPending=false;};
  const finish=(ok)=>{if(closed)return;closed=true;cancel();cleanup();ctx.closeModal();resolve(ok);};
  const requestClose=()=>{
   if(saving){state('正在保存所选版本，请稍候。');return;}
   if(!keepDrafts()){state('两版编辑未能保存在本机，请保留此窗口并选择一版保存。',true);return;}
   const hadComparison=comparisonReady;finish(false);if(hadComparison){ctx.render?.();ctx.notify?.('两版内容已保留在“未提交草稿”，本次已保存的资料保持不变。');}
  };
  function onCancel(event){event.preventDefault();requestClose();}
  function onX(event){event.preventDefault();event.stopImmediatePropagation();requestClose();}
  function onBackdrop(event){if(event.target===dialog){event.preventDefault();event.stopImmediatePropagation();requestClose();}}
  function onClosed(){
   if(closed||dialog?.open)return;
   if(saving||!keepDrafts()){dialog.showModal();state('请保留此窗口并保存编辑，当前未能关闭。',true);return;}
   const hadComparison=comparisonReady;closed=true;cancel();cleanup();resolve(false);if(hadComparison)ctx.render?.();
  }
  const save=async(version)=>{
   if(closed||saving)return;
   const chosen=version==='original'?originalForm:optimizedForm;
   if(!chosen)return;
   for(const c of chosen.querySelectorAll('input,textarea'))if(c.maxLength>=0&&c.value.length>c.maxLength){c.setCustomValidity('此信息最多'+c.maxLength+'个字符，请缩短后再保存。');c.reportValidity();c.addEventListener('input',()=>c.setCustomValidity(''),{once:true});return;}
   if(!chosen.reportValidity())return;
   if(version==='optimized'&&risks.length&&!root.querySelector('[data-save-ai-risk-ack]')?.checked){state('优化版有需核对的含义差异，请核对提示后确认，或编辑填写版保存。',true);return;}
   const selected=read(chosen,version==='original'?originalValues:optimizedValues);
   try{
    current();const next=readLibraryForm(ctx.state.library,{selection,language},selected);validateLibrary(next);
    saving=true;for(const c of root.querySelectorAll('button,input,textarea,select'))c.disabled=true;state('正在保存所选版本…');
    const syncAfter=Boolean(root.querySelector('[data-save-ai-sync-after]')?.checked);
    await ctx.saveLibrary(next);const delta=beforeLibrary?createBilingualSyncPlan(beforeLibrary,next,{scope:'library',selection,language}):null;const finalSync=delta?rememberLibraryBilingualSync(ctx,delta,{beforeLibrary}):null;for(const id of draftIds)clearLibraryDraft(ctx,id);comparisonReady=false;finish(true);if(syncAfter&&finalSync?.changes.length)void openBilingualSync(ctx,finalSync);
   }catch(error){state(userMessage(error),true);}
   finally{saving=false;if(!closed){for(const c of root.querySelectorAll('button,input,textarea,select'))c.disabled=false;syncRisk();}}
  };
  const syncRisk=()=>{const b=root.querySelector('[data-save-ai-keep="optimized"]');if(b)b.disabled=saving||(risks.length>0&&!root.querySelector('[data-save-ai-risk-ack]')?.checked);};
  const showComparison=(candidate,result)=>{
   originalValues={...base};optimizedValues=candidate.values;risks=candidate.risks;
   const host=root.querySelector('[data-save-ai-comparison]');host.replaceChildren();host.hidden=false;root.querySelector('[data-save-ai-offer]').hidden=true;
   const summary=document.createElement('p');summary.className='save-ai-summary';summary.textContent=candidate.changes.length?'本次候选实际修改 '+candidate.changes.length+' 个字段：'+[...new Set(candidate.changes.map(c=>aiFieldLabels[c.field]||c.field))].join('、')+'。两版都能直接修改，选定后保存。':'本次没有文字改动，原文可以保留。两版都能继续修改后保存。';host.append(summary);
   const heading=dialog.querySelector('#modal-title'),description=dialog.querySelector('#modal-description');if(heading)heading.textContent='选择要保留的版本';if(description)description.textContent='两版信息都可以继续编辑，选择其中一版保存。';
   const choices=document.createElement('div');choices.className='save-ai-choice-bar';choices.setAttribute('role','group');choices.setAttribute('aria-label','选择保存版本');
   for(const version of ['original','optimized']){const b=document.createElement('button');b.type='button';b.className='button '+(version==='optimized'?'primary':'secondary');b.dataset.saveAiKeep=version;b.textContent=version==='optimized'?'采用优化版':'保留填写版';b.onclick=()=>save(version);choices.append(b);}host.append(choices);
   if(beforeLibrary){const label=document.createElement('label'),check=document.createElement('input');label.className='check-row';check.type='checkbox';check.dataset.saveAiSyncAfter='';label.append(check,document.createTextNode('保存所选版本后，核对并同步另一语言（可稍后）'));host.append(label);}
   if(risks.length){const box=document.createElement('section');box.className='save-ai-risks';const p=document.createElement('strong');p.textContent='请核对以下含义差异';box.append(p);for(const risk of risks){const line=document.createElement('p');line.textContent=risk.message;box.append(line);}const label=document.createElement('label'),ack=document.createElement('input');label.className='check-row';ack.type='checkbox';ack.dataset.saveAiRiskAck='';ack.onchange=syncRisk;label.append(ack,document.createTextNode('我已对照填写内容核对这些差异'));box.append(label);host.append(box);}
   const columns=document.createElement('div');columns.className='save-ai-columns';host.append(columns);
   for(const version of ['original','optimized']){
    const article=document.createElement('section');article.className='save-ai-version-card';
    const title=document.createElement('h3');title.textContent=version==='original'?'本次填写版':'AI 优化版';
    const hint=document.createElement('p');hint.className='save-ai-version-hint';hint.textContent='可直接编辑文字信息框';article.append(title,hint);
    const f=comparisonForm(template,version==='original'?originalValues:optimizedValues,version);
    const capture=()=>{updateExperienceCategory(f);if(!keepDrafts())state('编辑暂未能写入本机草稿，请保留此窗口并选择一版保存。',true);};f.addEventListener('input',capture);f.addEventListener('change',capture);f.onsubmit=e=>{e.preventDefault();save(version);};
    article.append(f);columns.append(article);
    if(version==='original')originalForm=f;else optimizedForm=f;
   }
   for(const change of candidate.changes){const key=change.field.replace(/^experience\./u,''),c=optimizedForm.elements.namedItem(key);c?.closest('.field')?.classList.add('save-ai-changed');}
   const explanation=root.querySelector('[data-save-ai-explanation]');explanation.replaceChildren();
   for(const text of [result.summary,...(result.notes||[])].filter(Boolean)){const p=document.createElement('p');p.textContent=text;explanation.append(p);}
   comparisonReady=true;syncRisk();if(keepDrafts())state('当前语言的文字由你选择保存，已有简历保留原稿。');else state('两版内容暂未能写入本机草稿，请保留此窗口并选择一版保存。',true);
  };
  ctx.modal('本次填写已保存','要让 AI 帮你优化这次填写吗？保留事实，只改善表达。','<div class="save-ai-review"><div data-save-ai-offer><p>使用当前条目、本语言的信息统一优化，生成后与你的填写版并排对比。</p><p class="save-ai-scope">姓名、联系方式、日期、机构、编号、链接、共用标签与证书正式名称保持原样；不发送另一语言、照片或附件文件。</p><p class="save-ai-provider"></p><div data-save-ai-rule-host></div><div class="save-ai-offer-actions"><button type="button" class="button secondary" data-save-ai-skip>暂不优化</button><button type="button" class="button primary" data-save-ai-generate>AI 优化此次填写</button><button type="button" class="button secondary" data-save-ai-sync hidden>核对 / 同步另一版</button><button type="button" class="button quiet" data-save-ai-cancel hidden>取消生成</button></div></div><p class="save-ai-status" role="status" data-save-ai-status></p><div data-save-ai-comparison hidden></div><details class="save-ai-details"><summary>查看优化说明与此次发送内容</summary><div data-save-ai-explanation></div><pre data-save-ai-payload></pre><pre data-save-ai-rule-preview></pre></details></div>',host=>{
   root=host.querySelector('.save-ai-review');dialog=root.closest('dialog');dialog.classList.add('save-ai-modal');dialog.addEventListener('cancel',onCancel);dialog.addEventListener('close',onClosed);dialog.addEventListener('click',onBackdrop,true);document.querySelector('#close-modal')?.addEventListener('click',onX,true);
   root.querySelector('.save-ai-provider').textContent=`${status.baseUrl} · ${status.model}。仅点击优化后联网，费用由你的 API 账号承担。`;
   const updatePayload=()=>{try{const previewTask=createAiTask({...task,ruleOverrides:ruleEditor?.getOverrides()});const payload=JSON.parse(buildAiMessages(previewTask,{rulePreferences:ruleStatus.preferences}).find(m=>m.role==='user').content);root.querySelector('[data-save-ai-payload]').textContent=JSON.stringify(payload,null,2);root.querySelector('[data-save-ai-rule-preview]').textContent='本次生效的表达规则：\n'+(ruleEditor?.effectiveText()||'');}catch(error){state(userMessage(error),true);}};
   ruleEditor=createAiRuleEditor(root.querySelector('[data-save-ai-rule-host]'),{preferences:ruleStatus.preferences,action:'optimize',onChange:updatePayload});updatePayload();
   const syncButton=root.querySelector('[data-save-ai-sync]');if(syncPlan?.changes.length){syncButton.hidden=false;syncButton.onclick=()=>{finish(true);void openBilingualSync(ctx,getLibraryBilingualSyncPlan(ctx,selection,language)||syncPlan);};root.querySelector('[data-save-ai-skip]').textContent='完成，稍后优化 / 同步';}
   root.querySelector('[data-save-ai-skip]').onclick=()=>finish(true);
   root.querySelector('[data-save-ai-cancel]').onclick=()=>{cancel();ruleEditor.setDisabled(false);root.querySelector('[data-save-ai-sync]').disabled=false;root.querySelector('[data-save-ai-generate]').disabled=false;root.querySelector('[data-save-ai-cancel]').hidden=true;state('已取消生成，本次填写已保存在本机。可以暂不优化，或主动再次优化。');};
   root.querySelector('[data-save-ai-generate]').onclick=async()=>{
    if(closed||request)return;
    try{current();task=createAiTask({...task,ruleOverrides:ruleEditor.getOverrides()});}catch(error){state(userMessage(error),true);return;}
    ruleEditor.setDisabled(true);root.querySelector('[data-save-ai-sync]').disabled=true;
    const id=crypto.randomUUID();request=id;const send=root.querySelector('[data-save-ai-generate]'),stop=root.querySelector('[data-save-ai-cancel]');send.disabled=true;stop.hidden=false;state('正在优化，可以取消。服务可能已开始计费。');
    try{const result=await window.resume.aiGenerate({id,task});if(closed||request!==id)return;current();const candidate=librarySaveAiCandidate(task,result,base);showComparison(candidate,result);}
    catch(error){if(!closed&&request===id)state(userMessage(error),true);}
    finally{if(!closed&&request===id){request=null;send.disabled=false;stop.hidden=true;ruleEditor.setDisabled(false);root.querySelector('[data-save-ai-sync]').disabled=false;}}
   };
  });
 });
}
