// Native file choices stay in the main process; renderer only receives a short-lived token.
export function registerFullBackupIPC({handle,dialog,getWindow,getStore,isBusy=()=>false,onRestoreState=()=>{},beforeRestore=async()=>{},getLicenseStatus=async()=>null,getBackupLicenseStatus=async()=>null,afterRestore=async()=>{},freeEdition=false}) {
  if(typeof freeEdition!=='boolean')throw new Error('免费版选项无效。');
  let preview=null;
  const ready=()=>{if(isBusy())throw new Error('请先结束正在进行的导出或AI请求，再操作完整备份。');};
  handle('createFullBackup',async()=>{
    ready();const choice=await dialog.showSaveDialog(getWindow(),{title:'保存完整本地备份',defaultPath:'ITS-ME-资料库-'+new Date().toISOString().replace(/[:.]/gu,'-')+'.itsme-backup',filters:[{name:'ITS ME 完整备份',extensions:['itsme-backup']} ]});
    if(choice.canceled||!choice.filePath)return{canceled:true};ready();
    const result=await getStore().createFullBackup(choice.filePath);const {libraryAuthorization,...publicResult}=result;return{canceled:false,...publicResult,...(!freeEdition?{license:await getBackupLicenseStatus(libraryAuthorization)}:{})};
  });
  handle('inspectFullBackup',async()=>{
    ready();preview=null;const choice=await dialog.showOpenDialog(getWindow(),{title:'检查完整本地备份',properties:['openFile'],filters:[{name:'ITS ME 完整备份',extensions:['itsme-backup']}]});
    if(choice.canceled||!choice.filePaths?.length)return{canceled:true};ready();
    const filePath=choice.filePaths[0],result=await getStore().inspectFullBackup(filePath);preview={filePath,token:result.token};const {libraryAuthorization,...publicResult}=result;return{canceled:false,...publicResult,...(!freeEdition?{license:await getBackupLicenseStatus(libraryAuthorization)}:{})};
  });
  handle('restoreFullBackup',async input=>{
    ready();if(!input||typeof input.token!=='string'||input.token.length>200||!preview||input.token!==preview.token)throw new Error('备份预检已失效，请重新选择并检查备份。');
    const checked=preview;preview=null;
    onRestoreState(true);
    try { await beforeRestore(); const result=await getStore().restoreFullBackup(checked.filePath,checked.token);
      await afterRestore();
      return{state:result.state,rescueFileName:result.rescueFileName,counts:result.counts,...(result.damagedIdentityFileName?{damagedIdentityFileName:result.damagedIdentityFileName}:{}),...(!freeEdition?{license:await getLicenseStatus()}:{})};
    } finally {onRestoreState(false);}
  });
}