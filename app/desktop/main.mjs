import {acquireLibrarySession} from './library-session.mjs';
import {extractResumeText} from './resume-import.mjs';
import {OfflineUpdateService,startUpdateHelper} from './offline-update.mjs';
import { app, BrowserWindow, Menu, dialog, ipcMain, session, shell, safeStorage, clipboard } from 'electron';
import { mkdir, rename, rm, writeFile, readFile, lstat } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { LocalStore } from './store.mjs';
import {readDataLocation,inspectDataLocationTarget,migrateDataLocation,readDataLocationCleanupStatus,finalizeDataLocationCleanup} from './data-location.mjs';
import {DataLocationService} from './data-location-service.mjs';
import {requestStartupDataRecovery} from './startup-recovery.mjs';
import { AiVault } from './ai-vault.mjs';
import { AiService } from './ai-service.mjs';
import { AiRulesStore } from './ai-rules-store.mjs';
import { makeAppInfo } from './app-info.mjs';
import { registerFullBackupIPC } from './full-backup-ipc.mjs';
import { validateProject } from '../core/model.mjs';
import { findProjectContentIssues } from '../core/content-check.mjs';
import { ATTACHMENT_EXTENSIONS, MAX_ATTACHMENT_BYTES, attachmentExtension } from '../core/attachments.mjs';

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const uiDirectory = path.join(appDirectory, 'app', 'ui');
const indexURL = pathToFileURL(path.join(uiDirectory, 'index.html')).href;
const printURL = pathToFileURL(path.join(uiDirectory, 'print.html')).href;
const allowedFileRoots = [uiDirectory, path.join(appDirectory, 'app', 'core')].map(directory => pathToFileURL(directory + path.sep).href);
app.setName('ITS ME');
const dataArgument = process.argv.find(argument => argument.startsWith('--data-dir='));
let storageLocation, dataDirectory, runtimeDirectory;
const pendingOperations=new Map();
let dataLocation,openingAfterMigration=false;
let libraryDataReady=false;
let dataCleanupStatus={state:'none',sourceDirectory:'',remainingFiles:0,notice:'',canRetry:false};
let mainWindow;
let store;
let aiVault, aiService, aiRulesStore, offlineUpdates, librarySession;
let librarySessionLost=false;
let importingResume=false;
let exporting = false;
let restoringData = false;
let closing = false;
let allowClose = false;
let startupError;
let ownsInstance = false;
try {
  storageLocation=readDataLocation({appDataDirectory:app.getPath('appData'),override:dataArgument?.slice('--data-dir='.length),freeEdition:true});
  dataDirectory=storageLocation.dataDirectory;
  runtimeDirectory=storageLocation.runtimeDirectory;
  const profileDirectory=runtimeDirectory;
  mkdirSync(profileDirectory, { recursive: true });
  app.setPath('userData', profileDirectory);
  app.setPath('sessionData', profileDirectory);
  ownsInstance = app.requestSingleInstanceLock();
} catch (error) { startupError = error; }
if (!ownsInstance && !startupError) app.quit();
app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed() || openingAfterMigration) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function secureSession(targetSession) {
  targetSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  targetSession.setPermissionCheckHandler(() => false);
  targetSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = allowedFileRoots.some(root => details.url.startsWith(root)) || details.url.startsWith('data:') || details.url.startsWith('devtools:');
    callback({ cancel: !allowed });
  });
  targetSession.on('will-download', event => event.preventDefault());
}

function secureWindow(window, expectedURL) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== expectedURL) event.preventDefault();
  });
  window.webContents.on('will-redirect', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
}

function assertTrusted(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame || event.senderFrame.url !== indexURL) {
    throw new Error('此窗口无权访问本机资料。');
  }
}

function limitedID(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 120) throw new Error('记录编号无效。');
  return value;
}

