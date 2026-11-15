import {canvasGroupFor,canvasSelectionIds,preserveCanvasOtherLayout,ungroupAndDuplicateCanvasSelection} from '../core/canvas-groups.mjs';
import {freezeMeasuredLayout} from './language-layout.mjs';

function measuredCandidate(project,id,positions){
 const next=structuredClone(project);preserveCanvasOtherLayout(next);
 if(next.mode==='flow')freezeMeasuredLayout(next,positions);
 else for(const member of canvasSelectionIds(next,id)){
  const block=next.blocks.find(item=>item.id===member),frame=positions[member];
  if(frame)for(const key of ['x','y','width','height','page'])if(frame[key]!==undefined)block[key]=frame[key];
 }
 return ungroupAndDuplicateCanvasSelection(next,id);
}

/** Returns true only when this copy action belongs to cross-page recovery. */
export function offerCrossPageCanvasCopy(ctx,id){
 const project=ctx.project,group=project&&canvasGroupFor(project,id);if(!group)return false;
 const positions=ctx.layoutResult?.positions||{},members=group.blockIds;
 const frameSignature=()=>JSON.stringify(members.map(member=>ctx.layoutResult?.positions?.[member]||ctx.project?.blocks.find(block=>block.id===member)));
 if(new Set(members.map(member=>positions[member]?.page??project.blocks.find(block=>block.id===member)?.page)).size<2)return false;
 try{measuredCandidate(project,id,positions);}catch(error){ctx.notify(error.message,true);return true;}
 const projectId=project.id,language=project.language,snapshot=JSON.stringify(project),layoutSnapshot=frameSignature();
 ctx.modal('处理跨页组合','模板排版或纸张变化后，这个组合的成员已位于不同页面。',
  '<p class="panel-help">解除当前语言的整个组合，只复制当前选中的模块；其余成员保留原位。副本仅在当前语言显示，另一语言内容与组合保持保留。整个操作可以一次撤销。</p><p data-cross-page-copy-status role="status"></p><div class="modal-actions"><button type="button" class="button secondary" data-cross-page-copy-cancel>返回，保留组合</button><button type="button" class="button primary" data-cross-page-copy-confirm>解组并复制此模块</button></div>',root=>{
   const status=root.querySelector('[data-cross-page-copy-status]');
   root.querySelector('[data-cross-page-copy-cancel]').onclick=()=>ctx.closeModal();
   root.querySelector('[data-cross-page-copy-confirm]').onclick=()=>{
    try{
     if(ctx.project?.id!==projectId||ctx.project.language!==language||JSON.stringify(ctx.project)!==snapshot||frameSignature()!==layoutSnapshot)throw Error('简历或排版已经变化，请返回后重新选择模块。');
     let copiedId;
     ctx.updateProject(next=>{const changed=measuredCandidate(next,id,ctx.layoutResult.positions);copiedId=changed.blocks.at(-1).id;Object.assign(next,changed);ctx.ui.selectedBlockId=copiedId;});
     if(!copiedId||!ctx.project.blocks.some(block=>block.id===copiedId))throw Error('本次操作未保存，请检查资料是否可写后重试。');
     ctx.closeModal();ctx.notify('已解除当前语言组合并复制所选模块，可一次撤销。');
    }catch(error){if(root.isConnected){status.textContent=error.message;status.classList.add('error');}}
   };
  });
 return true;
}
