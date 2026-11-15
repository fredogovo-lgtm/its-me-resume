// Post-restart cleanup only. Callers must freeze/drain target writes before finalizing.
import path from 'node:path';
import {lstat,realpath,open,rename,unlink} from 'node:fs/promises';
import {constants as fsConstants,lstatSync,readFileSync,realpathSync,openSync,fstatSync,closeSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {validateState} from '../core/model.mjs';
import {validateLibraryLicenseRecord} from './library-license.mjs';
import {acquireLibrarySession,assertLibrarySession,runWithLibrarySession} from './library-session.mjs';

const LIMIT=16*1024*1024,MAX_FILE=256*1024*1024,HEX=/^[a-f0-9]{64}$/u,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const RESCUE=/^\.rescue-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.itsme-backup$/u;
const ID_RESCUE=/^\.rescue-library-license-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}-[a-f0-9]{64}\.bin$/u;
const GUARD='.itsme-migrated-library.json';
const running=new Set(),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=message=>{throw Error('旧资料清理：'+message);};
const equalPath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
const within=(file,root)=>{const rel=path.relative(root,file);return rel===''||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
const exact=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===fields.length&&fields.every(key=>Object.hasOwn(value,key));
const objectIdentity=info=>({dev:String(info.dev),ino:String(info.ino)});
const sameIdentity=(info,saved)=>String(info.dev)===saved.dev&&String(info.ino)===saved.ino;
const statRecord=info=>({...objectIdentity(info),size:info.size,mtimeMs:info.mtimeMs,ctimeMs:info.ctimeMs,nlink:info.nlink});
const sameStat=(info,saved)=>sameIdentity(info,saved)&&['size','mtimeMs','ctimeMs','nlink'].every(key=>info[key]===saved[key]);
function absolute(value){
 if(typeof value!=='string'||value.length>240||!path.isAbsolute(value)||/^[\\/]{2}|[\x00-\x1f\x7f]/u.test(value))fail('清理路径无效，原文件保留。');
 const resolved=path.resolve(value);if(process.platform==='win32'&&resolved.slice(path.parse(resolved).root.length).split(path.sep).some(part=>/[. ]$|[:*?"<>|]/u.test(part)))fail('清理路径无效，原文件保留。');return resolved;
}
async function chain(directory){
 directory=absolute(directory);const root=path.parse(directory).root;let current=root;
 for(const part of [''].concat(directory.slice(root.length).split(path.sep).filter(Boolean))){if(part)current=path.join(current,part);const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink()||!equalPath(await realpath(current),current))fail('目录链接或目录身份变化，原文件保留。');}
 return lstat(directory);
}
async function bytes(file,maximum){
 await chain(path.dirname(file));let handle;
 const before=await lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>maximum||!equalPath(await realpath(file),file))fail('文件类型、链接或大小不符，原文件保留。');
 try{handle=await open(file,'r');const opened=await handle.stat();if(!sameStat(opened,statRecord(before)))fail('文件在读取时变化。');const data=await handle.readFile(),after=await handle.stat(),current=await lstat(file);if(data.length!==before.size||!current.isFile()||current.isSymbolicLink()||!sameStat(after,statRecord(before))||!sameStat(current,statRecord(before)))fail('文件在读取时变化。');return{bytes:data,stat:current};}finally{await handle?.close();}
}
function receiptPath(location){if(!location||location.isOverride)fail('测试启动目录不能处理普通资料迁移。');return path.join(path.dirname(absolute(location.configPath)),'storage-migration-cleanup.json');}
export function assertNoMissingMigrationPointer({appDataDirectory,configPath}){
 // A missing pointer must not turn a cleaned legacy/default location into a new empty library.
 for(const root of [path.join(appDataDirectory,'ITS ME/data'),path.join(appDataDirectory,'履历工坊/data')]){try{lstatSync(path.join(root,GUARD));fail('此资料库曾迁移，位置指针现已缺失；请核对新资料位置，未创建空资料库。');}catch(error){if(error.code!=='ENOENT')throw error;}}
 let descriptor;try{const file=path.join(path.dirname(configPath),'storage-migration-cleanup.json'),info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>LIMIT||!equalPath(realpathSync(file),file))fail('迁移记录或位置指针缺失，未创建空资料库。');descriptor=openSync(file,fsConstants.O_RDONLY|(fsConstants.O_NOFOLLOW??0));if(!sameStat(fstatSync(descriptor),statRecord(info)))fail('迁移记录在读取时变化。');const data=readFileSync(descriptor),current=lstatSync(file);if(data.length!==info.size||!sameStat(fstatSync(descriptor),statRecord(info))||!sameStat(current,statRecord(info))||current.isSymbolicLink()||!equalPath(realpathSync(file),file))fail('迁移记录在读取时变化。');const record=JSON.parse(data.toString('utf8'));if(record?.format!=='itsme-data-migration-cleanup'||record.version!==1||record.phase!=='canceled')fail('此资料库已有迁移记录，位置指针现已缺失；请核对新资料位置，未创建空资料库。');}catch(error){if(error.code!=='ENOENT')throw error;}finally{if(descriptor!==undefined)closeSync(descriptor);}
}
function safeRelative(value){
 if(typeof value!=='string'||value.length>300||/[\\:\x00-\x1f\x7f]/u.test(value))return false;
 if(['state.json','library-license.json'].includes(value)||RESCUE.test(value)||ID_RESCUE.test(value))return true;
 const parts=value.split('/');return parts.length===2&&['attachments','exports'].includes(parts[0])&&parts[1].length>0&&parts[1].length<=255&&!['.','..'].includes(parts[1])&&!/[?*"<>|]|[. ]$/u.test(parts[1])&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(parts[1]);
}
function validIdentity(value){return exact(value,['dev','ino'])&&Object.values(value).every(item=>typeof item==='string'&&/^\d{1,24}$/u.test(item));}
function validate(record,location){
 if(!exact(record,['format','version','migrationId','phase','sourceDirectory','targetDirectory','runtimeDirectory','draftScopeDirectory','configPath','pointerSha256','sourceRoot','targetRoot','files','lastFailure'])||record.format!=='itsme-data-migration-cleanup'||record.version!==1||!UUID.test(record.migrationId)||!['prepared','committed','cleaning','complete','canceled'].includes(record.phase)||!HEX.test(record.pointerSha256)||!validIdentity(record.sourceRoot)||!validIdentity(record.targetRoot)||typeof record.lastFailure!=='string'||record.lastFailure.length>500)fail('清理记录格式无效，未删除文件。');
 for(const key of ['sourceDirectory','targetDirectory','runtimeDirectory','draftScopeDirectory','configPath'])if(absolute(record[key])!==record[key])fail('清理路径未规范化。');
 if(!equalPath(record.configPath,location.configPath)||!equalPath(record.runtimeDirectory,location.runtimeDirectory)||!equalPath(record.draftScopeDirectory,location.draftScopeDirectory)||!equalPath(record.runtimeDirectory,path.join(record.draftScopeDirectory,'runtime'))||within(record.sourceDirectory,record.targetDirectory)||within(record.targetDirectory,record.sourceDirectory)||within(record.targetDirectory,record.runtimeDirectory)||within(record.runtimeDirectory,record.targetDirectory)||equalPath(record.sourceDirectory,path.parse(record.sourceDirectory).root)||equalPath(record.targetDirectory,path.parse(record.targetDirectory).root))fail('清理记录与当前本机位置不符。');
 if(!Array.isArray(record.files)||!record.files.length||record.files.length>30000)fail('清理文件清单无效。');const seen=new Set();
 for(const file of record.files){const s=file?.sourceStat;if(!exact(file,['relative','size','sha256','sourceStat','cleanup','done'])||!safeRelative(file.relative)||seen.has(file.relative.toLowerCase())||!Number.isSafeInteger(file.size)||file.size<0||file.size>MAX_FILE||!HEX.test(file.sha256)||typeof file.cleanup!=='boolean'||typeof file.done!=='boolean'||file.done&&!file.cleanup||!exact(s,['dev','ino','size','mtimeMs','ctimeMs','nlink'])||!validIdentity({dev:s.dev,ino:s.ino})||s.size!==file.size||!['size','mtimeMs','ctimeMs','nlink'].every(key=>typeof s[key]==='number'&&Number.isFinite(s[key])&&s[key]>=0))fail('清理文件清单无效。');seen.add(file.relative.toLowerCase());}
 if(!record.files.some(file=>file.relative==='state.json'&&file.cleanup)||record.phase==='complete'&&record.files.some(file=>file.cleanup&&!file.done))fail('清理进度无效。');return record;
}
async function readRecord(location){
 const file=receiptPath(location);let value;try{value=await bytes(file,LIMIT);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 let record;try{record=JSON.parse(value.bytes.toString('utf8'));}catch{fail('清理记录无法读取，未删除文件。');}validate(record,location);return{file,record,bytes:value.bytes};
}
async function saveRecord(location,record,previous,beforePublish){
 validate(record,location);const file=receiptPath(location),payload=Buffer.from(JSON.stringify(record,null,2)+'\n');if(payload.length>LIMIT)fail('清理记录超过容量限制。');await chain(path.dirname(file));
 const current=await readRecord(location);if(previous===null?current!==null:!current||!current.bytes.equals(previous))fail('清理记录已变化，未覆盖。');
 const temporary=path.join(path.dirname(file),'.storage-cleanup-'+randomUUID()+'.tmp');let handle;
 try{handle=await open(temporary,'wx',0o600);await handle.writeFile(payload);await handle.sync();await handle.close();handle=null;const check=await readRecord(location);if(previous===null?check!==null:!check||!check.bytes.equals(previous))fail('清理记录已变化，未覆盖。');await beforePublish?.();await rename(temporary,file);const saved=await bytes(file,LIMIT);if(!saved.bytes.equals(payload))fail('清理记录保存校验失败。');return payload;}finally{await handle?.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function assertDataLocationCleanupAvailable(location){const current=await readRecord(location);if(current&&!['complete','canceled'].includes(current.record.phase))fail('上次迁移的旧目录尚未完成清理，请先重试清理或核对原文件，不能覆盖清理清单。');}
export async function prepareDataLocationCleanup({location,targetDirectory,configurationBytes,snapshot,cleanupFiles}){
 await assertDataLocationCleanupAvailable(location);const previous=await readRecord(location),sourceRoot=await chain(location.dataDirectory),targetRoot=await chain(targetDirectory);
 const record={format:'itsme-data-migration-cleanup',version:1,migrationId:randomUUID(),phase:'prepared',sourceDirectory:absolute(location.dataDirectory),targetDirectory:absolute(targetDirectory),runtimeDirectory:absolute(location.runtimeDirectory),draftScopeDirectory:absolute(location.draftScopeDirectory),configPath:absolute(location.configPath),pointerSha256:digest(configurationBytes),sourceRoot:objectIdentity(sourceRoot),targetRoot:objectIdentity(targetRoot),files:[...snapshot.files].map(([relative,item])=>({relative,size:item.size,sha256:item.sha256,sourceStat:statRecord(item.stat),cleanup:cleanupFiles.has(relative),done:false})),lastFailure:''};
 await saveRecord(location,record,previous?.bytes??null);return record.migrationId;
}
export async function commitDataLocationCleanup(location,id){const current=await readRecord(location);if(!current||current.record.migrationId!==id||current.record.phase!=='prepared')fail('清理准备记录已变化。');await currentPointer(location,current.record);current.record.phase='committed';await saveRecord(location,current.record,current.bytes);}
export async function cancelDataLocationCleanup(location,id){const current=await readRecord(location);if(!current||current.record.migrationId!==id)fail('清理准备记录已变化。');if(['cleaning','complete'].includes(current.record.phase))fail('新进程已开始清理，不能退回旧位置。');current.record.phase='canceled';current.record.lastFailure='';await saveRecord(location,current.record,current.bytes);}
async function currentPointer(location,record){
 const pointer=await bytes(record.configPath,16384);if(digest(pointer.bytes)!==record.pointerSha256)fail('资料位置指针已变化，原文件保留。');let config;try{config=JSON.parse(pointer.bytes.toString('utf8'));}catch{fail('资料位置指针无效。');}
 if(!exact(config,['version','dataDirectory','runtimeDirectory','draftScopeDirectory'])||config.version!==1||!equalPath(config.dataDirectory,record.targetDirectory)||!equalPath(config.runtimeDirectory,record.runtimeDirectory)||!equalPath(config.draftScopeDirectory,record.draftScopeDirectory))fail('资料位置指针未选择迁移目标。');
}
const none=()=>({state:'none',sourceDirectory:'',remainingFiles:0,notice:'',canRetry:false});
const status=(record,state,notice='',canRetry=true)=>({state,sourceDirectory:record?.sourceDirectory??'',remainingFiles:record?.files.filter(file=>file.cleanup&&!file.done).length??0,notice,canRetry});
export async function readDataLocationCleanupStatus({location}={}){
 if(location?.isOverride)return none();let current;try{current=await readRecord(location);if(!current||current.record.phase==='canceled')return none();const record=current.record;if(record.phase==='complete')return status(record,'complete','旧位置中本次迁移的受管文件已清理；本机设置和其它文件保留。',false);if(record.phase==='prepared')return status(record,'blocked','迁移提交记录尚未完成，未删除旧文件；请核对资料位置。',false);await currentPointer(location,record);if(!equalPath(location.dataDirectory,record.targetDirectory))return status(record,'blocked','请从迁移后的新位置打开软件再清理旧文件。',false);return status(record,record.lastFailure?'blocked':'pending',record.lastFailure||'新位置可用后将核验并清理旧位置的受管文件。');}catch{return status(current?.record,'blocked','旧目录清理记录或位置无法验证，未删除文件。',false);}
}
function managedFiles(state,{freeEdition=false}={}){
 const result=new Set(['state.json',...(!freeEdition?['library-license.json']:[])]),libraries=[state.library,...state.backups.map(item=>item.library)],projects=[...state.projects,...state.exports.flatMap(item=>item.editable?[item.editable]:[])];
 for(const owner of [...libraries,...projects,...state.exports])for(const item of owner.attachments??[])result.add('attachments/'+item.storedFile);for(const item of state.exports)result.add('exports/'+item.pdfFile);return result;
}
async function verifyCopied(record,{freeEdition=false}={}){
 const root=await chain(record.targetDirectory);if(!sameIdentity(root,record.targetRoot))fail('新目录身份变化，旧文件保留。');let state;
 for(const file of record.files){if(freeEdition&&retiredIdentity(file.relative))continue;const read=await bytes(path.join(record.targetDirectory,...file.relative.split('/')),file.size);if(read.bytes.length!==file.size||digest(read.bytes)!==file.sha256)fail('新位置文件与迁移清单不符，旧文件保留。');if(file.relative==='state.json'){try{state=JSON.parse(read.bytes.toString('utf8'));validateState(state);}catch{fail('新位置资料库无法验证。');}}}
 // Startup may initialize a previously absent identity; it must still be structurally valid.
 if(!freeEdition)try{const identity=await bytes(path.join(record.targetDirectory,'library-license.json'),65536);validateLibraryLicenseRecord(JSON.parse(identity.bytes.toString('utf8')));}catch(error){if(error.code!=='ENOENT')throw error;}
 const allowed=managedFiles(state,{freeEdition}),listed=new Map(record.files.map(file=>[file.relative,file]));for(const relative of allowed)if(relative!=='library-license.json'&&!listed.has(relative))fail('复制清单缺少资料库引用文件，旧文件保留。');
 const owners=[state.library,...state.backups.map(item=>item.library),...state.projects,...state.exports,...state.exports.flatMap(item=>item.editable?[item.editable]:[])];
 for(const owner of owners)for(const attachment of owner.attachments??[]){const file=listed.get('attachments/'+attachment.storedFile);if(!file||file.size!==attachment.size||attachment.sha256&&file.sha256!==attachment.sha256)fail('复制清单与附件元数据不一致，旧文件保留。');}
 for(const file of record.files){if(freeEdition&&retiredIdentity(file.relative)&&file.done)continue;if(file.cleanup!==Boolean(allowed.has(file.relative)||RESCUE.test(file.relative)||!freeEdition&&ID_RESCUE.test(file.relative)))fail('可清理文件范围与已复制资料引用不一致。');}
}
async function verifySourceFile(record,file){
 let read;try{read=await bytes(path.join(record.sourceDirectory,...file.relative.split('/')),file.size);}catch(error){if(error.code==='ENOENT')return false;throw error;}
 if(!sameStat(read.stat,file.sourceStat)||digest(read.bytes)!==file.sha256)fail('旧位置文件已修改或被替换，原文件保留。');return true;
}
async function preserveMovedGuard(record){
 const file=path.join(record.sourceDirectory,GUARD),value={format:'itsme-migrated-library',version:1,migrationId:record.migrationId,targetDirectory:record.targetDirectory,pointerSha256:record.pointerSha256};let existing=null;
 try{existing=(await bytes(file,16384)).bytes;const old=JSON.parse(existing.toString('utf8'));if(!exact(old,Object.keys(value))||old.format!==value.format||old.version!==1||!UUID.test(old.migrationId)||!HEX.test(old.pointerSha256)||typeof old.targetDirectory!=='string')fail('旧目录迁移标记异常，未清理。');if(existing.equals(Buffer.from(JSON.stringify(value,null,2)+'\n')))return;}catch(error){if(error.code!=='ENOENT')throw error;}
 const temporary=path.join(record.sourceDirectory,'.migrated-guard-'+randomUUID()+'.tmp'),payload=Buffer.from(JSON.stringify(value,null,2)+'\n');let handle;
 try{handle=await open(temporary,'wx',0o600);await handle.writeFile(payload);await handle.sync();await handle.close();handle=null;let now=null;try{now=(await bytes(file,16384)).bytes;}catch(error){if(error.code!=='ENOENT')throw error;}if(existing===null?now!==null:!now||!now.equals(existing))fail('旧目录迁移标记已变化。');await rename(temporary,file);if(!(await bytes(file,16384)).bytes.equals(payload))fail('旧目录迁移标记校验失败。');}finally{await handle?.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
const retiredIdentity=relative=>relative==='library-license.json'||ID_RESCUE.test(relative);
export async function finalizeDataLocationCleanup({location,installDirectory,targetSession,sourceSession,acquireSourceSession=acquireLibrarySession,fault,freeEdition=false}={}){
 if(typeof freeEdition!=='boolean')fail('免费版选项无效。');
 if(location?.isOverride)return none();let current,owned=false,sourceHeld=sourceSession,record,key,entered=false;
 try{
  current=await readRecord(location);if(!current||current.record.phase==='canceled')return none();record=current.record;if(record.phase==='complete')return status(record,'complete','旧位置受管文件已清理，其它文件保留。',false);if(!['committed','cleaning'].includes(record.phase))return status(record,'blocked','迁移提交未完成，未删除旧文件。',false);
  key=receiptPath(location).toLowerCase();if(running.has(key))return status(record,'blocked','另一次旧目录清理正在进行。');running.add(key);entered=true;
  if(!equalPath(location.dataDirectory,record.targetDirectory))fail('当前窗口没有使用迁移后的目录。');const install=absolute(installDirectory);if(within(record.sourceDirectory,install)||within(install,record.sourceDirectory)||within(record.targetDirectory,install)||within(install,record.targetDirectory))fail('资料目录与安装目录重叠，未清理。');
  assertLibrarySession(targetSession,record.targetDirectory);await currentPointer(location,record);
  if(!sourceHeld){sourceHeld=await acquireSourceSession({directory:record.sourceDirectory});owned=true;}assertLibrarySession(sourceHeld,record.sourceDirectory);
  return await runWithLibrarySession(targetSession,record.targetDirectory,()=>runWithLibrarySession(sourceHeld,record.sourceDirectory,async()=>{
   const sourceRoot=await chain(record.sourceDirectory);if(!sameIdentity(sourceRoot,record.sourceRoot))fail('旧目录身份变化，未清理。');if(freeEdition)for(const file of record.files)if(retiredIdentity(file.relative)&&!file.done)file.cleanup=false;await verifyCopied(record,{freeEdition});
   for(const file of record.files.filter(item=>item.cleanup&&!item.done))await verifySourceFile(record,file);
   record.phase='cleaning';record.lastFailure='';current.bytes=await saveRecord(location,record,current.bytes);await preserveMovedGuard(record);
   const files=record.files.filter(item=>item.cleanup&&!item.done).sort((a,b)=>(a.relative==='state.json'?2:a.relative==='library-license.json'?1:0)-(b.relative==='state.json'?2:b.relative==='library-license.json'?1:0)||a.relative.localeCompare(b.relative));
   let processed=0;for(const file of files){
    await fault?.('before-delete',file.relative);assertLibrarySession(targetSession,record.targetDirectory);assertLibrarySession(sourceHeld,record.sourceDirectory);await currentPointer(location,record);if(!sameIdentity(await chain(record.sourceDirectory),record.sourceRoot)||!sameIdentity(await chain(record.targetDirectory),record.targetRoot))fail('资料根目录身份变化，已停止清理。');
    const target=await bytes(path.join(record.targetDirectory,...file.relative.split('/')),file.size);if(target.bytes.length!==file.size||digest(target.bytes)!==file.sha256)fail('新位置文件已变化，已停止清理。');
    if(await verifySourceFile(record,file)){await unlink(path.join(record.sourceDirectory,...file.relative.split('/')));await fault?.('file-deleted',file.relative);}
    file.done=true;processed++;
    // Missing source files are verified against the intact target on retry, so
    // durable progress can be batched without making an interrupted unlink unsafe.
    if(processed%32===0||processed===files.length){current.bytes=await saveRecord(location,record,current.bytes);await fault?.('progress-written',file.relative);}
   }
   await fault?.('before-complete');const completed={...record,phase:'complete',lastFailure:''};current.bytes=await saveRecord(location,completed,current.bytes,()=>fault?.('complete-saving'));record=completed;return status(record,'complete','旧位置中本次迁移的受管文件已清理；本机设置和其它文件保留。',false);
  }));
 }catch(error){
  const notice=typeof error?.message==='string'&&error.message.startsWith('旧资料清理：')?error.message.slice('旧资料清理：'.length):'旧位置正在使用、无法访问或清理被中断；新位置可继续使用，剩余旧文件保留，可稍后重试。';
  if(current&&record&&['committed','cleaning'].includes(record.phase)){try{record.lastFailure=notice.slice(0,500);await saveRecord(location,record,current.bytes);}catch{}}
  return status(record,'blocked',notice,Boolean(record&&['committed','cleaning'].includes(record.phase)));
 }finally{if(owned)await sourceHeld?.release().catch(()=>{});if(entered)running.delete(key);}
}
