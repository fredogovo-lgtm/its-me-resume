// Explicit offline updates. Local file choice is owned by the main process.
// Checksums detect changed/corrupt files, not publisher identity; unsigned beta
// installers still require the user's explicit trusted-source confirmation.
import path from 'node:path';
import {readInstallerVersion} from './installer-version.mjs';
import {constants} from 'node:fs';
import {open,lstat,mkdir,mkdtemp,copyFile,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const MAX_INSTALLER_BYTES=1024*1024*1024;
const parseVersion=value=>{if(typeof value!=='string'||!/^\d{1,9}\.\d{1,9}\.\d{1,9}$/u.test(value)||value.split('.').some(p=>p.length>1&&p[0]==='0'))throw Error('更新版本格式无效。');return value.split('.').map(Number);};
const newer=(next,current)=>{const a=parseVersion(next),b=parseVersion(current);for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];return false;};
const digest=async file=>{const hash=createHash('sha256'),stream=file.createReadStream({start:0,autoClose:false});for await(const chunk of stream)hash.update(chunk);return hash.digest('hex');};
export async function inspectOfflineInstaller(filePath,currentVersion){
 if(typeof filePath!=='string'||!path.isAbsolute(filePath))throw Error('请选择本机的更新安装包。');
 const name=path.basename(filePath),match=/^ITS-ME-(\d{1,9}\.\d{1,9}\.\d{1,9})-Setup\.exe$/iu.exec(name);
 if(!match)throw Error('安装包名称应为 ITS-ME-版本-Setup.exe，请选择作者提供的完整安装包。');
 parseVersion(currentVersion);parseVersion(match[1]);
 let file;try{
  const info=await lstat(filePath,{bigint:true});if(!info.isFile()||info.isSymbolicLink()||info.size<1024n||info.size>BigInt(MAX_INSTALLER_BYTES))throw Error('更新安装包不是有效的普通文件，或大小不在支持范围。');
  file=await open(filePath,'r');const before=await file.stat({bigint:true});
  const same=(a,b)=>['ino','dev','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
  if(!same(before,info))throw Error('安装包已变化，请重新选择。');
  const actual=await readInstallerVersion(file,Number(before.size));
  if(actual.version!==match[1])throw Error('安装包内部版本与文件名不一致，请重新获取原始安装包，不要改名。');
  if(!newer(actual.version,currentVersion))throw Error('请选择比当前版本更新的安装包；同版重装可直接运行安装程序。');
  const sha256=await digest(file),after=await file.stat({bigint:true}),current=await lstat(filePath,{bigint:true});
  if(!current.isFile()||current.isSymbolicLink()||!same(before,after)||!same(after,current))throw Error('安装包读取期间发生变化，请重新选择。');
  return{filePath,name,version:actual.version,sha256,size:Number(after.size)};
 }finally{await file?.close();}
}
async function updateDirectory(dataDir,runtimeDirectory){
 let directory=path.resolve(runtimeDirectory||dataDir);for(const next of (runtimeDirectory?['','updates']:['','runtime','updates'])){if(next)directory=path.join(directory,next);try{const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('更新目录存在不受支持的链接或文件，请保留现场并检查。');}catch(e){if(e.code!=='ENOENT')throw e;await mkdir(directory);}}
 return directory;
}
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
export function makeUpdateHelper({parentPid,installerPath,sha256,receiptPath}){
 if(!Number.isSafeInteger(parentPid)||parentPid<1||!path.isAbsolute(installerPath)||!path.isAbsolute(receiptPath)||!/^[a-f0-9]{64}$/u.test(sha256))throw Error('更新辅助信息无效。');
 return `$ErrorActionPreference = 'Stop'\nfunction Save-UpdateReceipt([string]$phase) { [IO.File]::WriteAllText(${quote(receiptPath)}, ('{"phase":"' + $phase + '","stage":"' + $updateStep + '","pid":' + $PID + '}'), [Text.UTF8Encoding]::new($false)) }\n$updateStep = 'wait-for-app'\ntry {\n Save-UpdateReceipt 'waiting'\n $updateParentProcess = $null\n try { $updateParentProcess = [Diagnostics.Process]::GetProcessById(${parentPid}) } catch [ArgumentException] {}\n $updateDeadline = [DateTime]::UtcNow.AddSeconds(45)\n while ($updateParentProcess -and -not $updateParentProcess.WaitForExit(200)) {\n  if (Test-Path -LiteralPath ${quote(path.join(path.dirname(receiptPath),'abort'))}) { Save-UpdateReceipt 'canceled'; exit 0 }\n  if ([DateTime]::UtcNow -ge $updateDeadline) { throw 'Parent still running' }\n }\n if (Test-Path -LiteralPath ${quote(path.join(path.dirname(receiptPath),'abort'))}) { Save-UpdateReceipt 'canceled'; exit 0 }\n $updateStep = 'verify-installer'\n $updateHasher = [Security.Cryptography.SHA256]::Create()\n $updateStream = [IO.File]::OpenRead(${quote(installerPath)})\n try { $updateHash = [BitConverter]::ToString($updateHasher.ComputeHash($updateStream)).Replace('-','').ToLowerInvariant() } finally { $updateStream.Dispose(); $updateHasher.Dispose() }\n if ($updateHash -ne ${quote(sha256)}) { throw 'Installer integrity changed' }\n $updateStep = 'launch-installer'\n Start-Process -FilePath ${quote(installerPath)} -ErrorAction Stop | Out-Null\n Save-UpdateReceipt 'launched'\n} catch {\n $updateStep = $updateStep + ':' + $_.Exception.GetType().Name\n Save-UpdateReceipt 'failed'\n Add-Type -AssemblyName System.Windows.Forms\n [void][Windows.Forms.MessageBox]::Show('更新安装程序未能启动。你的资料和更新前备份已保留，请重新打开 ITS ME，或手动运行从作者处取得的安装包。','ITS ME 更新')\n}\n`;
}
export async function startUpdateHelper({helperPath,receiptPath}){
 const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 // Start-Process owns an independent hidden process. Direct detached WinPS
 // exits before running scripts on this host; an attached child is also liable
 // to be terminated when the Electron parent shuts down.
 const bootstrap='Start-Process -FilePath '+quote(powershell)+' -WindowStyle Hidden -ArgumentList @('+['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File','"'+helperPath+'"'].map(quote).join(',')+') -ErrorAction Stop | Out-Null';
 const child=spawn(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(bootstrap,'utf16le').toString('base64')],{detached:false,windowsHide:true,stdio:'ignore'});
 let failure;child.once('error',error=>failure=error);child.once('exit',code=>{if(code!==0)failure=Error('helper exited');});
 const deadline=Date.now()+10000;
 try{while(Date.now()<deadline){if(failure)throw failure;try{const receipt=JSON.parse((await readFile(receiptPath,'utf8')).replace(/^\uFEFF/u,''));if(receipt.phase==='waiting'){child.unref();return{pid:receipt.pid,async cancel(){await writeFile(path.join(path.dirname(receiptPath),'abort'),'cancelled').catch(()=>{});}};}if(receipt.phase==='failed')throw Error('helper failed');}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}await new Promise(r=>setTimeout(r,60));}throw Error('helper timeout');}
 catch{await writeFile(path.join(path.dirname(receiptPath),'abort'),'cancelled').catch(()=>{});child.kill();throw Error('更新辅助程序未能启动，软件保持打开。请稍后重试或手动安装新版。');}
}
export class OfflineUpdateService{
 #options;#busy=false;#handoff=false;
 constructor(options){this.#options=options;parseVersion(options.version);}
 status(){return{version:this.#options.version,mode:'offline',busy:this.#busy,installerPattern:'ITS-ME-版本-Setup.exe'};}
 async install(){
  const o=this.#options;if(this.#busy||o.isBusy?.())throw Error('正在执行更新、AI、导出或恢复，请先结束后再更新。');this.#busy=true;let prepared=false;
  try{
   const source=await o.chooseFile();if(!source)return{canceled:true};const info=await inspectOfflineInstaller(source,o.version);
   if(!await o.confirm({version:info.version,currentVersion:o.version,fileName:info.name}))return{canceled:true};
   prepared=true;if(!await o.prepareToQuit())return{canceled:true};
   const base=await updateDirectory(o.dataDir,o.runtimeDirectory),job=await mkdtemp(path.join(base,'update-')),staged=path.join(job,info.name);
   await copyFile(source,staged,constants.COPYFILE_EXCL);const copy=await inspectOfflineInstaller(staged,o.version);
   if(copy.sha256!==info.sha256||copy.size!==info.size)throw Error('更新安装包已经变化，校验失败；软件未退出。');
   const backupPath=path.join(job,'before-'+o.version+'-to-'+info.version+'.itsme-backup');
   try{await o.createBackup(backupPath);}catch{throw Error('更新前完整备份未成功，尚未启动更新。请检查可用空间、资料文件或备份大小限制后重试。');}
   const helperPath=path.join(job,'install-update.ps1'),receiptPath=path.join(job,'handoff.json');
   await writeFile(helperPath,'\uFEFF'+makeUpdateHelper({parentPid:process.pid,installerPath:staged,sha256:info.sha256,receiptPath}),{encoding:'utf8',flag:'wx'});
   let helper;try{helper=await o.startHelper({helperPath,receiptPath});}catch{throw Error('更新辅助程序未能启动，备份已保留，软件保持打开。');}
   try{await o.quit();}catch(error){await writeFile(path.join(job,'abort'),'cancelled',{flag:'wx'}).catch(()=>{});await helper?.cancel?.();throw error;}
   this.#handoff=true;return{handoff:true,version:info.version,backupFileName:path.basename(backupPath)};
  }finally{if(!this.#handoff){this.#busy=false;if(prepared)await o.resumeEditing?.();}}
 }
}
