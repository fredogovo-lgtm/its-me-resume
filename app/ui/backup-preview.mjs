import {clearLibraryDraft} from './library-drafts.mjs';
import {paintPhoto} from './photo-view.mjs';
import {reviewLibraryChanges,personBackupFields,entryBackupFields,backupFieldText} from '../core/backup-review.mjs';
import {categories,dateLabel} from './helpers.mjs';
const create=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const labels={zh:'中文',en:'英文'};
const fileSize=value=>value>=1048576?`${(value/1048576).toFixed(1)} MB`:`${Math.max(1,Math.ceil((Number(value)||0)/1024))} KB`;
const date=value=>value?dateLabel(value):'未记录时间';
function display(value){if(value===null||value===undefined||value==='')return'未填写';if(Array.isArray(value))return value.length?value.join('，'):'无';return String(value);}
function entryTitle(entry,language){return entry?.[language]?.title || `未填写${labels[language]}标题`;}
function textValue(parent,label,value){const row=create('div',undefined,'backup-value-row');row.append(create('dt',label),create('dd',display(value)));parent.append(row);}
function entryContents(entry,language,library){
  const box=create('div',undefined,'backup-entry-content'),values=create('dl');
  for(const field of entryBackupFields(entry,{language})){
    if(field.experienceCategory && !['all',entry.category].includes(field.experienceCategory) && !field.value)continue;
    if(field.path.endsWith('.style')){if(field.value.length){const [lang,key]=field.path.split('.');textValue(values,field.label,styleDescription(field.value,entry[lang]?.[key]||''));}continue;}
    textValue(values,field.label,field.path==='category'?categories[field.value]||field.value:backupFieldText(field,library));
  }
  box.append(values);return box;
}
function lazyEntry(entry,language,library){const details=create('details',undefined,'backup-entry-preview');details.append(create('summary',entryTitle(entry,language)));details.addEventListener('toggle',()=>{if(details.open&&!details.dataset.loaded){details.append(entryContents(entry,language,library));details.dataset.loaded='true';}});return details;}
function photoContents(photo,label){
  const box=create('article',undefined,'backup-photo-content');if(label)box.append(create('h4',label));
  if(!photo){box.append(create('p','没有个人照片。','backup-muted'));return box;}
  const frame=create('div',undefined,'personal-photo-frame library-photo-thumb backup-photo-preview');paintPhoto(frame,photo);box.append(frame);
  const values=create('dl'),crop={x:50,y:50,zoom:1,shape:'rect',...photo.crop};textValue(values,'照片名称',photo.name);textValue(values,'图片尺寸',`${photo.width} × ${photo.height} px`);textValue(values,'保存时间',date(photo.updatedAt));textValue(values,'照片形状',crop.shape==='round'?'圆形':'圆角方形');textValue(values,'取景',`水平 ${crop.x}% / 垂直 ${crop.y}% / 放大 ${crop.zoom} 倍`);box.append(values);return box;
}
function libraryContents(library,language){
  const box=create('section',undefined,'backup-library-content');box.dataset.backupContents=language;
  const person=create('section',undefined,'backup-content-section');person.append(create('h3',`${labels[language]}个人信息`));const values=create('dl');
  for(const field of personBackupFields(library.person,{language}))textValue(values,field.label,backupFieldText(field,library));person.append(values,photoContents(library.person?.photo,'个人照片'));box.append(person);
  const entries=create('section',undefined,'backup-content-section');entries.append(create('h3',`经历（${library.entries?.length||0}）`));for(const entry of library.entries||[])entries.append(lazyEntry(entry,language,library));if(!library.entries?.length)entries.append(create('p','此版本没有经历。','backup-muted'));box.append(entries);
  const files=create('section',undefined,'backup-content-section');files.append(create('h3',`补充文件（${library.attachments?.length||0}）`));for(const file of library.attachments||[]){const row=create('article',undefined,'backup-file-preview');row.append(create('strong',file.name),create('p',`${fileSize(file.size)} · ${file.mime||'未记录类型'} · ${date(file.addedAt)}`));files.append(row);}if(!library.attachments?.length)files.append(create('p','此版本没有补充文件。','backup-muted'));box.append(files);return box;
}
function summaryText(review){const s=review.summary,items=[];if(s.photosAdded)items.push('新增个人照片');if(s.photosRemoved)items.push('移除个人照片');if(s.photosModified)items.push('修改个人照片');if(s.personalFields)items.push(`个人信息修改 ${s.personalFields} 项`);for(const [kind,label]of[['entries','经历'],['attachments','文件']])for(const [suffix,verb]of[['Added','新增'],['Modified','修改'],['Removed','移除']])if(s[kind+suffix])items.push(`${label}${verb} ${s[kind+suffix]} 项`);if(review.entries.reordered)items.push('经历顺序调整');return items.length?items.join('；'):'内容相同';}
function styleDescription(runs,text){if(!runs.length)return'没有局部样式';return runs.map(run=>{const names=[];for(const[key,value]of Object.entries(run.style||{})){if(key==='fontWeight')names.push(value===700?'粗体':'常规字重');if(key==='fontStyle')names.push(value==='italic'?'斜体':'正常字形');if(key==='textDecoration')names.push(value==='underline'?'下划线':'无下划线');if(key==='color')names.push(`颜色 ${value}`);if(key==='fontSize')names.push(`字号 ${value} pt`);if(key==='fontFamily')names.push(`字体 ${value}`);}return `“${text.slice(run.start,run.end)}”：${names.join('、')}`;}).join('\n');}
function changeDetail(change,beforeLabel,afterLabel,beforeEntry,afterEntry,beforeLibrary,afterLibrary){
  const details=create('details',undefined,'backup-change-detail');details.open=true;details.append(create('summary',change.label));
  const grid=create('div',undefined,'backup-change-grid');let before=backupFieldText({path:change.path,value:change.before},beforeLibrary),after=backupFieldText({path:change.path,value:change.after},afterLibrary);
    if(change.path.endsWith('.style')){const [language,field]=change.path.split('.');before=styleDescription(before,beforeEntry?.[language]?.[field]||'');after=styleDescription(after,afterEntry?.[language]?.[field]||'');}
    if(change.path==='storedFile'){before='当前关联文件';after='此版本关联文件';}
    if(change.path==='size'){before=fileSize(before);after=fileSize(after);}
    if(change.path==='addedAt'||change.path==='updatedAt'){before=date(before);after=date(after);}
    if(change.path==='crop.shape'){before=before==='round'?'圆形':'圆角方形';after=after==='round'?'圆形':'圆角方形';}
    if(change.path==='category'){before=categories[before]||before;after=categories[after]||after;}
    for(const[label,value]of[[beforeLabel,before],[afterLabel,after]]){const part=create('div');part.append(create('strong',label),create('pre',display(value)));grid.append(part);}details.append(grid);details.dataset.loaded='true';
  return details;
}
function entryChange(item,verb,className,library){const row=create('details',undefined,`backup-change-item ${className}`);row.append(create('summary',`${verb}经历：${item.title}`));row.addEventListener('toggle',()=>{if(!row.open||row.dataset.loaded)return;for(const language of['zh','en']){row.append(create('h4',labels[language]),entryContents(item.entry,language,library));}row.dataset.loaded='true';});return row;}
function renderChanges(review,before,after,{beforeLabel='当前资料',afterLabel='所选备份'}={}){
  const box=create('section',undefined,'backup-changes');box.append(create('p',summaryText(review),'backup-change-summary'));
  if(!review.hasChanges){box.append(create('p','所比较的两个资料库内容相同。','backup-muted'));return box;}
  if(review.person.length){box.append(create('h3','个人信息'));for(const change of review.person)box.append(changeDetail(change,beforeLabel,afterLabel,undefined,undefined,before,after));}
  if(review.photo.action!=='unchanged'){
    box.append(create('h3','个人照片：'+({added:'新增',removed:'移除',modified:'修改'}[review.photo.action])));
    const previews=create('div',undefined,'backup-change-grid');previews.append(photoContents(before.person?.photo,beforeLabel),photoContents(after.person?.photo,afterLabel));box.append(previews);
    for(const change of review.photo.changes)box.append(changeDetail(change,beforeLabel,afterLabel));
  }
  if(review.entries.added.length||review.entries.modified.length||review.entries.removed.length||review.entries.reordered){box.append(create('h3','经历'));for(const item of review.entries.added)box.append(entryChange(item,'新增','is-added',after));for(const item of review.entries.removed)box.append(entryChange(item,'移除','is-removed',before));
    for(const item of review.entries.modified){const group=create('details',undefined,'backup-change-item is-modified');group.open=true;group.append(create('summary',`修改经历：${item.title}（${item.changes.length} 项）`));const old=before.entries?.find(entry=>entry.id===item.id),next=after.entries?.find(entry=>entry.id===item.id);for(const change of item.changes)group.append(changeDetail(change,beforeLabel,afterLabel,old,next,before,after));group.dataset.loaded='true';box.append(group);}if(review.entries.reordered)box.append(create('p','经历排列顺序将发生变化。','backup-muted'));}
  if(review.attachments.added.length||review.attachments.modified.length||review.attachments.removed.length){box.append(create('h3','补充文件'));for(const item of review.attachments.added)box.append(create('p',`新增文件：${item.name} · ${fileSize(item.size)}`,'backup-file-change is-added'));for(const item of review.attachments.removed)box.append(create('p',`移除文件：${item.name} · ${fileSize(item.size)}`,'backup-file-change is-removed'));for(const item of review.attachments.modified){const group=create('details',undefined,'backup-change-item is-modified');group.open=true;group.append(create('summary',`修改文件：${item.name}`));for(const change of item.changes)group.append(changeDetail(change,beforeLabel,afterLabel));box.append(group);}}
  return box;
}
// The ordinary library restore is a write transaction too. Keep its modal and
// starting form identity stable from flush through the native response.
function lockLibraryRestore(ctx, root) {
  const dialog=root.closest('dialog'),close=document.querySelector('#close-modal');
  const backgrounds=[...document.querySelectorAll('.rail,.workspace,#screen')].map(node=>[node,node.inert,node.getAttribute('aria-busy')]);
  const controls=[...root.querySelectorAll('button,input,textarea,select'),...(close?[close]:[])].map(node=>[node,node.disabled]);
  const wasSaving=ctx.ui.librarySaving;let released=false;
  const block=event=>{event.preventDefault();event.stopImmediatePropagation();};
  const key=event=>{if(event.key==='Escape'||((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'))block(event);};
  const reopen=()=>{if(!released&&!dialog.open)dialog.showModal();};
  ctx.ui.libraryRestoreBusy=true;ctx.ui.librarySaving=true;
  for(const[node]of backgrounds){node.inert=true;node.setAttribute('aria-busy','true');}
  for(const[node]of controls)node.disabled=true;
  dialog?.addEventListener('cancel',block,true);dialog?.addEventListener('close',reopen);
  dialog?.addEventListener('keydown',key,true);close?.addEventListener('click',block,true);
  ctx.setLibraryRestoreBusy?.(true);
  return ()=>{
    if(released)return;released=true;
    dialog?.removeEventListener('cancel',block,true);dialog?.removeEventListener('close',reopen);
    dialog?.removeEventListener('keydown',key,true);close?.removeEventListener('click',block,true);
    for(const[node,disabled]of controls)if(node.isConnected)node.disabled=disabled;
    for(const[node,inert,aria]of backgrounds)if(node.isConnected){node.inert=inert;if(aria===null)node.removeAttribute('aria-busy');else node.setAttribute('aria-busy',aria);}
    ctx.ui.librarySaving=wasSaving;ctx.ui.libraryRestoreBusy=false;
    ctx.setLibraryRestoreBusy?.(false);
  };
}
export function showLibraryBackups(ctx){
  ctx.modal('资料库备份','先查看内容与变化，再选择恢复。最近保留 5 个版本。备份可恢复个人照片和附件引用，无法修复已丢失的外部附件实体。','<div class="backup-preview-shell"><nav class="backup-version-list" aria-label="资料库备份版本"></nav><section class="backup-preview-detail" aria-live="polite"></section></div>',root=>{
    const backups=[...ctx.state.backups].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));const list=root.querySelector('.backup-version-list'),detail=root.querySelector('.backup-preview-detail');
    if(!backups.length){detail.append(create('p','第一次修改并保存资料后，这里会保留修改前的版本。','backup-empty'));return;}
    let selected=0,language=ctx.ui.libraryLanguage||'zh',comparison='current',restoring=false;
    function selectVersion(index){selected=index;comparison='current';render();}
    backups.forEach((backup,index)=>{const button=create('button',undefined,'backup-version-option');button.type='button';button.dataset.backupVersion=backup.id;button.append(create('strong',backup.label||'资料库备份'),create('time',date(backup.createdAt)),create('small',`${backup.library.entries?.length||0} 段经历 · ${backup.library.attachments?.length||0} 个文件`));button.onclick=()=>selectVersion(index);list.append(button);});
    function warning(){if(ctx.ui.dirtyLibrary)return create('p','当前有未保存的编辑。以下比较基于已保存资料，恢复时会放弃未保存的内容。','backup-dirty-warning');return null;}
    function render(){
      for(const[ index,button]of[...list.children].entries()){button.classList.toggle('selected',index===selected);button.setAttribute('aria-current',index===selected?'true':'false');}
      detail.replaceChildren();const backup=backups[selected],heading=create('div',undefined,'backup-preview-heading');heading.append(create('h2',backup.label||'资料库备份'),create('p',date(backup.createdAt)));detail.append(heading);const dirty=warning();if(dirty)detail.append(dirty);
      const tabs=create('div',undefined,'backup-preview-tabs');for(const[tab,label]of[['contents','查看内容'],['changes','查看变化']]){const button=create('button',label);button.type='button';button.dataset.backupTab=tab;button.onclick=()=>{contents.hidden=tab!=='contents';changes.hidden=tab!=='changes';[...tabs.children].forEach(item=>item.setAttribute('aria-pressed',String(item===button)));};button.setAttribute('aria-pressed',String(tab==='contents'));tabs.append(button);}detail.append(tabs);
      const contents=create('div',undefined,'backup-content-view'),languageButtons=create('div',undefined,'backup-language-switch');for(const lang of['zh','en']){const button=create('button',labels[lang]);button.type='button';button.dataset.backupLanguage=lang;button.setAttribute('aria-pressed',String(language===lang));button.onclick=()=>{language=lang;render();};languageButtons.append(button);}contents.append(languageButtons,libraryContents(backup.library,language));detail.append(contents);
      const changes=create('div',undefined,'backup-diff-view');changes.hidden=true;const label=create('label',undefined,'backup-compare-picker');label.append(create('span','比较范围'));const select=create('select');select.dataset.backupCompare='';select.append(new Option('与当前已保存资料比较','current'));if(backups[selected+1])select.append(new Option('与更早的相邻版本比较','adjacent'));select.value=comparison;
      const changeContents=create('div');function compare(){const before=comparison==='adjacent'?backups[selected+1].library:ctx.state.library;changeContents.replaceChildren(renderChanges(reviewLibraryChanges(before,backup.library),before,backup.library,{beforeLabel:comparison==='adjacent'?'更早的相邻版本':'当前资料'}));}select.onchange=()=>{comparison=select.value;compare();};label.append(select);changes.append(label,create('p','变化方向：比较版本 → 所选备份。','backup-muted'),changeContents);compare();detail.append(changes);
      const footer=create('div',undefined,'backup-preview-actions'),restore=create('button','查看恢复影响','button primary');restore.type='button';restore.dataset.backupRestorePreview=backup.id;restore.onclick=()=>showRestore(backup);footer.append(create('p','恢复资料库会保留当前已保存版本为备份，可恢复个人照片和附件引用；无法修复已丢失的外部附件实体。已有简历、PDF 和历史记录不变。'),restore);detail.append(footer);
    }
    function showRestore(backup){
      detail.replaceChildren();const current=ctx.state.library,review=reviewLibraryChanges(current,backup.library);detail.append(create('h2','恢复前确认'),create('p',`将恢复到 ${date(backup.createdAt)} 的“${backup.label||'资料库备份'}”。`,'backup-muted'));const dirty=warning();if(dirty)detail.append(dirty);detail.append(create('p','以下是当前已保存资料恢复到所选版本时的完整变更。修改前后内容已展开，可折叠暂时不看的字段。','backup-restore-intro'),renderChanges(review,current,backup.library));
      const actions=create('div',undefined,'backup-preview-actions'),back=create('button','返回预览','button secondary'),confirmButton=create('button','确认恢复此版本','button primary');back.type=confirmButton.type='button';back.dataset.backupRestoreBack='';confirmButton.dataset.backupRestoreConfirm=backup.id;back.onclick=render;confirmButton.onclick=async()=>{
        if(restoring||ctx.ui.libraryRestoreBusy||ctx.ui.librarySaving)return;
        if(ctx.ui.dirtyLibrary&&!confirm('当前资料有未保存的修改。恢复备份会放弃这些修改，是否继续？'))return;
        const latest=ctx.state.backups.find(item=>item.id===backup.id);if(!latest){ctx.notify('所选备份已变化，请重新打开备份列表。',true);return;}
        const finalReview=reviewLibraryChanges(ctx.state.library,latest.library);
        if(!confirm(`恢复所选资料库版本？\n${summaryText(finalReview)}。\n当前已保存资料会先形成一个备份；已有简历和 PDF 保持原样。`))return;
        const draftId=`${ctx.ui.librarySelection||'person'}:${ctx.ui.libraryLanguage||'zh'}`;
        restoring=true;const unlock=lockLibraryRestore(ctx,root);
        const status=create('p','正在恢复资料库，请等待完成。当前窗口和资料编辑暂时锁定。','backup-dirty-warning');status.setAttribute('role','status');status.dataset.libraryRestoreStatus='';actions.before(status);
        try{
          await ctx.flush();const restored=await window.resume.restoreBackup(backup.id);
          ctx.merge(restored);clearLibraryDraft(ctx,draftId);ctx.ui.dirtyLibrary=false;ctx.ui.librarySelection='person';
          // closeModal is guarded by the shared app-level restore state.
          unlock();ctx.closeModal();ctx.render();ctx.notify('资料库已恢复，简历和 PDF 保持原样');
        }catch(error){status.textContent='恢复未完成，原资料和未提交草稿保留。可以重试或关闭后继续编辑。';ctx.notify(error.message,true);}
        finally{unlock();restoring=false;}
      };actions.append(back,confirmButton);detail.append(actions);
    }
    render();
  });
}