function handle(name, callback) {
  ipcMain.handle(`resume:${name}`, async (event, ...args) => {
    assertTrusted(event);
    const requireAvailable=()=>{
      if(librarySessionLost)throw Error('资料库独占保护已中断，请关闭并重新打开软件；原资料保留。');
      if(dataLocation&&!dataLocation.allows(name))throw Error('正在更改资料目录，请等待完成后再操作。');
      if(restoringData && !["appInfo","aiStatus","aiRulesStatus","load","aiCancel"].includes(name))throw Error('资料恢复正在进行，请等待完成后再编辑资料。');
      if(offlineUpdates?.status().busy&&!['softwareUpdateStatus','appInfo','aiStatus','aiRulesStatus','load','aiCancel','saveProject','saveLibrary','aiRulesConfigure'].includes(name))throw Error('正在准备软件更新，请稍候。');
    };
    requireAvailable();
    // Track callbacks before their first await, while preserving restore, update and session guards.
    // A save that began before the freeze must finish before the copy starts.
    const operation=Promise.resolve().then(async()=>{
      requireAvailable();
      return callback(...args);
    });
    pendingOperations.set(operation,name);
    try{return await operation;}finally{pendingOperations.delete(operation);}
  });
}

async function readCleanupStatus() {
  try { return await readDataLocationCleanupStatus({location:storageLocation}); }
  catch { return {state:'blocked',sourceDirectory:'',remainingFiles:0,notice:'旧资料清理清单无法核验，未删除旧资料。请保留原件并重新打开软件核对。',canRetry:false}; }
}
async function cleanupOldData() {
  const pending=await readCleanupStatus();
  if(pending.state==='none')return dataCleanupStatus=pending;
  if(!libraryDataReady)return dataCleanupStatus={...pending,state:'blocked',notice:'资料库尚未成功读取，旧资料副本保留；恢复资料后再核对。',canRetry:false};
  try { return dataCleanupStatus=await finalizeDataLocationCleanup({location:storageLocation,installDirectory:app.isPackaged?path.dirname(process.execPath):appDirectory,targetSession:librarySession,freeEdition:true}); }
  catch { return dataCleanupStatus={...pending,state:'blocked',notice:'旧资料暂未清理完成，未处理的副本已保留，请在设置重试。',canRetry:true}; }
}

