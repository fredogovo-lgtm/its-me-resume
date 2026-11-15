import {renderResume} from './resume-view.mjs';
import {applyLanguageLayout} from './language-layout.mjs';
import {escape} from './helpers.mjs';
const labels={zh:'中文',en:'英文'},pxMm=96/25.4;
const variant=(source,language)=>applyLanguageLayout(structuredClone(source),language);
function globalImpact(before,after){
 const changes=[];
 if(JSON.stringify(before.paper)!==JSON.stringify(after.paper))changes.push(`纸张 ${before.paper.width} × ${before.paper.height} → ${after.paper.width} × ${after.paper.height} mm`);
 if(before.fontFamily!==after.fontFamily)changes.push(`字体 ${before.fontFamily} → ${after.fontFamily}`);
 if(before.fontSize!==after.fontSize)changes.push(`全局字号 ${before.fontSize} → ${after.fontSize} pt`);
 if(before.accent!==after.accent)changes.push('主题颜色改变');
 if(JSON.stringify(before.documentStyle||{})!==JSON.stringify(after.documentStyle||{}))changes.push('行距、章节间距或页眉页码设置改变');
 if(before.template!==after.template)changes.push('起始版式改变');
 return changes.length?changes.join('；'):'纸张、全局字体与字号保持。模块样式和装饰按模板更新。';
}
/** Actual renderer, isolated copies. No saving, no mutation and no network. */
export function renderPersonalTemplateImpact(host,before,after,{previews=true}={}){
 host.innerHTML='<p class="personal-template-scope" data-template-global-impact><strong>此模板的全局设置会影响中文、英文两版。</strong><br>'+escape(globalImpact(before,after))+'<br>当前语言采用模板框位；另一语言保留文字和已存框位，但共享设置可能使它重新分页或溢出。</p><div data-template-language-checks></div>';
 const staging=document.createElement('div');staging.style.cssText='position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none';document.body.append(staging);const checks={};
 try{for(const language of ['zh','en']){
  const previous=variant(before,language),candidate=variant(after,language),previousLayout=renderResume(staging,previous),afterHost=document.createElement('div');staging.append(afterHost);const result=renderResume(afterHost,candidate);
  const warnings=[...new Set(result.warnings)],overlaps=result.overlaps?.length||0;checks[language]={beforePages:previousLayout.pages,pages:result.pages,warnings,overlaps};
  const section=document.createElement('section');section.dataset.templateLanguage=language;section.className='personal-template-impact-language';
  section.innerHTML='<strong>'+labels[language]+'版'+(language===after.language?' · 当前':'')+'</strong><p>'+previousLayout.pages+' → '+result.pages+' 页 · '+(warnings.length?'有 '+warnings.length+' 处溢出或越界，需调整后导出': '未发现文字溢出或越界')+(overlaps?'；有 '+overlaps+' 处遮挡待核对':'')+'</p>'+(warnings.length?'<details><summary>查看排版提示</summary><ul>'+warnings.map(message=>'<li>'+escape(message)+'</li>').join('')+'</ul></details>':'');
  host.querySelector('[data-template-language-checks]').append(section);
  if(previews){const details=document.createElement('details');details.innerHTML='<summary>预览'+labels[language]+'版全部页面</summary><div class="personal-template-impact-pages"></div>';section.append(details);const area=details.querySelector('div'),scale=.3;afterHost.style.cssText=`width:${candidate.paper.width*pxMm}px;transform:scale(${scale});transform-origin:top left`;area.style.cssText=`position:relative;overflow:hidden;width:${candidate.paper.width*pxMm*scale}px;height:${result.pages*(candidate.paper.height*pxMm+34)*scale}px`;area.append(afterHost);}
 }
 }finally{staging.remove();}
 host.dataset.templateImpactReady='';return{checks,needsAcknowledgement:Object.values(checks).some(check=>check.warnings.length||check.overlaps)};
}
export function confirmPersonalTemplateImpact(ctx,before,after,{name='个人模板',isCurrent=()=>true}={}){
 return new Promise(resolve=>{let settled=false;const finish=value=>{if(settled)return;settled=true;resolve(value);};
  ctx.modal('应用个人模板 · '+name,'先核对两版的实际排版。文字、照片和附件保留，当前装饰与模块样式按模板更新，应用后可一次撤销。','<div class="personal-template-dialog"><div data-personal-template-impact></div><label class="check-row" data-template-impact-ack-row hidden><input type="checkbox" data-template-impact-ack>我已查看排版提示，应用后继续调整再导出</label><p data-template-impact-status role="status"></p><div class="modal-actions"><button type="button" class="button secondary" data-cancel-personal-template>取消</button><button type="button" class="button primary" data-confirm-personal-template disabled>应用此模板</button></div></div>',root=>{
   const confirm=root.querySelector('[data-confirm-personal-template]'),ack=root.querySelector('[data-template-impact-ack]'),status=root.querySelector('[data-template-impact-status]');
   root.closest('dialog')?.addEventListener('close',()=>finish(false),{once:true});root.querySelector('[data-cancel-personal-template]').onclick=()=>{finish(false);ctx.closeModal();};
   try{const review=renderPersonalTemplateImpact(root.querySelector('[data-personal-template-impact]'),before,after);root.querySelector('[data-template-impact-ack-row]').hidden=!review.needsAcknowledgement;confirm.disabled=review.needsAcknowledgement;ack.onchange=()=>confirm.disabled=review.needsAcknowledgement&&!ack.checked;
    confirm.onclick=()=>{if(confirm.disabled)return;if(!isCurrent()){status.textContent='简历、所选资料或模板已改变，请取消后重新预览。';confirm.disabled=true;return;}finish(true);ctx.closeModal();};
   }catch(error){status.textContent='模板未应用：'+error.message;}
  });
 });
}
