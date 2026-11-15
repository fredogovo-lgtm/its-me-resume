import path from 'node:path';
import {constants as fsConstants,existsSync,lstatSync,realpathSync,openSync,fstatSync,readFileSync,closeSync} from 'node:fs';
import {lstat,realpath,open,readdir,mkdir,rename,unlink,rmdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolveDataDirectory} from './store.mjs';
import {validateState} from '../core/model.mjs';
import {validateAttachmentMetadata} from '../core/attachments.mjs';
import {LIBRARY_LICENSE_FILE,validateLibraryLicenseRecord} from './library-license.mjs';
import {hasRecoverableFullBackupSync} from './full-backup.mjs';
import {acquireLibrarySession,assertLibrarySession} from './library-session.mjs';
import {assertDataLocationCleanupAvailable,prepareDataLocationCleanup,commitDataLocationCleanup,cancelDataLocationCleanup,assertNoMissingMigrationPointer} from './data-location-cleanup.mjs';
export {readDataLocationCleanupStatus,finalizeDataLocationCleanup} from './data-location-cleanup.mjs';

const MiB=1024*1024,STATE_LIMIT=32*MiB,FILE_LIMIT=100*MiB,RESCUE_LIMIT=256*MiB;
const CONFIG_KEYS=['version','dataDirectory','runtimeDirectory','draftScopeDirectory'];
const RESCUE=/^\.rescue-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.itsme-backup$/u;
const IDENTITY_RESCUE=/^\.rescue-library-license-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-([0-9a-f]{64})\.bin$/u;
const migrating=new Set();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
const samePath=(a,b)=>identity(a)===identity(b);
const inside=(value,parent)=>{const relative=path.relative(identity(parent),identity(value));return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const overlaps=(a,b)=>inside(a,b)||inside(b,a);
const problem=(message,options)=>new Error('资料目录迁移：'+message,options);
const sameStat=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
const sameObject=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
function absolute(value){
  if(typeof value!=='string'||!value.trim()||value.length>240||!path.isAbsolute(value)||/^[\\/]{2}/u.test(value)||/[\x00-\x1f\x7f]/u.test(value))throw problem('请选择本机绝对路径；首版不支持网络共享或设备路径。');
  const resolved=path.resolve(value);
  if(process.platform==='win32'&&resolved.slice(path.parse(resolved).root.length).split(path.sep).some(part=>/[. ]$/u.test(part)||/[:*?"<>|]/u.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)))throw problem('目录路径名称无效。');
  return resolved;
}
function maybeStatSync(file){try{return lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function maybeStat(file){try{return await lstat(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function pathParts(directory){const resolved=absolute(directory),root=path.parse(resolved).root,parts=[root];let current=root;for(const part of resolved.slice(root.length).split(path.sep).filter(Boolean)){current=path.join(current,part);parts.push(current);}return parts;}
function safeDirectoryChainSync(directory,{required=false}={}){
  let last=null;
  for(const current of pathParts(directory)){
    const stat=maybeStatSync(current);
    if(!stat){if(required)throw problem('资料目录不存在；未创建空资料库。');return null;}
    if(!stat.isDirectory()||stat.isSymbolicLink()||!samePath(realpathSync(current),current))throw problem('路径含目录链接或不是普通目录。');
    last=stat;
  }
  return last;
}
async function safeDirectoryChain(directory,{required=false}={}){
  let last=null;
  for(const current of pathParts(directory)){
    const stat=await maybeStat(current);
    if(!stat){if(required)throw problem('资料目录不存在。');return null;}
    if(!stat.isDirectory()||stat.isSymbolicLink()||!samePath(await realpath(current),current))throw problem('路径含目录链接或不是普通目录。');
    last=stat;
  }
  return last;
}
function regularBytesSync(file,maximum){
  const before=lstatSync(file);
  if(!before.isFile()||before.isSymbolicLink()||before.size>maximum||!samePath(realpathSync(file),file))throw problem('资料或位置配置文件类型无效。');
  let descriptor;
  try{
    descriptor=openSync(file,fsConstants.O_RDONLY|(fsConstants.O_NOFOLLOW??0));const opened=fstatSync(descriptor);
    if(!sameStat(before,opened))throw problem('资料在读取时发生变化。');
    const bytes=readFileSync(descriptor),after=fstatSync(descriptor),current=lstatSync(file);
    if(bytes.length!==opened.size||!current.isFile()||current.isSymbolicLink()||!sameStat(opened,after)||!sameStat(opened,current)||!samePath(realpathSync(file),file))throw problem('资料在读取时发生变化。');
    return bytes;
  }finally{if(descriptor!==undefined)closeSync(descriptor);}
}
async function regularBytes(file,maximum){
  const before=await lstat(file);
  if(!before.isFile()||before.isSymbolicLink()||before.size>maximum||!samePath(await realpath(file),file))throw problem('文件含链接、不是普通文件或超过单文件上限。');
  let handle;
  try{
    handle=await open(file,fsConstants.O_RDONLY|(fsConstants.O_NOFOLLOW??0));const opened=await handle.stat();
    if(!sameStat(before,opened))throw problem('资料文件在读取时发生变化。');
    const bytes=await handle.readFile(),after=await handle.stat(),current=await lstat(file);
    if(bytes.length!==opened.size||!current.isFile()||current.isSymbolicLink()||!sameStat(opened,after)||!sameStat(opened,current)||!samePath(await realpath(file),file))throw problem('资料文件在读取时发生变化。');
    return {bytes,stat:current};
  }finally{await handle?.close();}
}
function parseState(bytes){try{const state=JSON.parse(bytes.toString('utf8'));validateState(state);return state;}catch{throw problem('state.json资料格式无效，原资料保留。');}}
function locationFor(configPath,configuration,isOverride=false,customDataDirectory=false){return{dataDirectory:configuration.dataDirectory,runtimeDirectory:configuration.runtimeDirectory,draftScopeDirectory:configuration.draftScopeDirectory,configPath,isOverride,customDataDirectory};}
function validateConfiguration(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==CONFIG_KEYS.length||CONFIG_KEYS.some(key=>!Object.hasOwn(value,key))||value.version!==1)throw problem('资料位置配置损坏或版本不支持。');
  const dataDirectory=absolute(value.dataDirectory),runtimeDirectory=absolute(value.runtimeDirectory),draftScopeDirectory=absolute(value.draftScopeDirectory);
  if(!samePath(runtimeDirectory,path.join(draftScopeDirectory,'runtime'))||overlaps(dataDirectory,runtimeDirectory))throw problem('资料位置配置的本机设置路径无效。');
  return{version:1,dataDirectory,runtimeDirectory,draftScopeDirectory};
}

/** Startup is synchronous so the profile path is fixed before Electron becomes ready. */
export function readDataLocation({appDataDirectory,override,freeEdition=false}={}){
  if(typeof freeEdition!=='boolean')throw problem('免费版选项无效。');
  const base=absolute(appDataDirectory),configPath=path.join(base,'ITS ME','storage-location.json');
  // An explicit command-line directory never reads the normal user's pointer.
  if(override!==undefined){const dataDirectory=resolveDataDirectory(base,override);return locationFor(configPath,{dataDirectory,runtimeDirectory:path.join(dataDirectory,'runtime'),draftScopeDirectory:dataDirectory},true,true);}
  try{
    safeDirectoryChainSync(path.dirname(configPath));
    if(!maybeStatSync(configPath)){assertNoMissingMigrationPointer({appDataDirectory:base,configPath});const dataDirectory=resolveDataDirectory(base);return locationFor(configPath,{dataDirectory,runtimeDirectory:path.join(dataDirectory,'runtime'),draftScopeDirectory:dataDirectory});}
    const configuration=validateConfiguration(JSON.parse(regularBytesSync(configPath,16*1024).toString('utf8')));
    safeDirectoryChainSync(configuration.dataDirectory,{required:true});safeDirectoryChainSync(configuration.draftScopeDirectory,{required:true});safeDirectoryChainSync(configuration.runtimeDirectory);
    if(!hasRecoverableFullBackupSync(configuration.dataDirectory,{freeEdition}))parseState(regularBytesSync(path.join(configuration.dataDirectory,'state.json'),STATE_LIMIT));
    return locationFor(configPath,configuration,false,true);
  }catch(error){throw problem('资料位置配置或资料目录无效；请恢复原目录或联系支持，未创建空资料库。',{cause:error});}
}
function assertLocation(location){
  if(!location||location.isOverride)throw problem('命令行参数（CLI）指定目录时不能迁移。');
  for(const key of ['dataDirectory','runtimeDirectory','draftScopeDirectory','configPath'])absolute(location[key]);
  if(!samePath(location.runtimeDirectory,path.join(location.draftScopeDirectory,'runtime')))throw problem('本机设置目录与原资料标识不一致。');
}

export async function inspectDataLocationTarget({location,targetDirectory,installDirectory}){
  assertLocation(location);const target=absolute(targetDirectory),source=absolute(location.dataDirectory),runtime=absolute(location.runtimeDirectory),install=absolute(installDirectory);
  if(samePath(target,path.parse(target).root)||overlaps(target,source)||overlaps(target,runtime)||overlaps(target,install)||inside(location.configPath,target))throw problem('目标不能是磁盘根目录、原资料/本机设置/安装目录或其上下级目录，也不能包含固定位置配置文件。');
  await safeDirectoryChain(source,{required:true});await safeDirectoryChain(runtime);await safeDirectoryChain(path.dirname(location.configPath));
  const targetStat=await safeDirectoryChain(target);
  if(targetStat&&(await readdir(target)).length)throw problem('请选择空目录；非空目标不会覆盖。');
  if(!targetStat)await safeDirectoryChain(path.dirname(target),{required:true});
  return{targetDirectory:target,targetExists:Boolean(targetStat),targetStat};
}
function safeName(name){return typeof name==='string'&&name.length>0&&name.length<=255&&name!=='.'&&name!=='..'&&!/[\\/:*?"<>|\x00-\x1f\x7f]/u.test(name)&&!/[. ]$/u.test(name)&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name);}
function references(state){
  const metadata=[...(state.library.attachments??[]),...state.projects.flatMap(item=>item.attachments??[]),...state.backups.flatMap(item=>item.library.attachments??[]),...state.exports.flatMap(item=>[...(item.attachments??[]),...(item.editable?.attachments??[])])],attachments=new Map();
  for(const item of metadata){validateAttachmentMetadata(item);const relative='attachments/'+item.storedFile,previous=attachments.get(relative);if(previous&&(previous.size!==item.size||previous.sha256&&item.sha256&&previous.sha256!==item.sha256))throw problem('同一附件的资料引用不一致。');attachments.set(relative,{...item,sha256:item.sha256??previous?.sha256});}
  const pdfs=new Set(state.exports.map(item=>'exports/'+item.pdfFile));
  for(const relative of [...attachments.keys(),...pdfs])if(relative.split('/').length!==2||!safeName(relative.split('/')[1]))throw problem('资料引用的文件路径无效。');
  return{attachments,pdfs};
}
function validPdf(bytes){return bytes.length>=16&&/^%PDF-(?:1\.[0-7]|2\.0)$/u.test(bytes.subarray(0,8).toString('ascii'))&&/%%EOF[\x00\t\n\f\r ]*$/u.test(bytes.subarray(Math.max(0,bytes.length-1024)).toString('latin1'));}
async function snapshot(root,{strictRoot=false,freeEdition=false}={}){
  await safeDirectoryChain(root,{required:true});
  if(await maybeStat(path.join(root,'.full-backup-transaction.json')))throw problem('有尚未完成的完整备份恢复，请重新打开软件完成恢复后再迁移。');
  if(strictRoot)for(const entry of await readdir(root,{withFileTypes:true}))if(!['state.json','attachments','exports',LIBRARY_LICENSE_FILE].includes(entry.name)&&!RESCUE.test(entry.name)&&!IDENTITY_RESCUE.test(entry.name))throw problem('迁移目标中出现其它文件，未启用该目录。');
  const files=new Map(),directories=[];
  const stateRead=await regularBytes(path.join(root,'state.json'),STATE_LIMIT),state=parseState(stateRead.bytes),refs=references(state);
  const add=(relative,result,limit)=>{if(files.size>=30000)throw problem('受管文件过多，请先整理后迁移。');files.set(relative,{size:result.bytes.length,sha256:hash(result.bytes),stat:result.stat,limit});};
  add('state.json',stateRead,STATE_LIMIT);
  const identityPath=path.join(root,LIBRARY_LICENSE_FILE);
  if(!freeEdition&&await maybeStat(identityPath)){
    const result=await regularBytes(identityPath,65536);
    try{validateLibraryLicenseRecord(JSON.parse(result.bytes.toString('utf8')));}catch{throw problem('资料库身份或授权记录损坏，未迁移。');}
    add(LIBRARY_LICENSE_FILE,result,65536);
  }
  for(const folder of ['attachments','exports']){
    const directory=path.join(root,folder),stat=await maybeStat(directory);if(!stat)continue;
    await safeDirectoryChain(directory,{required:true});directories.push(folder);
    for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      if(!safeName(entry.name)||!entry.isFile()||entry.isSymbolicLink())throw problem('受管资料路径含链接、子目录或无效文件名。');
      const relative=folder+'/'+entry.name,result=await regularBytes(path.join(directory,entry.name),FILE_LIMIT);add(relative,result,FILE_LIMIT);
      const metadata=refs.attachments.get(relative);
      if(metadata&&(metadata.size!==result.bytes.length||metadata.sha256!==undefined&&metadata.sha256!==hash(result.bytes)))throw problem('附件大小或哈希与资料引用不符。');
      if(refs.pdfs.has(relative)&&!validPdf(result.bytes))throw problem('归档PDF校验失败。');
    }
  }
  for(const entry of await readdir(root,{withFileTypes:true}))if(RESCUE.test(entry.name)){
    if(!entry.isFile()||entry.isSymbolicLink())throw problem('救援备份文件含链接或类型无效。');
    add(entry.name,await regularBytes(path.join(root,entry.name),RESCUE_LIMIT),RESCUE_LIMIT);
  }
  for(const entry of await readdir(root,{withFileTypes:true})){
    const match=IDENTITY_RESCUE.exec(entry.name);if(freeEdition||!match)continue;
    if(!entry.isFile()||entry.isSymbolicLink())throw problem('身份救援原件含链接或类型无效。');
    const result=await regularBytes(path.join(root,entry.name),65536);
    if(result.stat.nlink!==1||hash(result.bytes)!==match[1])throw problem('身份救援原件哈希不符，未迁移。');
    add(entry.name,result,65536);
  }
  for(const relative of [...refs.attachments.keys(),...refs.pdfs])if(!files.has(relative))throw problem('资料引用的附件或PDF文件缺失。');
  return{files,directories:directories.sort(),state};
}
// Shared only by the startup recovery core; never exposed to the renderer.
export {absolute as normalizeDataLocationPath,safeDirectoryChain as assertDataLocationDirectory,regularBytes as readDataLocationFile,validateConfiguration as validateDataLocationConfiguration};
export async function inspectExistingDataLibrary(directory,{installDirectory}={}){
  directory=absolute(directory);const install=absolute(installDirectory);
  if(samePath(directory,path.parse(directory).root)||overlaps(directory,install))throw problem('资料目录不能是磁盘根或程序安装目录。');
  const before=await safeDirectoryChain(directory,{required:true});
  if(await maybeStat(path.join(directory,'.full-backup-transaction.json')))throw problem('有尚未完成的资料恢复，请保留原件，先完成恢复事务。');
  const stateRead=await regularBytes(path.join(directory,'state.json'),STATE_LIMIT),state=parseState(stateRead.bytes),refs=references(state),files=[];
  const add=(relative,item)=>{if(files.length>=30000||item.stat.nlink!==1)throw problem('引用文件过多或存在文件链接，未重连。');files.push([relative,item.bytes.length,hash(item.bytes),String(item.stat.dev),String(item.stat.ino),item.stat.mtimeMs,item.stat.ctimeMs,item.stat.nlink]);};
  add('state.json',stateRead);
  // Only referenced material is read. Runtime, old licenses, rescue bundles and
  // unrelated user files are neither walked nor included in the recovery digest.
  for(const folder of ['attachments','exports'])if(await maybeStat(path.join(directory,folder)))await safeDirectoryChain(path.join(directory,folder),{required:true});
  for(const relative of [...refs.attachments.keys(),...refs.pdfs].sort()){
    const item=await regularBytes(path.join(directory,...relative.split('/')),FILE_LIMIT),metadata=refs.attachments.get(relative);
    if(metadata&&(item.bytes.length!==metadata.size||metadata.sha256!==undefined&&hash(item.bytes)!==metadata.sha256))throw problem('引用附件的大小或哈希不符。');
    if(refs.pdfs.has(relative)&&!validPdf(item.bytes))throw problem('引用PDF不完整。');add(relative,item);
  }
  const after=await safeDirectoryChain(directory,{required:true});if(!sameObject(before,after))throw problem('资料根目录在检查时变化。');
  return{signature:hash(JSON.stringify({root:[String(after.dev),String(after.ino)],files})),rootIdentity:{dev:String(after.dev),ino:String(after.ino)},counts:{libraryEntries:state.library.entries.length,libraryVersions:state.backups.length,projects:state.projects.length,pdfs:state.exports.length}};
}
// A stable existing AppData scope works even if the ITS ME config folder was removed.
// Both normal migration publication/rollback and startup recovery share this OS mutex.
export async function acquireDataLocationPointerSession(configPath,{acquireSession=acquireLibrarySession}={}){
  const directory=path.dirname(path.dirname(absolute(configPath)));await safeDirectoryChain(directory,{required:true});
  return{directory,session:await acquireSession({directory})};
}
const assertPointerSession=lease=>{if(lease)assertLibrarySession(lease.session,lease.directory);};

function snapshotEqual(a,b,{sourceIdentity=false}={}){
  if(JSON.stringify(a.directories)!==JSON.stringify(b.directories)||a.files.size!==b.files.size)return false;
  for(const [relative,item]of a.files){const next=b.files.get(relative);if(!next||item.size!==next.size||item.sha256!==next.sha256||sourceIdentity&&!sameStat(item.stat,next.stat))return false;}
  return true;
}
async function pointerBytes(location){await safeDirectoryChain(path.dirname(location.configPath));if(!await maybeStat(location.configPath))return null;return(await regularBytes(location.configPath,16*1024)).bytes;}
function equalBytes(a,b){return a===null?b===null:b!==null&&a.equals(b);}
async function checkPointer(location,expected){if(!equalBytes(await pointerBytes(location),expected))throw problem('资料位置配置已变化，请重新打开软件后重试。');}
async function writeExclusive(file,bytes){let handle;try{handle=await open(file,'wx',0o600);await handle.writeFile(bytes);await handle.sync();}finally{await handle?.close();}}
async function writePointer(configPath,bytes){
  await safeDirectoryChain(path.dirname(configPath),{required:true});
  const temporary=path.join(path.dirname(configPath),'.storage-location-'+randomUUID()+'.tmp');
  await writeExclusive(temporary,bytes);
  try{await rename(temporary,configPath);}catch(error){await unlink(temporary).catch(()=>{});throw error;}
}
async function restorePointer(location,expected,previous,lease){
  assertPointerSession(lease);await checkPointer(location,expected);
  if(previous===null)await unlink(location.configPath);else await writePointer(location.configPath,previous);
  assertPointerSession(lease);
}

/** Caller must flush and freeze writes first. Source files and runtime are never modified. */
export async function migrateDataLocation({location,targetDirectory,installDirectory,fault,cleanupSource=false,freeEdition=false}={}){
  assertLocation(location);const key=identity(location.configPath);
  if(typeof cleanupSource!=='boolean'||typeof freeEdition!=='boolean')throw problem('旧目录清理选项无效。');
  if(migrating.has(key))throw problem('已有资料目录迁移正在进行，请等待完成。');
  migrating.add(key);let stage,pointerWritten=false,previous=null,configurationBytes,hold,cleanupId,pointerLease;
  const checkpoint=async phase=>{if(fault)await fault(phase);};
  try{
    if(cleanupSource)await assertDataLocationCleanupAvailable(location);
    const inspection=await inspectDataLocationTarget({location,targetDirectory,installDirectory}),target=inspection.targetDirectory;
    previous=await pointerBytes(location);
    if(previous!==null){let selected;try{selected=validateConfiguration(JSON.parse(previous.toString('utf8')));}catch{throw problem('资料位置配置无效，未迁移。');}if(!samePath(selected.dataDirectory,location.dataDirectory)||!samePath(selected.runtimeDirectory,location.runtimeDirectory)||!samePath(selected.draftScopeDirectory,location.draftScopeDirectory))throw problem('资料位置已变化，请重新打开软件。');}
    else if(location.customDataDirectory)throw problem('资料位置配置已变化，请重新打开软件。');
    const original=await snapshot(location.dataDirectory,{freeEdition});
    stage=path.join(path.dirname(target),'.itsme-data-migration-'+randomUUID());await mkdir(stage,{mode:0o700});await checkpoint('stage-created');
    for(const folder of original.directories)await mkdir(path.join(stage,folder),{mode:0o700});
    for(const [relative,item]of original.files){
      await safeDirectoryChain(path.dirname(path.join(location.dataDirectory,...relative.split('/'))),{required:true});
      const result=await regularBytes(path.join(location.dataDirectory,...relative.split('/')),item.limit);
      if(!sameStat(item.stat,result.stat)||item.sha256!==hash(result.bytes))throw problem('原资料在复制时发生变化。');
      await writeExclusive(path.join(stage,...relative.split('/')),result.bytes);await checkpoint('file-copied');
    }
    if(!snapshotEqual(original,await snapshot(location.dataDirectory,{freeEdition}),{sourceIdentity:true})||!snapshotEqual(original,await snapshot(stage,{strictRoot:true,freeEdition})))throw problem('资料复制校验失败或源资料发生变化。');
    await checkpoint('source-verified');
    const fresh=await inspectDataLocationTarget({location,targetDirectory:target,installDirectory});
    if(fresh.targetExists!==inspection.targetExists||fresh.targetExists&&!sameObject(fresh.targetStat,inspection.targetStat))throw problem('目标目录已变化，未覆盖目标。');
    await checkPointer(location,previous);
    if(fresh.targetExists){hold=path.join(path.dirname(target),'.itsme-empty-directory-'+randomUUID());await rename(target,hold);if((await readdir(hold)).length)throw problem('目标目录已变为非空，未覆盖目标。');}
    // On Windows rename will not overwrite an existing directory; recheck also covers other platforms.
    if(await maybeStat(target))throw problem('目标目录已变化，未覆盖目标。');
    await rename(stage,target);stage=null;
    await checkpoint('target-published');
    if(!snapshotEqual(original,await snapshot(target,{strictRoot:true,freeEdition}))||!snapshotEqual(original,await snapshot(location.dataDirectory,{freeEdition}),{sourceIdentity:true}))throw problem('迁移校验失败或原资料已变化。');
    await checkpoint('before-pointer');
    await checkPointer(location,previous);
    if(!snapshotEqual(original,await snapshot(target,{strictRoot:true,freeEdition}))||!snapshotEqual(original,await snapshot(location.dataDirectory,{freeEdition}),{sourceIdentity:true}))throw problem('迁移提交前资料已变化。');
    await safeDirectoryChain(path.dirname(location.configPath));await mkdir(path.dirname(location.configPath),{recursive:true});await safeDirectoryChain(path.dirname(location.configPath),{required:true});
    if(process.platform==='win32')pointerLease=await acquireDataLocationPointerSession(location.configPath);
    assertPointerSession(pointerLease);await checkPointer(location,previous);
    const configuration={version:1,dataDirectory:target,runtimeDirectory:location.runtimeDirectory,draftScopeDirectory:location.draftScopeDirectory};
    configurationBytes=Buffer.from(JSON.stringify(configuration,null,2)+'\n');
    if(cleanupSource){const refs=references(original.state),cleanupFiles=new Set(['state.json',...(!freeEdition?[LIBRARY_LICENSE_FILE]:[]),...refs.attachments.keys(),...refs.pdfs]);for(const relative of original.files.keys())if(RESCUE.test(relative)||!freeEdition&&IDENTITY_RESCUE.test(relative))cleanupFiles.add(relative);cleanupId=await prepareDataLocationCleanup({location,targetDirectory:target,configurationBytes,snapshot:original,cleanupFiles});await checkpoint('cleanup-prepared');}
    assertPointerSession(pointerLease);await checkPointer(location,previous);
    await writePointer(location.configPath,configurationBytes);pointerWritten=true;assertPointerSession(pointerLease);
    await checkpoint('pointer-written');
    if(cleanupId){await commitDataLocationCleanup(location,cleanupId);await checkpoint('cleanup-committed');}
    const newLocation=locationFor(location.configPath,configuration,false,true);
    if(hold){await rmdir(hold);hold=null;}
    let rolledBack=false;
    const rollback=async()=>{
      if(rolledBack)return;
      if(migrating.has(key))throw problem('另一次迁移进行中，不能回退。');
      migrating.add(key);let rollbackLease;
      try{
        if(process.platform==='win32')rollbackLease=await acquireDataLocationPointerSession(location.configPath);
        assertPointerSession(rollbackLease);await checkPointer(location,configurationBytes);
        if(!snapshotEqual(original,await snapshot(target,{strictRoot:true,freeEdition}))||!snapshotEqual(original,await snapshot(location.dataDirectory,{freeEdition}),{sourceIdentity:true}))throw problem('新旧目录资料已变化，不能自动回退。');
        if(cleanupId)await cancelDataLocationCleanup(location,cleanupId);
        await restorePointer(location,configurationBytes,previous,rollbackLease);rolledBack=true;
      }catch(error){throw problem('资料或位置配置已变化，不能自动回退；原资料仍保留。',{cause:error});}
      finally{await rollbackLease?.session.release().catch(()=>{});migrating.delete(key);}
    };
    return{location:newLocation,rollback};
  }catch(error){
    let restored=true;
    if(cleanupId)try{await cancelDataLocationCleanup(location,cleanupId);}catch{restored=false;}
    if(pointerWritten&&restored)try{await restorePointer(location,configurationBytes,previous,pointerLease);}catch{restored=false;}
    // Never recursively delete migration copies. An existing empty target is restored only when still safe.
    if(hold)try{const target=absolute(targetDirectory);if(!await maybeStat(target))await rename(hold,target);else if(!(await readdir(hold)).length)await rmdir(hold);}catch{}
    const detail=typeof error?.message==='string'&&error.message.startsWith('资料目录迁移：')?error.message.slice('资料目录迁移：'.length):'复制或写入校验失败。';
    const failure=problem(restored?detail+' 迁移未完成，原资料与原目录选择保留；未启用的复制目录可能留在目标目录或其所在文件夹，请确认后再重试。':'迁移提交后回退未完成，原资料仍保留；请关闭软件，检查资料位置配置后再打开。',{cause:error});
    if(!restored)failure.requiresRestart=true;
    throw failure;
  }finally{await pointerLease?.session.release().catch(()=>{});migrating.delete(key);}
}