function registerIPC() {
  registerFullBackupIPC({handle,dialog,getWindow:()=>mainWindow,getStore:()=>store,freeEdition:true,isBusy:()=>exporting||aiService.busy||restoringData||Boolean(offlineUpdates?.status().busy),onRestoreState:value=>restoringData=value,beforeRestore:async()=>{await Promise.allSettled([...pendingOperations].filter(([,name])=>name!=='restoreFullBackup').map(([operation])=>operation));},afterRestore:async()=>{await store.load();libraryDataReady=true;}});
  handle('appInfo', () => makeAppInfo(app.getVersion(),storageLocation.draftScopeDirectory));
  handle('dataLocationStatus',()=>dataLocation.status());
  handle('changeDataDirectory',()=>dataLocation.change());
  handle('retryDataLocationCleanup',()=>dataLocation.retryCleanup());
  handle('importResumeText',async()=>{if(importingResume||exporting||restoringData||aiService.busy)throw Error('正在执行其它操作，请稍后导入。');importingResume=true;try{const chosen=await dialog.showOpenDialog(mainWindow,{title:'从已有简历提取文字',properties:['openFile'],filters:[{name:'可提取文字的简历',extensions:['txt','docx','pdf']}]});if(chosen.canceled||!chosen.filePaths[0])return{cancelled:true};return{cancelled:false,...await extractResumeText(chosen.filePaths[0])};}finally{importingResume=false;}});
  handle('previewPdfText',project=>previewPdfText(project));

  handle('softwareUpdateStatus',()=>({...offlineUpdates.status(),customDataDirectory:Boolean(dataArgument)}));
  handle('installOfflineUpdate',()=>offlineUpdates.install());
  handle('copySupportInfo',()=>{clipboard.writeText('ITS ME '+app.getVersion()+'\n系统：Windows '+process.getSystemVersion()+' / '+process.arch+'\n更新方式：离线安装包');return{copied:true};});
  handle('openUpdateFolder',async()=>{const folder=path.join(runtimeDirectory,'updates');const info=await lstat(folder).catch(()=>null);if(!info?.isDirectory()||info.isSymbolicLink())throw Error('还没有可打开的更新备份目录。');const error=await shell.openPath(folder);if(error)throw Error('更新备份目录未能打开。');return{opened:true};});
  handle('aiStatus', () => aiVault.status());
  handle('aiConfigure', input => {if(aiService.busy)throw new Error('请先取消正在进行的AI请求，再修改设置。');return aiVault.configure(input);});
  handle('aiRulesStatus', () => aiRulesStore.status());
  handle('aiRulesConfigure', input => {if(aiService.busy)throw new Error('请先取消正在进行的AI请求，再修改规则设置。');return aiRulesStore.configure(input);});
  handle('aiGenerate', input => aiService.generate(input));
  handle('aiCancel', id => aiService.cancel(limitedID(id)));
  handle('load', () => store.load());
  handle('saveLibrary', library => store.saveLibrary(library));
  handle('savePersonalTemplates', templates => store.savePersonalTemplates(templates));
  handle('saveProject', project => store.saveProject(project));
  handle('setActiveProject', id => store.setActiveProject(id === null ? null : limitedID(id)));
  handle('deleteProject', id => store.deleteProject(limitedID(id)));
  handle('restoreBackup', async id => {
    const backupId=limitedID(id);
    if(exporting||restoringData||importingResume||aiService.busy||offlineUpdates?.status().busy)throw Error('请先结束其它操作，再恢复资料库。');
    restoringData=true;
    try{return await store.restoreBackup(backupId);}finally{restoringData=false;}
  });
  handle('reopenExport', id => store.reopenExport(limitedID(id)));
  handle('importAttachments', async () => {
    const choice = await dialog.showOpenDialog(mainWindow, {
      title: '添加补充文件', buttonLabel: '添加', properties: ['openFile', 'multiSelections'],
      filters: [{ name: '补充文件', extensions: [...ATTACHMENT_EXTENSIONS] }],
    });
    if (choice.canceled || !choice.filePaths.length) return { cancelled: true };
    const incoming = [];
    for (const filePath of choice.filePaths) {
      const name = path.basename(filePath);
      attachmentExtension(name);
      const info = await lstat(filePath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_ATTACHMENT_BYTES) throw new Error('请选择不超过100MB的普通附件文件。');
      incoming.push({ name, bytes: await readFile(filePath) });
    }
    return { cancelled: false, state: await store.addAttachments(incoming) };
  });
  handle('removeAttachment', id => store.removeAttachment(limitedID(id)));
  handle('openAttachment', async id => {
    const filePath = await store.getAttachmentViewPath(limitedID(id));
    const error = await shell.openPath(filePath);
    if (error) throw new Error('无法打开附件：' + error);
    return true;
  });
  handle('exportPDF', project => exportPDF(project));
  handle('openPDF', async id => {
    const pdfPath = await store.getExportPath(limitedID(id));
    const error = await shell.openPath(pdfPath);
    if (error) throw new Error(`无法打开PDF：${error}`);
    return true;
  });
  handle('openDataFolder', async () => {
    await mkdir(dataDirectory, { recursive: true });
    const error = await shell.openPath(dataDirectory);
    if (error) throw new Error(`无法打开资料目录：${error}`);
    return true;
  });
}

function safeFileName(value) {
  const cleaned = String(value || '我的简历').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100);
  return cleaned || '我的简历';
}

async function saveExternalPDF(filePath, bytes) {
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, bytes, { flag: 'wx' });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function assertReadableProject(){
 if(librarySessionLost)throw Error('资料库保护已中断，请重新打开软件。');
}
async function previewPdfText(project){
 validateProject(project);await assertReadableProject(project);if(exporting||restoringData)throw Error('已有导出或恢复正在进行。');exporting=true;let window,file;
 try{const printSession=session.fromPartition('resume-inspect-'+randomUUID());secureSession(printSession);window=new BrowserWindow({show:false,webPreferences:{session:printSession,nodeIntegration:false,contextIsolation:true,sandbox:true,webviewTag:false,webSecurity:true,backgroundThrottling:false}});secureWindow(window,printURL);await window.loadURL(printURL);const result=await window.webContents.executeJavaScript('window.renderPrint('+JSON.stringify(project)+')');if(!result||!Number.isInteger(result.pages)||result.warnings?.length)throw Error('请先处理纸面越界或文字溢出，再检查PDF文字。');const bytes=await window.webContents.printToPDF({preferCSSPageSize:true,printBackground:true,margins:{top:0,bottom:0,left:0,right:0},displayHeaderFooter:false,generateTaggedPDF:true});await assertReadableProject();const directory=path.join(runtimeDirectory,'pdf-inspection');await mkdir(directory,{recursive:true});file=path.join(directory,randomUUID()+'.pdf');await writeFile(file,bytes,{flag:'wx'});const extracted=await extractResumeText(file);await assertReadableProject();return{text:extracted.text,pages:extracted.pages||[],warnings:extracted.warnings||[],pageCount:result.pages};}
 finally{if(window&&!window.isDestroyed())window.destroy();if(file)await rm(file,{force:true}).catch(()=>{});exporting=false;}
}

