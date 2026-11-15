import {getHelpTopic,searchHelpTopics} from './help-content.mjs';
import {captureTextSelection,readEditableText,restoreTextSelection} from './rich-text-view.mjs';
const sessions=new WeakMap();
const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const button=(text,attribute,className='button quiet')=>{const node=el('button',text,className);node.type='button';node.setAttribute(attribute,'');return node;};
const composing=event=>event.isComposing||event.keyCode===229;
function busy(ctx){
 const ui=ctx.ui||{};
 return ['stateTransactionBusy','librarySaving','libraryRestoreBusy','fullRestoring','softwareUpdating','projectManagementBusy','projectCommitBusy','bilingualSyncSaving'].some(key=>ui[key])
   || Boolean(ctx.aiRuleSettings?.isBusy?.()) || Boolean(document.querySelector('#ai-settings-host')?.aiSettingsBusy);
}
function captureReturnTarget(ctx){
 const previous=document.activeElement;
 const field=previous?.closest?.('#resume-pages .resume-text[data-field][contenteditable]');
 if(field?.isContentEditable){
  const project=ctx.project,blockId=field.closest('[data-block-id]')?.dataset.blockId,name=field.dataset.field;
  const block=project?.blocks.find(item=>item.id===blockId),range=captureTextSelection(field);
  if(ctx.ui?.screen!=='editor'||ctx.ui.selectedBlockId!==blockId||!['title','subtitle','body'].includes(name)||!range||block?.[project.language]?.[name]!==range.textSnapshot)return null;
  const boundaries=new Set([range.textSnapshot.length,...Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(range.textSnapshot),part=>part.index)]);
  if(!boundaries.has(range.start)||!boundaries.has(range.end))return null;
  return {kind:'inline',ctx,projectId:project.id,language:project.language,blockId,field:name,range,inlineEdited:field.dataset.inlineEdited};
 }
 if(!previous||previous===document.body||previous.closest?.('#modal'))return null;
 return {kind:'control',element:previous,value:typeof previous.value==='string'?previous.value:undefined,selection:typeof previous.selectionStart==='number'?{start:previous.selectionStart,end:previous.selectionEnd,direction:previous.selectionDirection}:null};
}
function restoreReturnTarget(target){
 if(!target||document.querySelector('dialog[open]'))return;
 if(target.kind==='control'){
  const {element,selection}=target;
  if(!element.isConnected||element.disabled||element.closest('[inert]')||(target.value!==undefined&&element.value!==target.value))return;
  // A new deliberate focus after closing takes priority over a delayed close event.
  const active=document.activeElement;if(active!==document.body&&active!==element&&active?.tagName!=='DIALOG'&&!active?.closest?.('dialog'))return;
  element.focus({preventScroll:true});if(selection&&typeof element.setSelectionRange==='function')element.setSelectionRange(selection.start,selection.end,selection.direction);return;
 }
 const {ctx,range}=target,project=ctx.project;
 if(busy(ctx)||ctx.ui?.screen!=='editor'||project?.id!==target.projectId||project.language!==target.language||ctx.ui.selectedBlockId!==target.blockId)return;
 const block=project.blocks.find(item=>item.id===target.blockId);
 if(!block||block.locked||block.hiddenLanguages?.includes(target.language)||block[target.language]?.[target.field]!==range.textSnapshot)return;
 const field=[...document.querySelectorAll('#resume-pages .resume-text[data-field]')].find(node=>node.dataset.field===target.field&&node.closest('[data-block-id]')?.dataset.blockId===target.blockId);
 if(!field||field.closest('[inert]')||readEditableText(field)!==range.textSnapshot)return;
 const active=document.activeElement;if(active!==document.body&&active!==field&&active?.tagName!=='DIALOG'&&!active?.closest?.('dialog'))return;
 field.contentEditable='plaintext-only';field.spellcheck=false;
 if(target.inlineEdited!==undefined)field.dataset.inlineEdited=target.inlineEdited;else delete field.dataset.inlineEdited;
 if(!restoreTextSelection(field,range.start,range.end,{backward:range.backward,focus:true}))field.removeAttribute('contenteditable');
}
// The shared modal calls this before replacing its content. It must not move
// focus back to a background field while a new confirmation is being opened.
export function clearHelpCenter(dialog){
 const session=sessions.get(dialog);if(!session)return;
 if(!dialog.open){
  // close() has already queued an event, but another modal may open before it
  // is delivered. Consume only that stale event when a new dialog is open;
  // otherwise the next genuine close still reaches its normal handlers.
  const staleClose=event=>{dialog.removeEventListener('close',staleClose,true);if(dialog.open)event.stopImmediatePropagation();};
  dialog.addEventListener('close',staleClose,true);
 }
 session.finish(false);
}
// Opening help never navigates, flushes a draft or replaces an existing modal.
export function openHelpCenter(ctx,{topic='start'}={}){
 if(document.querySelector('dialog[open]')){ctx.notify?.('请先完成或关闭当前窗口，再打开使用帮助。');return false;}
 if(busy(ctx)){ctx.notify?.('正在保存或恢复资料，请稍候再打开使用帮助。');return false;}
 const dialog=document.querySelector('#modal');if(!dialog||typeof ctx.modal!=='function')return false;
 // close() queues its event. Reopening in that interval retires the old session
 // synchronously and carries its return target when native focus could not.
 const target=captureReturnTarget(ctx)||sessions.get(dialog)?.target;
 clearHelpCenter(dialog);
 let disposed=false,selected=getHelpTopic(topic).id,article,search,list,status,empty,feedback,session;
 const guard=event=>{
  if(disposed||!dialog.open||sessions.get(dialog)!==session)return;
  if(event.key==='Escape'&&!composing(event)){event.preventDefault();event.stopImmediatePropagation();ctx.closeModal();return;}
  if(((event.ctrlKey||event.metaKey)&&['s','z'].includes(event.key.toLowerCase()))||event.key==='F1'){event.preventDefault();event.stopImmediatePropagation();}
 };
 const finish=restoreFocus=>{
  if(disposed)return;disposed=true;document.removeEventListener('keydown',guard,true);dialog.removeEventListener('close',onClose);
  if(sessions.get(dialog)!==session)return;
  sessions.delete(dialog);dialog.classList.remove('help-center-dialog');
  if(restoreFocus&&!dialog.open)restoreReturnTarget(target);
 };
 // An old queued close event may reach listeners registered for a newer open
 // dialog. The current open session owns neither that event nor its cleanup.
 const onClose=()=>{if(!dialog.open)finish(true);};
 session={target,finish};
 const showTopic=id=>{
  const item=getHelpTopic(id);selected=item.id;article.replaceChildren();const heading=el('h3',item.title);heading.id='help-topic-title';article.append(heading,el('p',item.summary,'help-topic-summary'));
  for(const section of item.sections){const part=el('section');part.append(el('h4',section.title));for(const paragraph of section.paragraphs)part.append(el('p',paragraph));if(section.steps?.length){const steps=el('ol');for(const step of section.steps)steps.append(el('li',step));part.append(steps);}article.append(part);}
  for(const control of list.querySelectorAll('[data-help-topic]')){if(control.dataset.helpTopic===selected)control.setAttribute('aria-current','page');else control.removeAttribute('aria-current');}
  article.scrollTop=0;
 };
 const renderResults=()=>{
  const results=searchHelpTopics(search.value);list.replaceChildren();empty.hidden=results.length>0;article.hidden=!results.length;
  status.textContent=results.length?`${results.length} 个帮助话题`:'没有找到相关话题，请换个关键词或清空搜索。';
  for(const item of results){const control=button(item.title,'data-help-topic','help-topic-button');control.dataset.helpTopic=item.id;control.onclick=()=>showTopic(item.id);list.append(control);}
  if(results.length)showTopic(results.some(item=>item.id===selected)?selected:results[0].id);
 };
 try{
  ctx.modal('使用帮助','离线查看；关闭后继续当前填写。','',host=>{
   const root=el('div',undefined,'help-center'),searchBar=el('div',undefined,'help-search-bar'),label=el('label','搜索帮助','help-search-label');search=el('input');search.type='search';search.placeholder='例如：分页、AI 规则、备份';search.maxLength=240;search.dataset.helpSearch='';search.id='help-search';label.htmlFor=search.id;const clear=button('清空搜索','data-help-clear');searchBar.append(label,search,clear);
   status=el('p','','help-results-status');status.dataset.helpResultsStatus='';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
   const body=el('div',undefined,'help-layout');list=el('nav',undefined,'help-topic-list');list.setAttribute('aria-label','帮助话题');
   article=el('article',undefined,'help-article');article.dataset.helpArticle='';article.dataset.helpBody='';article.tabIndex=0;article.setAttribute('aria-labelledby','help-topic-title');
   empty=el('p','没有匹配内容。可以试试“建立简历”“照片”或“更新”。','help-empty');empty.dataset.helpEmpty='';empty.hidden=true;body.append(list,article,empty);
   const footer=el('div',undefined,'help-footer'),copy=button('复制反馈信息','data-help-copy'),close=button('关闭帮助','data-help-close','button primary');feedback=el('p','','help-feedback');feedback.dataset.helpFeedback='';feedback.setAttribute('role','status');footer.append(copy,feedback,close);
   root.append(searchBar,status,body,footer);host.replaceChildren(root);
   search.oninput=renderResults;clear.onclick=()=>{search.value='';renderResults();search.focus();};search.onkeydown=event=>{if(!composing(event)&&(event.key==='ArrowDown'||event.key==='Enter')){event.preventDefault();list.querySelector('button')?.focus();}};
   copy.onclick=async()=>{if(copy.disabled)return;copy.disabled=true;try{if(typeof window.resume?.copySupportInfo!=='function')throw Error();await window.resume.copySupportInfo();if(!disposed)feedback.textContent='已复制版本和系统信息，不含姓名、简历内容或 Key。请自行粘贴到反馈中。';}catch{if(!disposed)feedback.textContent='未能复制反馈信息，请稍后重试。当前填写保持不变。';}finally{if(copy.isConnected)copy.disabled=false;}};
   close.onclick=()=>ctx.closeModal();renderResults();search.focus();
  });
  sessions.set(dialog,session);dialog.classList.add('help-center-dialog');dialog.addEventListener('close',onClose);document.addEventListener('keydown',guard,true);return true;
 }catch(error){finish(false);throw error;}
}
export function mountHelpSettings(ctx,host){
 if(!host)return;host.dataset.helpSettings='';const heading=el('h3','使用帮助'),description=el('p','查看离线上手步骤、排版与 AI 说明、备份和更新方法。无需离开当前填写。'),open=button('打开使用帮助','data-open-help','button secondary');
 open.onclick=()=>ctx.openHelpCenter?ctx.openHelpCenter('start'):openHelpCenter(ctx);host.replaceChildren(heading,description,open);
}
