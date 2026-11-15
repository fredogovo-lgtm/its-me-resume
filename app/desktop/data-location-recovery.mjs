// Startup-only reconnection. Reads bounded migration evidence; never initializes a
// library, scans a drive, reads credential contents, or changes the runtime scope.
import path from 'node:path';
import {lstat,mkdir,open,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {acquireLibrarySession,assertLibrarySession,runWithLibrarySession} from './library-session.mjs';
import {normalizeDataLocationPath,assertDataLocationDirectory,readDataLocationFile,validateDataLocationConfiguration,inspectExistingDataLibrary,acquireDataLocationPointerSession} from './data-location.mjs';

const CONFIG='storage-location.json',GUARD='.itsme-migrated-library.json',RECEIPT='storage-migration-cleanup.json';
const HEX=/^[a-f0-9]{64}$/u,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const RESCUE=/^\.rescue-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}\.itsme-backup$/u;
const ID_RESCUE=/^\.rescue-library-license-[a-f0-9-]{36}-[a-f0-9]{64}\.bin$/u;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const samePath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
const within=(file,root)=>{const rel=path.relative(root,file);return rel===''||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
const overlaps=(a,b)=>within(a,b)||within(b,a);
const objectId=stat=>({dev:String(stat.dev),ino:String(stat.ino)});
const sameId=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const fail=message=>{throw Error('资料位置恢复：'+message);};
const serialized=config=>Buffer.from(JSON.stringify(config,null,2)+'\n');
const parse=bytes=>JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/u,''));
const stamp=read=>read?JSON.stringify([read.bytes.length,hash(read.bytes),String(read.stat.dev),String(read.stat.ino),read.stat.mtimeMs,read.stat.ctimeMs,read.stat.nlink]):'missing';
async function maybeRead(file,limit){
 const parent=await assertDataLocationDirectory(path.dirname(file));if(!parent)return null;
 let stat;try{stat=await lstat(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>limit)fail('位置配置或迁移记录的文件类型、链接或大小无效。');
 const result=await readDataLocationFile(file,limit);if(result.stat.nlink!==1)fail('位置记录是文件链接，未处理。');return result;
}
async function writeExclusive(file,bytes){
 let handle,created=false;
 try{handle=await open(file,'wx',0o600);created=true;await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;}
 catch(error){await handle?.close().catch(()=>{});if(created)await unlink(file).catch(()=>{});throw error;}
}
function guard(value){
 if(!exact(value,['format','version','migrationId','targetDirectory','pointerSha256'])||value.format!=='itsme-migrated-library'||value.version!==1||!UUID.test(value.migrationId)||!HEX.test(value.pointerSha256))fail('迁移标记格式无效。');
 const targetDirectory=normalizeDataLocationPath(value.targetDirectory);if(targetDirectory!==value.targetDirectory)fail('迁移标记路径未规范化。');return value;
}
function validId(value){return exact(value,['dev','ino'])&&Object.values(value).every(item=>typeof item==='string'&&/^\d{1,24}$/u.test(item));}
function safeRelative(value){
 if(typeof value!=='string'||value.length>300||/[\\:\x00-\x1f\x7f]/u.test(value))return false;
 if(['state.json','library-license.json'].includes(value)||RESCUE.test(value)||ID_RESCUE.test(value))return true;
 const pieces=value.split('/');return pieces.length===2&&['attachments','exports'].includes(pieces[0])&&pieces[1].length>0&&pieces[1].length<=255&&!['.','..'].includes(pieces[1])&&!/[?*"<>|]|[. ]$/u.test(pieces[1])&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(pieces[1]);
}
function cleanupRecord(value,configPath){
 if(!exact(value,['format','version','migrationId','phase','sourceDirectory','targetDirectory','runtimeDirectory','draftScopeDirectory','configPath','pointerSha256','sourceRoot','targetRoot','files','lastFailure'])||value.format!=='itsme-data-migration-cleanup'||value.version!==1||!UUID.test(value.migrationId)||!['prepared','committed','cleaning','complete','canceled'].includes(value.phase)||!HEX.test(value.pointerSha256)||!validId(value.sourceRoot)||!validId(value.targetRoot)||typeof value.lastFailure!=='string'||value.lastFailure.length>500)fail('迁移清单格式无效。');
 for(const key of ['sourceDirectory','targetDirectory','runtimeDirectory','draftScopeDirectory','configPath'])if(normalizeDataLocationPath(value[key])!==value[key])fail('迁移清单路径未规范化。');
 if(!samePath(value.configPath,configPath)||!samePath(value.runtimeDirectory,path.join(value.draftScopeDirectory,'runtime'))||overlaps(value.sourceDirectory,value.targetDirectory)||overlaps(value.targetDirectory,value.runtimeDirectory))fail('迁移清单与此配置位置不匹配。');
 if(!Array.isArray(value.files)||!value.files.length||value.files.length>30000)fail('迁移文件清单数量无效。');const seen=new Set();
 for(const file of value.files){const st=file?.sourceStat;if(!exact(file,['relative','size','sha256','sourceStat','cleanup','done'])||!safeRelative(file.relative)||seen.has(file.relative.toLowerCase())||!Number.isSafeInteger(file.size)||file.size<0||file.size>256*1024*1024||!HEX.test(file.sha256)||typeof file.cleanup!=='boolean'||typeof file.done!=='boolean'||file.done&&!file.cleanup||!exact(st,['dev','ino','size','mtimeMs','ctimeMs','nlink'])||!validId({dev:st.dev,ino:st.ino})||st.size!==file.size||!['size','mtimeMs','ctimeMs','nlink'].every(key=>typeof st[key]==='number'&&Number.isFinite(st[key])&&st[key]>=0))fail('迁移文件清单内容无效。');seen.add(file.relative.toLowerCase());}
 if(!value.files.some(file=>file.relative==='state.json'&&file.cleanup)||value.phase==='complete'&&value.files.some(file=>file.cleanup&&!file.done))fail('迁移清单进度无效。');return value;
}

export class DataLocationRecovery {
 #appData;#install;#configPath;#specs;#context=null;#proposals=[];#tokens=new Map();#acquire;#fault;#busy=false;
 constructor({appDataDirectory,installDirectory,acquireSession=acquireLibrarySession,fault=async()=>{}}={}){
  this.#appData=normalizeDataLocationPath(appDataDirectory);this.#install=normalizeDataLocationPath(installDirectory);this.#configPath=normalizeDataLocationPath(path.join(this.#appData,'ITS ME',CONFIG));
  if(typeof acquireSession!=='function'||typeof fault!=='function')fail('恢复参数无效。');this.#acquire=acquireSession;this.#fault=fault;
  this.#specs=[{kind:'configuration',file:this.#configPath,limit:16384},{kind:'current-guard',file:path.join(this.#appData,'ITS ME/data',GUARD),limit:16384,anchor:path.join(this.#appData,'ITS ME/data')},{kind:'legacy-guard',file:path.join(this.#appData,'履历工坊/data',GUARD),limit:16384,anchor:path.join(this.#appData,'履历工坊/data')},{kind:'migration-record',file:path.join(path.dirname(this.#configPath),RECEIPT),limit:16*1024*1024}];
 }
 async #artifacts(){const result=[];for(const spec of this.#specs)result.push({...spec,read:await maybeRead(spec.file,spec.limit)});return result;}
 async #unchanged(){
  if(!this.#context)fail('请先检查并选择资料库。');
  const appData=objectId(await assertDataLocationDirectory(this.#appData,{required:true}));if(!sameId(appData,this.#context.appDataId))fail('本机配置目录身份已变化，请重新检查。');
  const values=await this.#artifacts();if(values.some((value,index)=>stamp(value.read)!==stamp(this.#context.artifacts[index].read)))fail('位置配置或恢复依据已变化，请重新检查。');
 }
 #addProposal(config,{source,expectedHash=null,targetIdentity=null}={}){
  config=validateDataLocationConfiguration(config);
  if(samePath(config.dataDirectory,path.parse(config.dataDirectory).root)||overlaps(config.dataDirectory,this.#install)||within(this.#configPath,config.dataDirectory))fail('记录所指目录与程序或固定位置配置重叠。');
  const bytes=serialized(config);if(expectedHash&&hash(bytes)!==expectedHash)fail('记录不能还原匹配的原配置哈希，未猜测本机设置锚点。');
  const key=hash(bytes),existing=this.#proposals.find(value=>value.key===key);
  if(existing){existing.exactPointerHash ||= Boolean(expectedHash);existing.sources.push(source);if(targetIdentity)existing.identities.push(targetIdentity);return;}
  this.#proposals.push({key,config,bytes,sources:[source],identities:targetIdentity?[targetIdentity]:[],exactPointerHash:Boolean(expectedHash)});
 }
 async #candidate(proposal){
  const {config}=proposal,draft=objectId(await assertDataLocationDirectory(config.draftScopeDirectory,{required:true})),runtime=objectId(await assertDataLocationDirectory(config.runtimeDirectory,{required:true}));
  const library=await inspectExistingDataLibrary(config.dataDirectory,{installDirectory:this.#install});
  if(proposal.identities.some(expected=>!sameId(expected,library.rootIdentity)))fail('记录与所选资料根目录身份不匹配。');
  const token=randomUUID(),signature=hash(JSON.stringify({library:library.signature,draft,runtime}));
  const publicValue={token,...config,source:proposal.sources[0],sources:[...new Set(proposal.sources)],exactPointerHash:proposal.exactPointerHash,counts:library.counts,label:proposal.exactPointerHash?'原迁移位置（原配置哈希已匹配）':'原位置配置中的资料库'};
  this.#tokens.set(token,{proposal,signature,expires:Date.now()+10*60*1000,publicValue});return publicValue;
 }
 async inspect(){
  if(this.#busy)fail('已有重连操作进行中。');this.#tokens.clear();this.#proposals=[];
  const appDataId=objectId(await assertDataLocationDirectory(this.#appData,{required:true})),artifacts=await this.#artifacts(),notices=[];this.#context={appDataId,artifacts};
  for(const item of artifacts){if(!item.read)continue;try{
   const value=parse(item.read.bytes);
   if(item.kind==='configuration')this.#addProposal(value,{source:item.kind});
   else if(item.anchor){const mark=guard(value);this.#addProposal({version:1,dataDirectory:mark.targetDirectory,runtimeDirectory:path.join(item.anchor,'runtime'),draftScopeDirectory:item.anchor},{source:item.kind,expectedHash:mark.pointerSha256});}
   else{const record=cleanupRecord(value,this.#configPath);if(['committed','cleaning','complete'].includes(record.phase))this.#addProposal({version:1,dataDirectory:record.targetDirectory,runtimeDirectory:record.runtimeDirectory,draftScopeDirectory:record.draftScopeDirectory},{source:item.kind,expectedHash:record.pointerSha256,targetIdentity:record.targetRoot});else notices.push('旧迁移清单未提交或已取消，不作为自动恢复依据。');}
  }catch{notices.push('有一份旧位置记录无法安全验证，原件已保留。');}}
  const candidates=[];for(const proposal of this.#proposals){try{candidates.push(await this.#candidate(proposal));}catch{notices.push('记录中的资料或原本机设置目录暂不可验证，请检查磁盘和原文件。');}}
  candidates.sort((a,b)=>Number(b.exactPointerHash)-Number(a.exactPointerHash)||a.dataDirectory.localeCompare(b.dataDirectory));
  return{candidates,canChooseDirectory:this.#proposals.length>0,notices:[...new Set(notices)],configPath:this.#configPath};
 }
 async inspectDirectory(directory){
  if(!this.#context)await this.inspect();await this.#unchanged();directory=normalizeDataLocationPath(directory);
  const matches=this.#proposals.filter(proposal=>samePath(proposal.config.dataDirectory,directory));
  if(!matches.length)fail('所选目录与可验证的历史记录不匹配，不能猜测原runtime或草稿锚点。');
  if(matches.length>1)fail('多条历史记录具有不同本机设置锚点，请明确选择对应候选。');
  return this.#candidate(matches[0]);
 }
 async recover({token,confirmed=false}={}){
  if(confirmed!==true)return{canceled:true};
  const candidate=typeof token==='string'?this.#tokens.get(token):null;if(!candidate||Date.now()>candidate.expires)fail('请先预检并明确选择要重连的资料库。');
  if(this.#busy)fail('已有资料位置恢复正在进行。');this.#busy=true;let pointerLease,targetSession,temporary=null,rescueFileName=null;const otherSessions=[];
  try{
   pointerLease=await acquireDataLocationPointerSession(this.#configPath,{acquireSession:this.#acquire});await this.#unchanged();
   // A normal window may still use a different historical proposal. Hold every
   // provable existing library without reading its contents, before moving the
   // shared pointer away from it. Missing old copies require no new directory.
   const known=[...new Set(this.#proposals.map(proposal=>proposal.config.dataDirectory))].sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase())),heldPaths=[];
   for(const directory of known){
    if(heldPaths.some(value=>samePath(value,directory)))continue;
    const present=await assertDataLocationDirectory(directory);if(!present){if(samePath(directory,candidate.proposal.config.dataDirectory))fail('所选资料目录已不存在。');continue;}
    const session=await this.#acquire({directory});heldPaths.push(directory);
    if(samePath(directory,candidate.proposal.config.dataDirectory))targetSession=session;else otherSessions.push({directory,session});
   }
   if(!targetSession)fail('所选资料库会话未建立。');
   return await runWithLibrarySession(pointerLease.session,pointerLease.directory,()=>runWithLibrarySession(targetSession,candidate.proposal.config.dataDirectory,async()=>{
    await this.#unchanged();await this.#verifyCandidate(candidate);await this.#fault('before-write');await this.#unchanged();await this.#verifyCandidate(candidate);
    const parent=path.dirname(this.#configPath);await mkdir(parent,{recursive:true});await assertDataLocationDirectory(parent,{required:true});
    const old=this.#context.artifacts[0].read,payload=candidate.proposal.bytes;
    if(old&&!old.bytes.equals(payload)){
     rescueFileName='.slr-'+randomUUID().slice(0,8)+'.bin';const rescue=path.join(parent,rescueFileName);await writeExclusive(rescue,old.bytes);if(!(await readDataLocationFile(rescue,16384)).bytes.equals(old.bytes))fail('损坏配置原件救援副本校验失败，未更新位置。');await this.#fault('rescue-written');
    }
    temporary=path.join(parent,'.srt-'+randomUUID().slice(0,8)+'.tmp');await writeExclusive(temporary,payload);
    await this.#fault('before-publish');await this.#unchanged();await this.#verifyCandidate(candidate);
    assertLibrarySession(pointerLease.session,pointerLease.directory);assertLibrarySession(targetSession,candidate.proposal.config.dataDirectory);for(const held of otherSessions)assertLibrarySession(held.session,held.directory);
    await rename(temporary,this.#configPath);temporary=null;
    const saved=await readDataLocationFile(this.#configPath,16384);if(!saved.bytes.equals(payload))fail('位置写入后校验失败，请保留原件并重新打开软件核对。');for(const held of otherSessions)assertLibrarySession(held.session,held.directory);
    this.#tokens.clear();const config=candidate.proposal.config;return{canceled:false,configPath:this.#configPath,rescueFileName,location:{...config,configPath:this.#configPath,isOverride:false,customDataDirectory:true}};
   }));
  }finally{if(temporary)await unlink(temporary).catch(()=>{});await targetSession?.release().catch(()=>{});for(const held of otherSessions.reverse())await held.session.release().catch(()=>{});await pointerLease?.session.release().catch(()=>{});this.#busy=false;}
 }
 async #verifyCandidate(candidate){
  const {config}=candidate.proposal,draft=objectId(await assertDataLocationDirectory(config.draftScopeDirectory,{required:true})),runtime=objectId(await assertDataLocationDirectory(config.runtimeDirectory,{required:true})),library=await inspectExistingDataLibrary(config.dataDirectory,{installDirectory:this.#install});
  if(hash(JSON.stringify({library:library.signature,draft,runtime}))!==candidate.signature)fail('资料或本机设置目录在预检后已变化，请重新检查。');
 }
}