async function exportPDF(project) {
  validateProject(project);
  await assertReadableProject(project);
  if (exporting) throw new Error('已有PDF正在导出，请稍候。');
  exporting = true;
  let printWindow;
  let attachmentDirectory;
  let externalSaved = false;
  let targetParent;
  try {
    const printSession = session.fromPartition(`resume-print-${randomUUID()}`);
    secureSession(printSession);
    printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        session: printSession,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: false,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });
    secureWindow(printWindow, printURL);
    await printWindow.loadURL(printURL);
    const result = await printWindow.webContents.executeJavaScript(`window.renderPrint(${JSON.stringify(project)})`);
    if (!result || !Number.isInteger(result.pages) || result.pages < 1 || !Array.isArray(result.warnings) || !Array.isArray(result.overlaps)) {
      throw new Error('PDF排版未返回有效结果，请重新打开简历后重试。');
    }
    if (result.warnings.length) {
      const warnings = result.warnings.map(item => typeof item === 'string' ? item : item.message || String(item));
      throw new Error(`请先处理排版问题再导出：\n${warnings.join('\n')}`);
    }
    const softIssues = [...findProjectContentIssues(project), ...result.overlaps];
    if (softIssues.length) {
      const detail = softIssues.slice(0, 8).map(issue => String(issue.message).slice(0, 260)).join('\n') + (softIssues.length > 8 ? '\n另有' + (softIssues.length - 8) + '项，请返回预览查看。' : '');
      const decision = await dialog.showMessageBox(mainWindow, {
        type: 'warning', title: '导出前检查',
        message: '有' + softIssues.length + '项内容或遮挡问题需要确认。',
        detail: detail + '\n\n建议返回修改。确认接受当前内容与排版，也可以仍然导出。',
        buttons: ['返回修改', '仍然导出'], defaultId: 0, cancelId: 0, noLink: true,
      });
      if (decision.response !== 1) return { cancelled: true };
    }
    const languageLabel = project.language === 'en' ? '英文' : '中文';
    const choice = await dialog.showSaveDialog(mainWindow, {
      title: '导出简历PDF',
      defaultPath: path.join(app.getPath('documents'), safeFileName(project.name + '-' + languageLabel + '-' + project.paper.name) + '.pdf'),
      buttonLabel: '导出PDF', filters: [{ name: 'PDF 文档', extensions: ['pdf'] }], properties: ['createDirectory'],
    });
    if (choice.canceled || !choice.filePath) return { cancelled: true };
    targetParent = path.dirname(path.resolve(choice.filePath));
    await assertReadableProject();
    attachmentDirectory = await store.copyProjectAttachments(project, choice.filePath);
    const bytes = await printWindow.webContents.printToPDF({
      preferCSSPageSize: true,
      printBackground: true,
      generateTaggedPDF: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      displayHeaderFooter: false,
    });
    await assertReadableProject();
    await saveExternalPDF(choice.filePath, bytes);
    externalSaved = true;
    let state;
    try {
      await assertReadableProject();
      state = await store.commitExport(project, bytes, { pageCount: result.pages });
    } catch (error) {
      throw new Error(`PDF已保存到所选位置，但导出历史保存失败，请保留该PDF并重试。${error.message ? ` ${error.message}` : ''}`);
    }
    return { cancelled: false, state, filePath: choice.filePath, ...(attachmentDirectory ? { attachmentDirectory } : {}) };
  } finally {
    if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
    if (!externalSaved && attachmentDirectory && path.dirname(path.resolve(attachmentDirectory)) === targetParent) {
      await rm(attachmentDirectory, { recursive: true, force: true }).catch(() => {});
    }
    exporting = false;
  }
}

