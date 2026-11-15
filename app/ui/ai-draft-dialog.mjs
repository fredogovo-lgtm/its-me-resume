// A local-draft guard shared by optional AI dialogs. It never overrides ctx.closeModal.
export function prepareAiDraftDialog(ctx){ctx.ui||={};const active=ctx.ui.aiDraftSession;if(!active)return true;if(!active.persist())return false;active.dispose();return true;}
export function installAiDraftDialog(ctx,dialog,{persist=()=>true,busy=()=>false,onError=message=>ctx.notify?.(message,true),onClose=()=>{}}={}){
 ctx.ui||={};let disposed=false;
 const attempt=()=>{if(disposed)return true;if(busy()){onError('正在处理本次操作，请稍候再关闭或退出。');return false;}try{if(persist())return true;}catch{}onError('草稿暂未能写入本机，请保留此窗口，重试保存或复制文字后明确放弃。');return false;};
 const dispose=()=>{if(disposed)return;disposed=true;dialog.removeEventListener('cancel',cancel,true);dialog.removeEventListener('close',closed);document.querySelector('#close-modal')?.removeEventListener('click',x,true);if(ctx.ui.aiDraftSession===guard)delete ctx.ui.aiDraftSession;};
 const close=({discard=false}={})=>{if(busy()){onError('正在处理本次操作，请稍候。');return false;}if(!discard&&!attempt())return false;dispose();onClose();ctx.closeModal();return true;};
 function x(event){event.preventDefault();event.stopImmediatePropagation();close();}
 function cancel(event){event.preventDefault();event.stopImmediatePropagation();close();}
 function closed(){if(disposed||dialog.open)return;if(!attempt()){dialog.showModal();return;}dispose();onClose();}
 const guard={persist:attempt,dispose,close,get busy(){return busy();},get isSaving(){return busy();}};
 dialog.addEventListener('cancel',cancel,true);dialog.addEventListener('close',closed);document.querySelector('#close-modal')?.addEventListener('click',x,true);ctx.ui.aiDraftSession=guard;return guard;
}
