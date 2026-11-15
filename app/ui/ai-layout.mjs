import { renderResume } from './resume-view.mjs';
import { paginateSelectedBlock } from './pagination.mjs';
const text = value => String(value || '');
const number = value => Number.isFinite(Number(value))?Math.round(Number(value)*100)/100:0;
const visible = project => (project?.blocks||[]).filter(block=>!block.hiddenLanguages?.includes(project.language));
const genericName = block => ({profile:'基本信息',entry:({work:'工作经历',project:'项目经历',education:'教育背景',skills:'技能',certificate:'证书',other:'其他经历'})[block.category]||'经历',photo:'照片占位',line:'线条',shape:'装饰',text:'文字模块'})[block.kind]||'模块';
function hash(value){let code=2166136261;for(let i=0;i<value.length;i++){code^=value.charCodeAt(i);code=Math.imul(code,16777619);}return (code>>>0).toString(16).padStart(8,'0')+'-'+value.length;}
function signature(ctx){const project=ctx.project;if(!project)return '';return 'layout-v1:'+hash(JSON.stringify({id:project.id,language:project.language,paper:project.paper,mode:project.mode,template:project.template,fontFamily:project.fontFamily,fontSize:project.fontSize,accent:project.accent,groupSections:project.groupSections,sectionTitles:project.sectionTitles,blocks:visible(project).map(block=>({id:block.id,kind:block.kind,category:block.category,page:block.page,x:block.x,y:block.y,width:block.width,height:block.height,fixedHeight:block.fixedHeight,locked:block.locked,fontFamily:block.fontFamily,fontSize:block.fontSize,fontWeight:block.fontWeight,fontStyle:block.fontStyle,lineHeight:block.lineHeight,textAlign:block.textAlign,richText:block.richText?.[project.language],text:block[project.language],period:block.period,periodByLanguage:block.periodByLanguage})),positions:ctx.layoutResult?.positions}));}
function localIssues(ctx){
  const blocks=visible(ctx.project),ids=new Set(blocks.map(block=>block.id)),result=ctx.layoutResult||{},issues=[];
  for(const block of blocks)if(!['line','shape','photo'].includes(block.kind)&&!['title','subtitle','body'].some(field=>text(block[ctx.project.language]?.[field]).trim()))issues.push({type:'empty',message:genericName(block)+'没有可见文字。',blockIds:[block.id]});
  for(const [index,message]of (result.warnings||[]).entries()){const id=result.issueBlockIds?.[index];issues.push({type:/宽度/.test(message)?'horizontal-overflow':/高度|高于一页/.test(message)?'vertical-overflow':/超出.*页/.test(message)?'outside-paper':'layout-warning',message:text(message),blockIds:ids.has(id)?[id]:[]});}
  for(const issue of result.overlaps||[])issues.push({type:'overlap',message:text(issue.message)||'模块可见内容重叠。',blockIds:(issue.blockIds||[]).filter(id=>ids.has(id))});
  return issues;
}
export function buildAiLayoutContext(ctx){
  const project=ctx.project;if(!project)throw new Error('请先打开一份简历。');
  const issues=localIssues(ctx),result=ctx.layoutResult||{},lines=[`本机版面测量；无截图，不判断视觉审美。纸张 ${number(project.paper.width)} × ${number(project.paper.height)} mm；语言 ${project.language}；页数 ${number(result.pages)||1}；模式 ${project.mode}。`];
  for(const block of visible(project)){
    const frame=result.positions?.[block.id]||block;
    const line=`模块 ${text(block.id).slice(0,200)}（${genericName(block)}）；第 ${number(frame.page)+1} 页；位置 ${number(frame.x)},${number(frame.y)} mm；尺寸 ${number(frame.width)} × ${number(frame.height)} mm；字体 ${text(block.fontFamily||project.fontFamily).slice(0,120)}；字号 ${number(block.fontSize||project.fontSize)} pt；行距 ${number(block.lineHeight)||1.65}；${block.locked?'已锁定':'未锁定'}。`;
    if(lines.join('\n').length+line.length>14500){lines.push('模块摘要超过发送上限，其余模块未发送。');break;}lines.push(line);
  }
  lines.push('本机检查：'+(issues.length?issues.slice(0,100).map(issue=>`${issue.type} [${issue.blockIds.join(',')}]`).join('；'):'未发现已知问题。'));
  return {summary:lines.join('\n').slice(0,16000),signature:signature(ctx),issues};
}
export function isAiLayoutContextCurrent(ctx,value){return Boolean(value&&value===signature(ctx));}
export function locateAiLayoutBlock(ctx,id){
  if(!visible(ctx.project).some(block=>block.id===id))return false;
  ctx.closeModal?.();ctx.ui.selectedBlockId=id;ctx.ui.screen='editor';ctx.render();
  const element=[...document.querySelectorAll('#resume-pages [data-block-id]')].find(element=>element.dataset.blockId===id);element?.scrollIntoView({block:'center',inline:'nearest'});return true;
}
export function openAiLayoutCheck(ctx,{onGenerate}={}){
  if(!ctx.project)return ctx.notify?.('请先打开一份简历。');
  document.activeElement?.blur();
  const host=document.createElement('div');host.style.cssText='position:fixed;left:-10000px;top:0;visibility:hidden';document.body.append(host);
  try{ctx.layoutResult=renderResume(host,ctx.project);}finally{host.remove();}
  const context=buildAiLayoutContext(ctx);
  ctx.modal('检查版式','本机测量无需 Key。AI 建议仅解释尺寸与检测结果，不会直接修改坐标。','<div data-local-layout-list></div><div class="modal-actions"><button class="button secondary" data-layout-close>关闭</button><button class="button primary" data-layout-generate>再获取 AI 建议</button></div>',root=>{
    const list=root.querySelector('[data-local-layout-list]');
    const status=document.createElement('p');status.textContent=context.issues.length?`本机发现 ${context.issues.length} 项，请逐项查看。`:'本机未发现已知的空模块、溢出或遮挡。';list.append(status);
    for(const issue of context.issues){const row=document.createElement('div');row.className='inspector-section';const message=document.createElement('p');message.textContent=issue.message;row.append(message);
      for(const id of issue.blockIds){const block=ctx.project.blocks.find(item=>item.id===id);const locate=document.createElement('button');locate.className='button quiet';locate.textContent='定位 '+genericName(block);locate.onclick=()=>locateAiLayoutBlock(ctx,id);row.append(locate);
        if(block&&!['photo','line','shape'].includes(block.kind)){if(block.fixedHeight){const auto=document.createElement('button');auto.className='button quiet';auto.textContent='自动高度';auto.disabled=Boolean(block.locked);auto.onclick=()=>{if(!isAiLayoutContextCurrent(ctx,context.signature))return ctx.notify('版面已变化，请重新检查。',true);ctx.closeModal();ctx.updateProject(next=>{next.blocks.find(item=>item.id===id).fixedHeight=false;});};row.append(auto);}
          const split=document.createElement('button');split.className='button quiet';split.textContent='按页拆分';split.disabled=Boolean(block.locked);split.onclick=()=>{if(!isAiLayoutContextCurrent(ctx,context.signature))return ctx.notify('版面已变化，请重新检查。',true);ctx.closeModal();ctx.ui.selectedBlockId=id;paginateSelectedBlock(ctx);};row.append(split);}}
      list.append(row);}
    root.querySelector('[data-layout-close]').onclick=()=>ctx.closeModal();
    const generate=root.querySelector('[data-layout-generate]');generate.disabled=typeof onGenerate!=='function';generate.onclick=()=>{if(!isAiLayoutContextCurrent(ctx,context.signature))return ctx.notify('版面已变化，请重新检查。',true);ctx.closeModal();onGenerate({summary:context.summary,signature:context.signature});};
  });return context;
}