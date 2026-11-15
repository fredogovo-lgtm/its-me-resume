import {saveResumeImportDraft,loadResumeImportDraft,clearResumeImportDraft} from './resume-import-draft.mjs';
// Review-only text import. Rendering uses DOM text/value; source HTML and instructions stay inert.
import {parseResumeText,mergeConfirmedImport,RESUME_IMPORT_MAX_TEXT} from '../core/resume-import.mjs';
import {categories} from './helpers.mjs';
import {requestLibraryNavigation} from './library-navigation.mjs';
const labels={name:'姓名',headline:'职业方向',city:'城市',email:'邮箱',phone:'电话',website:'个人网站'};
const el=(tag,value,className)=>{const node=document.createElement(tag);if(value!==undefined)node.textContent=value;if(className)node.className=className;return node;};
const action=(label,attribute,style='secondary')=>{const node=el('button',label,'button '+style);node.type='button';node.setAttribute(attribute,'');return node;};
function control(label,name,value,{area=false,max=2000,rows=3}={}){const wrap=el('label',undefined,'field'),input=el(area?'textarea':'input');input.name=name;input.value=value;input.maxLength=max;if(area)input.rows=rows;wrap.append(el('span',label),input);return{wrap,input};}
const readableError=error=>String(error?.message||'导入未完成，请重试。').replace(/^(?:Error invoking remote method[^:]*:\s*|Error:\s*)+/u,'').slice(0,500);
export function openResumeImport(ctx,options={}){
 return requestLibraryNavigation(ctx,()=>showImport(ctx,options)).catch(error=>ctx.notify?.(readableError(error),true));
}
export const hasResumeImportDraft=ctx=>Boolean(loadResumeImportDraft(ctx).draft);
function showImport(ctx,options={}){
 const {onImportAi}=options,recovered=loadResumeImportDraft(ctx);
 if(recovered.corrupt){ctx.modal('导入草稿未能读取',recovered.notice,'<p>原草稿没有被覆盖。可以保留并关闭，或明确丢弃后重新导入。</p><div class="modal-actions"><button type="button" class="button secondary" data-import-keep-corrupt>保留并关闭</button><button type="button" class="button quiet danger" data-import-clear-corrupt>丢弃损坏草稿并重新导入</button></div>',root=>{root.querySelector('[data-import-keep-corrupt]').onclick=()=>ctx.closeModal();root.querySelector('[data-import-clear-corrupt]').onclick=()=>{if(clearResumeImportDraft(ctx)){ctx.closeModal();showImport(ctx,options);}};});return;}

 if(!document.querySelector('link[data-resume-import-style]')){const sheet=document.createElement('link');sheet.rel='stylesheet';sheet.href=new URL('./resume-import.css',import.meta.url).href;sheet.dataset.resumeImportStyle='';document.head.append(sheet);}
 if(ctx.ui.resumeImportSession)return;
 const session={closed:false,busy:false,saving:false,review:null,text:'',fileName:'粘贴的文字',warnings:[],language:ctx.ui.libraryLanguage||'zh'};Object.assign(session,recovered.draft||{});session.closed=false;session.busy=false;session.saving=false;session.done=false;ctx.ui.resumeImportSession=session;
 // A saved import whose draft cleanup failed must not be selected again silently.
 if(session.review){for(const row of session.review.entries){if(ctx.state.library.entries.some(entry=>entry.category===row.category&&entry[session.language]?.title===row.title&&entry[session.language]?.subtitle===row.subtitle&&entry[session.language]?.body===row.body&&(entry.periodByLanguage?.[session.language]??entry.period??'')===row.period)){row.duplicate=true;row.selected=false;}}for(const row of session.review.person){const current=['email','phone','website'].includes(row.field)?ctx.state.library.person[row.field]:ctx.state.library.person[session.language]?.[row.field];if(current===row.value)row.selected=false;}}
 const dialog=document.querySelector('#modal');let host;
 const preserve=()=>{if(session.done)return true;session.capture?.();if(!session.text&&!session.review)return true;const ok=saveResumeImportDraft(ctx,session);if(!ok)session.message?.('导入草稿未能保存；请先完成入库，或明确丢弃后关闭。',true);return ok;};session.persist=preserve;
 const close=()=>{if(session.saving)return false;if(!preserve())return false;dispose();ctx.closeModal();ctx.notify?.(session.text||session.review?'导入草稿保留在本机，可从“继续导入草稿”返回。':'已关闭导入。');ctx.render?.();return true;};
 const onClose=()=>{if(dialog?.open||session.closed)return;if(session.saving||!preserve()){if(host?.isConnected&&!dialog.open)dialog.showModal();return;}dispose();ctx.render?.();};
 const onCancel=event=>{event.preventDefault();close();};
 const onX=event=>{event.preventDefault();event.stopImmediatePropagation();close();};
 const onHotkey=event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopImmediatePropagation();if(preserve())session.message?.('导入草稿已保存在本机；仍需确认勾选内容才会入库。');}};
 const dispose=()=>{session.closed=true;if(ctx.ui.resumeImportSession===session)delete ctx.ui.resumeImportSession;dialog?.removeEventListener('close',onClose);dialog?.removeEventListener('cancel',onCancel);dialog?.removeEventListener('keydown',onHotkey,true);document.querySelector('#close-modal')?.removeEventListener('click',onX,true);};
 ctx.modal('导入已有简历','在本机提取文字，核对后只将勾选内容加入资料库。原文件、已有简历和历史 PDF 保留。','<section data-resume-import></section>',root=>{
  host=root.querySelector('[data-resume-import]');host.className='resume-import-shell';
  const connected=()=>!session.closed&&host.isConnected&&Boolean(dialog?.open);
  const status=el('p','','ai-feedback');status.dataset.importStatus='';status.setAttribute('role','status');
  const message=(value,error=false)=>{status.textContent=value;status.classList.toggle('error',error);};session.message=message;
  const discard=()=>{if(session.saving)return;if(!clearResumeImportDraft(ctx))return;session.done=true;dispose();ctx.closeModal();ctx.render?.();};
  const discardButton=()=>{const b=action('丢弃草稿并关闭','data-import-discard','quiet danger');b.onclick=discard;return b;};
  const sourceDetails=(label,value)=>{const detail=el('details',undefined,'backup-entry-preview');detail.append(el('summary',label));const pre=el('pre',value);pre.style.whiteSpace='pre-wrap';pre.style.overflowWrap='anywhere';detail.append(pre);return detail;};
  function inputStep(){
   session.stage='source';host.replaceChildren();const language=el('label',undefined,'field'),select=el('select');select.name='importLanguage';for(const[value,label]of[['zh','导入到中文资料'],['en','导入到英文资料']]){const option=el('option',label);option.value=value;select.append(option);}select.value=session.language;language.append(el('span','本次文字的语言'),select);
   const choose=action('选择 TXT / DOCX / PDF','data-import-file'),source=control('或粘贴简历文字','resumeImportText',session.text,{area:true,max:RESUME_IMPORT_MAX_TEXT,rows:12}),parse=action('整理并核对内容','data-import-parse','primary'),cancel=action('关闭，保留草稿','data-import-cancel'),actions=el('div',undefined,'modal-actions');
   const note=el('p','支持 16 MB 内的文件、50 页内的有文字 PDF；不做 OCR。DOCX 仅提取正文，图片和原排版不会导入。TXT 请使用 UTF-8 或带 BOM 的 UTF-16。','ai-muted');
   actions.append(discardButton(),cancel,parse);host.append(language,choose,note,source.wrap,status,actions);message(session.warnings.join(' '));
   session.capture=()=>{session.text=source.input.value;session.language=select.value;};
   source.input.oninput=select.onchange=()=>preserve();cancel.onclick=close;
   choose.onclick=async()=>{if(session.busy)return;if(typeof window.resume.importResumeText!=='function')return message('当前版本尚不支持选择文件，请直接粘贴文字。',true);session.busy=true;choose.disabled=parse.disabled=select.disabled=source.input.disabled=true;message('正在本机提取文字，可以关闭窗口取消本次导入。');try{const result=await window.resume.importResumeText();if(!connected())return;if(!result?.cancelled){if(typeof result?.text!=='string'||result.text.length>RESUME_IMPORT_MAX_TEXT)throw Error('提取文字超出允许范围。');session.text=result.text;session.fileName=result.fileName||'选择的文件';session.warnings=Array.isArray(result.warnings)?result.warnings:[];source.input.value=session.text;message(session.warnings.join(' ')||'已提取文字。点击“整理并核对内容”继续。');preserve();}else message('已取消选择，粘贴内容保持不变。');}catch(error){if(connected())message(readableError(error),true);}finally{session.busy=false;if(connected())choose.disabled=parse.disabled=select.disabled=source.input.disabled=false;}};
   parse.onclick=()=>{if(session.busy)return;session.text=source.input.value;session.language=select.value;try{session.review=parseResumeText(session.text,{language:session.language,library:ctx.state.library,fileName:session.fileName});session.stage='review';preserve();reviewStep();}catch(error){message(readableError(error),true);}};
  }
  function reviewStep(){
   session.stage='review';host.replaceChildren();message('');const review=session.review,rows=[],personRows=[],summary=el('p',`将导入到${review.language==='zh'?'中文':'英文'}资料：个人信息 ${review.person.length} 项、经历候选 ${review.entries.length} 段。只新增勾选经历；已有个人字段默认不勾选。`,'ai-muted');host.append(summary,sourceDetails('查看完整提取原文：'+review.fileName,review.sourceText));for(const warning of [...session.warnings,...review.warnings])host.append(el('p',warning,'ai-muted'));
   const check=(label,selected,attribute)=>{const wrap=el('label',undefined,'ai-checkbox'),input=el('input');input.type='checkbox';input.checked=selected;input.setAttribute(attribute,'');wrap.append(input,document.createTextNode(label));return{wrap,input};};
   if(review.person.length)host.append(el('h3','个人信息'));
   for(const row of review.person){const card=el('section',undefined,'backup-content-section'),choice=check('导入'+labels[row.field],row.selected,'data-import-person-check'),value=control(labels[row.field],'importPerson-'+row.field,row.value);card.dataset.importPerson=row.field;card.append(choice.wrap,value.wrap);let replace;
    if(row.before){card.append(el('p','现有值：'+row.before,'ai-muted'));replace=check('明确替换此已有字段（只影响本次语言；联系方式为共用字段）',Boolean(row.replace),'data-import-replace');card.append(replace.wrap);}card.append(sourceDetails('核对该字段源文',row.source));personRows.push({row,choice:choice.input,value:value.input,replace:replace?.input});host.append(card);
   }
   if(review.entries.length)host.append(el('h3','经历候选'));
   for(const [index,row]of review.entries.entries()){const card=el('section',undefined,'backup-content-section');card.dataset.importEntry=String(index);const choice=check(`新增第 ${index+1} 段经历${row.duplicate?'（与现有资料相同，默认不勾选）':''}`,row.selected,'data-import-entry-check'),category=el('label',undefined,'field'),select=el('select');select.name='importCategory';for(const [key,label]of Object.entries(categories)){const option=el('option',label);option.value=key;select.append(option);}select.value=row.category;category.append(el('span','分类'),select);
    const title=control('标题','importTitle',row.title),subtitle=control('副标题 / 机构','importSubtitle',row.subtitle,{max:5000}),period=control('时间（请自行核对）','importPeriod',row.period,{max:500}),body=control('正文','importBody',row.body,{area:true,max:RESUME_IMPORT_MAX_TEXT,rows:5});card.append(choice.wrap,category,title.wrap,subtitle.wrap,period.wrap,body.wrap,sourceDetails('核对本段源文',row.source));rows.push({row,choice:choice.input,category:select,title:title.input,subtitle:subtitle.input,period:period.input,body:body.input});host.append(card);
   }
   const back=action('返回原文并重新整理候选','data-import-back'),save=action('确认导入勾选内容','data-import-confirm','primary'),cancel=action('关闭，保留草稿','data-import-cancel'),actions=el('div',undefined,'modal-actions');actions.append(back,discardButton(),cancel,save);host.append(status,actions);
   session.capture=()=>{for(const item of personRows){item.row.selected=item.choice.checked;item.row.value=item.value.value;item.row.replace=Boolean(item.replace?.checked);}for(const item of rows){item.row.selected=item.choice.checked;for(const key of ['category','title','subtitle','period','body'])item.row[key]=item[key].value;}};
   for(const control of host.querySelectorAll('input,textarea,select')){control.addEventListener('input',()=>preserve());control.addEventListener('change',()=>preserve());}
   back.onclick=()=>{if(!session.busy){session.capture();session.review=null;inputStep();preserve();message('重新整理会按原文生成新候选；请在此修改原文后继续。');}};cancel.onclick=close;
   save.onclick=async()=>{if(session.busy)return;session.capture?.();preserve();for(const item of personRows){item.row.selected=item.choice.checked;item.row.value=item.value.value;item.row.replace=Boolean(item.replace?.checked);}for(const item of rows){item.row.selected=item.choice.checked;for(const key of ['category','title','subtitle','period','body'])item.row[key]=item[key].value;}
    let next;try{next=mergeConfirmedImport(ctx.state.library,review);}catch(error){message(readableError(error),true);return;}
    session.busy=true;session.saving=true;const closeButton=document.querySelector('#close-modal'),closeDisabled=Boolean(closeButton?.disabled);if(closeButton)closeButton.disabled=true;const controls=Array.from(host.querySelectorAll('input,textarea,select,button'),node=>[node,node.disabled]);for(const[node]of controls)node.disabled=true;message('正在保存已确认的内容…');
    try{const previousIds=new Set(ctx.state.library.entries.map(item=>item.id));await ctx.saveLibrary(next);session.done=true;session.cleaned=clearResumeImportDraft(ctx);const entryIds=next.entries.filter(item=>!previousIds.has(item.id)).map(item=>item.id);ctx.ui.librarySelection=entryIds[0]||'person';ctx.ui.libraryLanguage=review.language;ctx.render?.();if(connected())successStep(entryIds,review.language);}
    catch(error){if(connected())message('导入未保存：'+readableError(error),true);}
    finally{session.busy=false;session.saving=false;if(closeButton)closeButton.disabled=closeDisabled;for(const[node,disabled]of controls)if(node.isConnected)node.disabled=disabled;}
   };
  }
  function successStep(entryIds,language){host.replaceChildren(el('h3','已导入资料库'),el('p',`新增 ${entryIds.length} 段经历，勾选的个人信息已保存。已有项目和导出文件保留。`,'ai-muted'));const done=action('完成','data-import-done','primary'),actions=el('div',undefined,'modal-actions');done.onclick=()=>{dispose();ctx.closeModal();ctx.render?.();};actions.append(done);if(entryIds.length&&(typeof onImportAi==='function'||typeof ctx.openLibraryAi==='function')){const ai=action('用 AI 检查刚导入的第一段','data-import-ai');ai.onclick=()=>{dispose();ctx.closeModal();if(typeof onImportAi==='function')void Promise.resolve(onImportAi(ctx,{entryIds,language})).catch(error=>ctx.notify?.(readableError(error),true));else void ctx.openLibraryAi('review');};host.append(el('p','可选 AI 检查会打开现有助手：先查看发送内容，主动发送才调用 API。刚才的资料已经由你确认入库；AI 建议仍需逐项采用。','ai-muted'));actions.prepend(ai);}host.append(actions);}
  if(session.review&&session.stage!=='source')reviewStep();else inputStep();
  if(recovered.draft)message('已恢复上次导入草稿。原文、人工核对和勾选状态继续保留；相同已入库经历默认取消勾选。');
 });
 dialog?.addEventListener('close',onClose);dialog?.addEventListener('cancel',onCancel);dialog?.addEventListener('keydown',onHotkey,true);document.querySelector('#close-modal')?.addEventListener('click',onX,true);return session;
}