async function createMainWindow({showWhenReady=true}={}) {
  const mainSession = session.fromPartition('persist:resume-main');
  secureSession(mainSession);
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: 'ITS ME · 离线简历',
    icon:path.join(appDirectory,'app/assets/itsme.png'),
    backgroundColor: '#edf1f3',
    show: false,
    webPreferences: {
      session: mainSession,
      preload: path.join(appDirectory, 'app', 'desktop', 'preload.cjs'),
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
    },
  });
  secureWindow(mainWindow, indexURL);
  mainWindow.on('closed',()=>aiService.cancelAll());
  mainWindow.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame)aiService.cancelAll();});
  mainWindow.once('ready-to-show', () => {if(showWhenReady)mainWindow.show();});
  mainWindow.on('close', event => {
    if (allowClose) return;
    event.preventDefault();
    if (closing || exporting || restoringData || offlineUpdates?.status().busy || dataLocation?.busy) return;
    closing = true;
    mainWindow.webContents.executeJavaScript(`typeof window.flushResumeChanges === 'function' ? window.flushResumeChanges() : true`)
      .then(async result => {
        if (result === false) return;
        await mainWindow.webContents.session.flushStorageData();
        allowClose = true;
        mainWindow.close();
      })
      .catch(async error => {
        await dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: '尚未关闭',
          message: '修改尚未保存，窗口已保留。',
          detail: error.message || '请返回界面检查保存状态后重试。',
          buttons: ['返回继续编辑'],
        });
      })
      .finally(() => { closing = false; });
  });
  await mainWindow.loadURL(indexURL);
}

