import {createSubmissionProject,readingBlocks,readingText,moveReadingBlock,pruneReadingOrder} from '../core/submission.mjs';
import {findFittingTextRanges,splitBlock} from '../core/split-block.mjs';
import {getTextRuns,sliceTextRuns} from '../core/rich-text.mjs';
import {pageChrome} from '../core/document-style.mjs';
import {validateProject} from '../core/model.mjs';
import {renderResume} from './resume-view.mjs';
import {escape} from './helpers.mjs';
const textBlock=block=>!['photo','shape','line'].includes(block.kind);
const dialogOpen=root=>Boolean(root.isConnected&&root.closest('dialog')?.open);
function replaceBlock(project,id,pieces){const next=structuredClone(project),index=next.blocks.findIndex(block=>block.id===id);if(index<0)throw Error('需要拆分的文字已不存在。');next.blocks.splice(index,1,...pieces);const order=next.readingOrderByLanguage?.[next.language];if(order)next.readingOrderByLanguage[next.language]=order.flatMap(value=>value===id?pieces.map(part=>part.id):[value]);pruneReadingOrder(next);return next;}
/** Use the same renderer and split engine as manual pagination, before saving any new project. */
export async function prepareSubmissionProject(source,options={}){
 let project=createSubmissionProject(source,options);const language=project.language,staging=document.createElement('div');staging.style.cssText='position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none';document.body.append(staging);
 const current=()=>{if(options.isCurrent&&!options.isCurrent())throw Error('源简历或窗口已变化，本次未建立副本。请重新打开制作。');};
 try{
  await document.fonts?.ready;current();let measures=0;
  const ids=readingBlocks(project).map(block=>block.id);
  for(const [step,id]of ids.entries()){
   current();options.onProgress?.('正在检查文字 '+(step+1)+' / '+ids.length+'…');
   const sourceBlock=project.blocks.find(block=>block.id===id),layout=renderResume(staging,project);
   if(!(layout.issueBlockIds||[]).includes(id))continue;
   if(!sourceBlock[language].body)throw Error('“'+(sourceBlock[language].title||'文字模块')+'”的标题或补充说明过长，无法安全放入单页。请先缩短或拆成正文后重试。');
   const block=structuredClone(sourceBlock),probe=structuredClone(project),first=[...new Intl.Segmenter(language,{granularity:'grapheme'}).segment(block[language].body)][0]?.segment||'',probeBlock=probe.blocks.find(item=>item.id===id);
   probeBlock[language].body=first;if(probeBlock.richText?.[language]?.body)probeBlock.richText[language].body=sliceTextRuns(getTextRuns(block,language,'body'),0,first.length);
   const initial=renderResume(staging,probe).positions[id],starts=[],prefix='submission-probe-'+crypto.randomUUID(),bottom=project.paper.height-pageChrome(project).bottom;
   const ranges=await findFittingTextRanges(block[language].body,async(_text,meta)=>{
    if(++measures%6===0)await new Promise(requestAnimationFrame);current();starts[meta.index]=meta.start;
    const prefixBlock=structuredClone(block);prefixBlock[language].body=block[language].body.slice(0,meta.end);if(prefixBlock.richText?.[language]?.body)prefixBlock.richText[language].body=sliceTextRuns(getTextRuns(block,language,'body'),0,meta.end);
    const ranges=starts.slice(0,meta.index+1).map((start,index)=>({start,end:index===meta.index?meta.end:starts[index+1]}));let sequence=0;
    const pieces=splitBlock(prefixBlock,language,ranges,{idFactory:()=>prefix+'-'+(++sequence)});for(const part of pieces.slice(1))delete part.links;
    const candidate=replaceBlock(project,id,pieces),result=renderResume(staging,candidate),pieceIds=new Set(pieces.map(piece=>piece.id));
    if(result.issueBlockIds.some(value=>pieceIds.has(value))||result.positions[id]?.page>initial.page)return false;
    return pieces.every(piece=>{const frame=result.positions[piece.id];return frame&&frame.x>=0&&frame.x+frame.width<=project.paper.width+.1&&frame.y>=15.9&&frame.y+frame.height<=bottom-.6;});
   });
   const pieces=splitBlock(block,language,ranges);for(const part of pieces.slice(1))delete part.links;
   if(project.blocks.length+pieces.length-1>500)throw Error('简洁副本需要超过500个文本框，请先精简长正文。');
   project=replaceBlock(project,id,pieces);
  }
  current();const result=renderResume(staging,project);if(result.warnings.length)throw Error('简洁副本未通过实际排版检查：'+result.warnings.slice(0,2).join(' ')+' 原稿保持不变。');validateProject(project);return{project,layout:result};
 }finally{staging.remove();}
}
export function openSubmissionCopy(ctx){
 if(!ctx.project)return;const sourceId=ctx.project.id,snapshot=JSON.stringify(ctx.project),language=ctx.project.language;
 ctx.modal('建立简洁投递版','从当前实际文字新建独立单栏简历。保留局部改写、日期和完整链接，去除照片及装饰；原设计稿保留。',
 '<form data-submission-form><label class="field"><span>新简历名称</span><input name="submissionName" maxlength="500" required value="'+escape((ctx.project.name+' · 简洁投递').slice(0,500))+'"></label><label class="field"><span>纸张</span><select name="submissionPaper"><option value="A4">A4 · 210 × 297 mm</option><option value="source">沿用原纸张</option></select></label><p class="panel-help">按当前'+(language==='en'?'英文':'中文')+'文字顺序制作，长正文会按实际字体分页。另一语言文字继续保留，切换后请核对排版。不会重新从资料库补回已删内容，也不宣称适配所有招聘系统。</p><p data-submission-status role="status"></p><div class="modal-actions"><button type="button" class="button secondary" data-submission-cancel>取消</button><button type="submit" class="button primary" data-submission-create>检查并建立副本</button></div></form>',root=>{
  const form=root.querySelector('form'),status=root.querySelector('[data-submission-status]'),create=root.querySelector('[data-submission-create]');let busy=false;root.querySelector('[data-submission-cancel]').onclick=()=>ctx.closeModal();
  form.onsubmit=async event=>{event.preventDefault();if(busy||!form.reportValidity())return;busy=true;create.disabled=true;form.elements.submissionName.disabled=true;form.elements.submissionPaper.disabled=true;
   try{if(ctx.state.projects.length>=500)throw Error('简历项目已达500份，请先整理。');await ctx.flush();const source=ctx.project;if(source?.id!==sourceId||JSON.stringify(source)!==snapshot)throw Error('源简历已变化，请关闭窗口后重新制作。');
    const isCurrent=()=>dialogOpen(root)&&ctx.project?.id===sourceId&&JSON.stringify(ctx.project)===snapshot;
    const {project}=await prepareSubmissionProject(source,{name:form.elements.submissionName.value,paper:form.elements.submissionPaper.value==='source'?source.paper:undefined,positions:ctx.layoutResult.positions,isCurrent,onProgress:message=>status.textContent=message});
    if(!isCurrent())return;await ctx.addProject(project);ctx.closeModal();ctx.notify('已建立独立简洁投递版，可继续检查文字、排版并导出PDF。');
   }catch(error){if(dialogOpen(root)){status.textContent='副本未建立：'+error.message;status.classList.add('error');}}
   finally{busy=false;if(create.isConnected){create.disabled=false;form.elements.submissionName.disabled=false;form.elements.submissionPaper.disabled=false;}}
  };
 });
}
export function openReadingOrder(ctx){
 if(!ctx.project)return;const projectId=ctx.project.id,language=ctx.project.language;
 ctx.modal('文字阅读顺序与PDF核对','按当前语言逐页核对。顺序调整不移动文本框、不改变图层；跨页仍按PDF页码阅读。',
 '<div data-reading-dialog><p class="panel-help">同页可上移或下移文字顺序。纸面位置与模板排版保持原样。请用“实际PDF文字核对”确认阅读器实际提取结果；本地清单只是编辑参考。</p><p class="panel-help" data-reading-layer-warning hidden></p><button type="button" class="button quiet" data-reading-simple-copy>改用独立简洁投递版</button><div data-reading-list></div><details><summary>本地文字清单 · 完整网址另列</summary><textarea data-reading-local-text readonly rows="9" aria-label="本地文字清单" style="width:100%"></textarea></details><div class="button-group" style="margin:12px 0"><button type="button" class="button secondary" data-reading-extract>实际PDF文字核对</button><button type="button" class="button quiet" data-reading-reset>恢复默认文字顺序</button></div><p data-reading-status role="status"></p><div data-reading-pdf-result hidden><h3>实际PDF抽取 · 不写入导出历史</h3><textarea data-reading-pdf-text readonly rows="12" aria-label="实际PDF抽取文字" style="width:100%"></textarea></div></div>',root=>{
  const list=root.querySelector('[data-reading-list]'),status=root.querySelector('[data-reading-status]'),pdfResult=root.querySelector('[data-reading-pdf-result]'),pdfText=root.querySelector('[data-reading-pdf-text]'),extract=root.querySelector('[data-reading-extract]');let busy=false;
  const current=()=>ctx.project?.id===projectId&&ctx.project?.language===language;
  const refresh=()=>{if(!current()){list.textContent='简历或语言已切换，请关闭后重新打开。';return;}const project=ctx.project,positions=ctx.layoutResult.positions,blocks=readingBlocks(project,language,{positions}),pageOf=block=>positions[block.id]?.page??block.page;
   const layers=new Set(blocks.map(block=>block.layer??2)),layerWarning=root.querySelector('[data-reading-layer-warning]');layerWarning.hidden=layers.size<=1;layerWarning.textContent='当前文字使用了不同图层。PDF可能按图层绘制顺序抽取；这里的同页顺序不能覆盖显式图层。请实际核对PDF，或建立统一图层的简洁投递版。';
   list.innerHTML=blocks.map((block,index)=>{const text=block[language],page=pageOf(block),previous=blocks[index-1],next=blocks[index+1];return'<article data-reading-row="'+escape(block.id)+'" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #e6e8ed"><span style="min-width:58px;font-size:12px;color:#687587">第 '+(page+1)+' 页</span><span style="flex:1;min-width:0"><strong>'+escape(text.title||text.subtitle||'未命名文字')+'</strong><small style="display:block;color:#687587">'+escape((text.body||text.subtitle||'').slice(0,100))+'</small></span><button type="button" class="button quiet" data-reading-locate="'+escape(block.id)+'">定位</button><button type="button" class="button quiet" aria-label="上移'+escape(text.title||'文字')+'" data-reading-up="'+escape(block.id)+'" '+(!previous||pageOf(previous)!==page?'disabled':'')+'>上移</button><button type="button" class="button quiet" aria-label="下移'+escape(text.title||'文字')+'" data-reading-down="'+escape(block.id)+'" '+(!next||pageOf(next)!==page?'disabled':'')+'>下移</button></article>';}).join('')||'<p>当前语言没有文字模块。</p>';
   root.querySelector('[data-reading-local-text]').value=readingText(project,language,{positions});
   for(const [selector,direction]of [['[data-reading-up]',-1],['[data-reading-down]',1]])list.querySelectorAll(selector).forEach(control=>control.onclick=()=>{if(busy)return;try{const id=direction<0?control.dataset.readingUp:control.dataset.readingDown;const changed=moveReadingBlock(ctx.project,id,direction,{positions:ctx.layoutResult.positions});ctx.updateProject(next=>Object.assign(next,changed));pdfResult.hidden=true;status.textContent='同页文字对象顺序已保存。不同图层仍可能影响PDF提取，请重新核对实际PDF文字。';refresh();}catch(error){status.textContent=error.message;}});
   list.querySelectorAll('[data-reading-locate]').forEach(control=>control.onclick=()=>{if(busy)return;ctx.closeModal();ctx.ui.selectedBlockId=control.dataset.readingLocate;ctx.ui.editorTab='content';ctx.render();requestAnimationFrame(()=>document.querySelector('#resume-pages [data-block-id="'+control.dataset.readingLocate+'"]')?.scrollIntoView({block:'center',inline:'nearest'}));});
  };
  root.querySelector('[data-reading-reset]').onclick=()=>{if(busy||!current())return;ctx.updateProject(next=>{if(next.readingOrderByLanguage)delete next.readingOrderByLanguage[language];});pdfResult.hidden=true;status.textContent='已恢复默认文字顺序，纸面位置保持不变。';refresh();};
  root.querySelector('[data-reading-simple-copy]').onclick=()=>{if(busy)return;ctx.closeModal();openSubmissionCopy(ctx);};
  extract.disabled=typeof window.resume?.previewPdfText!=='function';if(extract.disabled)status.textContent='此运行版本暂不支持实际PDF文字提取，请使用新版安装包。';
  extract.onclick=async()=>{if(busy||!current())return;busy=true;extract.disabled=true;list.inert=true;root.querySelector('[data-reading-reset]').disabled=true;pdfResult.hidden=true;status.textContent='正在本机生成PDF并抽取文字，不新增导出历史…';
   try{await ctx.flush();const snapshot=JSON.stringify(ctx.project),result=await window.resume.previewPdfText(structuredClone(ctx.project));if(!dialogOpen(root))return;if(!current()||JSON.stringify(ctx.project)!==snapshot)throw Error('简历已变化，请重新核对。');if(!Array.isArray(result?.pages)||typeof result.text!=='string'||result.pages.some(page=>!Number.isInteger(page.page)||typeof page.text!=='string'))throw Error('PDF文字提取结果无效。');pdfText.value=result.pages.map(page=>'第 '+page.page+' 页\n'+page.text).join('\n\n');pdfResult.hidden=false;status.textContent='已抽取 '+result.pages.length+' 页文字。请检查顺序、缺漏和乱码；这不代表招聘系统兼容性认证。';}
   catch(error){if(dialogOpen(root))status.textContent='PDF文字核对未能完成：'+error.message;}
   finally{busy=false;if(extract.isConnected){extract.disabled=false;list.inert=false;root.querySelector('[data-reading-reset]').disabled=false;}}
  };
  refresh();
 });
}
export function mountSubmissionTools(ctx,host){if(!host||!ctx.project)return;const panel=document.createElement('div');panel.className='left-actions';panel.innerHTML='<button type="button" class="button quiet" data-submission-copy>建立简洁投递版</button><button type="button" class="button quiet" data-reading-order>文字阅读顺序 / PDF核对</button>';host.append(panel);panel.querySelector('[data-submission-copy]').onclick=()=>openSubmissionCopy(ctx);panel.querySelector('[data-reading-order]').onclick=()=>openReadingOrder(ctx);}
