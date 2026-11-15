import {userMessage} from './user-message.mjs';
// Native directory choice and all filesystem operations belong to the main process.
export async function mountDataLocation(ctx,host) {
  if(!host)return;
  host.innerHTML='<p class="muted" data-data-location-path role="status">正在读取资料位置…</p><div class="button-group"><button type="button" class="button secondary" data-change-data-location disabled>更改资料目录</button><button type="button" class="button secondary" data-retry-data-location-cleanup disabled hidden>重试清理旧资料</button></div><div data-data-location-cleanup hidden><p data-data-location-cleanup-notice role="status"></p><p class="muted" data-data-location-cleanup-path></p></div><p class="muted" data-data-location-feedback role="status"></p>';
  const path=host.querySelector('[data-data-location-path]'),feedback=host.querySelector('[data-data-location-feedback]'),change=host.querySelector('[data-change-data-location]'),retry=host.querySelector('[data-retry-data-location-cleanup]'),cleanupHost=host.querySelector('[data-data-location-cleanup]'),cleanupNotice=host.querySelector('[data-data-location-cleanup-notice]'),cleanupPath=host.querySelector('[data-data-location-cleanup-path]');
  if(typeof window.resume.dataLocationStatus!=='function'||typeof window.resume.changeDataDirectory!=='function'){path.textContent='当前版本尚不支持更改资料目录。';return;}
  let busy=false,canChange=false,canRetry=false;
  const updateControls=()=>{change.disabled=busy||!canChange;retry.hidden=!canRetry;retry.disabled=busy||!canRetry;};
  const setFeedback=(message,error=false)=>{feedback.textContent=message;feedback.classList.toggle('error',error);};
  const refresh=async()=>{
    const status=await window.resume.dataLocationStatus(),cleanup=status.cleanup;
    path.textContent='当前资料目录：'+status.dataDirectory;
    path.style.overflowWrap='anywhere';
    canChange=Boolean(status.canChange);
    canRetry=Boolean(cleanup?.canRetry)&&typeof window.resume.retryDataLocationCleanup==='function';
    cleanupHost.hidden=!cleanup||cleanup.state==='none';
    cleanupNotice.textContent=cleanup?.notice||'';
    cleanupNotice.classList.toggle('error',cleanup?.state==='blocked');
    cleanupPath.textContent=typeof cleanup?.sourceDirectory==='string'&&cleanup.sourceDirectory?'旧资料位置：'+cleanup.sourceDirectory:'';
    cleanupPath.style.overflowWrap='anywhere';
    updateControls();
    setFeedback(status.isOverride?'当前使用测试启动参数。请从普通快捷方式打开软件后更改资料位置。':'选择一个新的空文件夹。资料、照片、简历、附件、历史 PDF 会迁移并校验；新目录成功打开后，自动清理已迁移的旧资料副本。本机设置、AI Key、规则、未提交草稿和其它文件保留原位。迁移失败不清理，异常清理可按提示重试。');
    return status;
  };
  change.onclick=async()=>{
    if(busy||!canChange)return;busy=true;updateControls();let handoff=false;
    ctx.setSoftwareUpdateBusy?.(true);
    setFeedback('请按弹窗选择空文件夹。复制期间请保持目标磁盘连接。');
    try {
      const result=await window.resume.changeDataDirectory();handoff=Boolean(result?.handoff);
      if(!handoff)await refresh();
      setFeedback(result?.restartRequired?'新资料目录已保存，请关闭并重新打开 ITS ME。新目录成功打开后会清理已迁移的旧资料，本机设置和其它文件保留。':handoff?'资料已校验，正在从新目录重新打开。成功打开后会清理已迁移的旧资料，本机设置和其它文件保留。仅此次会话使用的 AI Key 需要重新填写。':'已取消更改，继续使用原资料目录。');
    } catch(error) {try{await refresh();}catch{}setFeedback(userMessage(error),true);}
    finally {busy=false;if(!handoff){ctx.setSoftwareUpdateBusy?.(false);updateControls();}}
  };
  retry.onclick=async()=>{
    if(busy||!canRetry)return;busy=true;updateControls();ctx.setSoftwareUpdateBusy?.(true);
    setFeedback('正在检查并清理已迁移的旧资料，请稍候…');
    try {
      const result=await window.resume.retryDataLocationCleanup(),status=await refresh(),cleanup=status.cleanup||result;
      setFeedback(cleanup?.notice||(cleanup?.state==='complete'?'已清理迁移的旧资料，本机设置和其它文件保留。':'已检查旧资料清理状态，请核对上方说明。'),cleanup?.state==='blocked');
    } catch(error) {try{await refresh();}catch{}setFeedback(userMessage(error),true);}
    finally {busy=false;ctx.setSoftwareUpdateBusy?.(false);updateControls();}
  };
  try {await refresh();}catch(error){canChange=false;canRetry=false;updateControls();path.textContent='资料位置未能读取，请重新打开设置。';setFeedback(userMessage(error),true);}
}