app.whenReady().then(async () => {
  if (startupError) {
    const recovery=dataArgument?{handled:false}:await requestStartupDataRecovery({error:startupError,
      appDataDirectory:app.getPath('appData'),installDirectory:app.isPackaged?path.dirname(process.execPath):appDirectory,dialog,
      claimRuntime:async directory=>{
        if(ownsInstance){app.releaseSingleInstanceLock();ownsInstance=false;}
        // Lock the verified original profile only; no session/Store is initialized here.
        app.setPath('userData',directory);ownsInstance=app.requestSingleInstanceLock();return ownsInstance;
      }});
    if(recovery.handled){
      if(recovery.recovered){
        try {app.relaunch();}
        catch {await dialog.showMessageBox({type:'info',title:'资料库已重新连接',message:'位置记录已修复，请重新打开 ITS ME。',detail:'原资料保留，本次没有创建空库。',buttons:['关闭'],noLink:true});}
      }
      app.exit(recovery.recovered||recovery.alreadyRunning?0:1);return;
    }
    throw startupError;
  }
  if (!ownsInstance) return;
  Menu.setApplicationMenu(null);
  await mkdir(dataDirectory, { recursive: true });
  librarySession=await acquireLibrarySession({directory:dataDirectory,onLost:()=>{librarySessionLost=true;app.exit(1);}});
  store = new LocalStore(dataDirectory,{freeEdition:true});
  await store.load();
  libraryDataReady=true;
  aiVault = new AiVault(runtimeDirectory, safeStorage);
  aiRulesStore = new AiRulesStore(runtimeDirectory, {isBusy:()=>Boolean(aiService?.busy),getSecret:()=>aiVault.getSecret()});
  aiService = new AiService(aiVault,{rulesStore:aiRulesStore});
  offlineUpdates=new OfflineUpdateService({version:app.getVersion(),dataDir:dataDirectory,runtimeDirectory,
    isBusy:()=>exporting||restoringData||importingResume||aiService.busy||closing||Boolean(dataLocation?.busy),
    chooseFile:async()=>{const choice=await dialog.showOpenDialog(mainWindow,{title:'选择新版 ITS ME 安装包',properties:['openFile'],filters:[{name:'ITS ME Windows安装包',extensions:['exe']}]});return choice.canceled?null:choice.filePaths[0];},
    confirm:async info=>(await dialog.showMessageBox(mainWindow,{type:'question',title:'安装新版 ITS ME',message:'从 '+info.currentVersion+' 更新到 '+info.version,detail:'即将运行你选择的 '+info.fileName+'。请确认安装包来自软件作者。此内测包尚未做发布者签名认证。'+(dataArgument?'\n此窗口使用自定义资料目录，更新后请沿用原启动参数打开。':'')+'\n处理当前修改后，会先备份资料、退出软件，再打开安装程序。',buttons:['确认安装','取消'],defaultId:1,cancelId:1,noLink:true})).response===0,
    prepareToQuit:()=>mainWindow.webContents.executeJavaScript('window.flushResumeChanges()'),
    createBackup:file=>store.createFullBackup(file),startHelper:startUpdateHelper,
    resumeEditing:()=>mainWindow?.webContents.executeJavaScript('window.setResumeUpdateBusy?.(false)').catch(()=>{}),
    quit:async()=>{await mainWindow.webContents.session.flushStorageData();allowClose=true;setImmediate(()=>mainWindow?.close());},
  });
  dataCleanupStatus=await readCleanupStatus();
  dataLocation=new DataLocationService({
    location:storageLocation,cleanupStatus:()=>dataCleanupStatus,cleanup:cleanupOldData,
    isBusy:()=>exporting||restoringData||importingResume||aiService.busy||closing||offlineUpdates.status().busy||[...pendingOperations.values()].some(name=>!['changeDataDirectory','retryDataLocationCleanup','appInfo','dataLocationStatus','softwareUpdateStatus','aiStatus','aiRulesStatus'].includes(name)),
    choose:async()=>{const choice=await dialog.showOpenDialog(mainWindow,{title:'选择新的空资料文件夹',buttonLabel:'使用此文件夹',properties:['openDirectory','createDirectory','dontAddToRecent']});return choice.canceled?null:choice.filePaths[0];},
    inspect:targetDirectory=>inspectDataLocationTarget({location:storageLocation,targetDirectory,installDirectory:app.isPackaged?path.dirname(process.execPath):appDirectory}),
    confirm:async targetDirectory=>(await dialog.showMessageBox(mainWindow,{type:'question',title:'更改资料目录',message:'迁移资料并在新目录成功打开后清理旧副本？',detail:'新位置：'+targetDirectory+'\n\n资料、照片、简历、附件、资料库备份、历史 PDF 将复制并校验。新目录成功打开后，自动清理旧处已迁移的受管副本；AI 设置、未提交草稿和用户另放文件仍保留在原位置。文件被占用或发生变化时保留并可在设置重试清理。仅本次会话使用的 API Key 重启后需重新填写。',buttons:['取消','保存并迁移'],defaultId:0,cancelId:0,noLink:true})).response===1,
    prepare:()=>mainWindow.webContents.executeJavaScript('window.flushResumeChanges()'),
    drain:async()=>{await Promise.all([...pendingOperations].filter(([,name])=>!['changeDataDirectory','retryDataLocationCleanup','appInfo','dataLocationStatus','softwareUpdateStatus','aiStatus','aiRulesStatus'].includes(name)).map(([operation])=>operation));await store.load();},
    flush:()=>mainWindow.webContents.session.flushStorageData(),
    migrate:targetDirectory=>migrateDataLocation({location:storageLocation,targetDirectory,installDirectory:app.isPackaged?path.dirname(process.execPath):appDirectory,cleanupSource:true,freeEdition:true}),
    restart:()=>{app.relaunch();allowClose=true;setImmediate(()=>mainWindow?.close());},
    requireRestart:async()=>{await dialog.showMessageBox(mainWindow,{type:'warning',title:'请重新打开 ITS ME',message:'新资料目录已保存，但自动重启未完成。',detail:'原资料完整保留。为避免在两个位置分别编辑，请关闭软件后从普通快捷方式重新打开。',buttons:['关闭软件'],noLink:true});allowClose=true;setImmediate(()=>mainWindow?.close());},
    resumeEditing:()=>mainWindow?.webContents.executeJavaScript('window.setResumeUpdateBusy?.(false)').catch(()=>{}),
  });
  registerIPC();
  if(dataCleanupStatus.canRetry) {
    openingAfterMigration=true;
    try { await dataLocation.startupCleanup(()=>createMainWindow({showWhenReady:false})); }
    finally { openingAfterMigration=false; }
    mainWindow.show();
  } else await createMainWindow();
}).catch(error => {
  dialog.showErrorBox('ITS ME无法启动', error.message || '请检查应用文件与本机资料目录。');
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', event => event.preventDefault());
});



app.on('will-quit',()=>{void librarySession?.release();});
