// Library-bound offline licenses. Public verification only; no device, cloud, or private signing key.
import {createHash,randomUUID,verify} from 'node:crypto';
import {constants as fsConstants} from 'node:fs';
import {lstat,mkdir,open,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {validateLicensePolicy} from './offline-license.mjs';
import {assertLibrarySession,runWithLibrarySession} from './library-session.mjs';

export const LIBRARY_LICENSE_FILE='library-license.json';
const MAX_BYTES=65536,PRODUCT='its-me',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,ID=/^[a-zA-Z0-9_-]{1,120}$/u;
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const invalid=()=>Error('资料库授权记录或文件格式无效，原文件已保留。');
function exact(v,fields){if(!plain(v)||Object.getOwnPropertySymbols(v).length||Object.keys(v).length!==fields.length||fields.some(k=>!Object.hasOwn(v,k)))throw invalid();}
const validId=v=>typeof v==='string'&&ID.test(v);
const validUuid=v=>typeof v==='string'&&UUID.test(v);
function validIso(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;}
function signature(v){if(typeof v!=='string'||!/^[A-Za-z0-9_-]{86}$/u.test(v))return false;const bytes=Buffer.from(v,'base64url');return bytes.length===64&&bytes.toString('base64url')===v;}
export function canonicalLibraryLicensePayload(payload){
 exact(payload,['product','licenseId','libraryId','issuedAt','generation','rights']);
 if(payload.product!==PRODUCT||!validId(payload.licenseId)||!validUuid(payload.libraryId)||!validIso(payload.issuedAt)||!Number.isSafeInteger(payload.generation)||payload.generation<1||payload.generation>1000000||!Array.isArray(payload.rights)||payload.rights.length!==1||payload.rights[0]!=='desktop')throw invalid();
 return JSON.stringify({product:PRODUCT,licenseId:payload.licenseId,libraryId:payload.libraryId,issuedAt:payload.issuedAt,generation:payload.generation,rights:['desktop']});
}
function validateEnvelope(envelope){
 exact(envelope,['format','version','keyId','payload','signature']);
 if(envelope.format!=='itsme-offline-license'||envelope.version!==2||typeof envelope.keyId!=='string'||!/^[a-f0-9]{24}$/u.test(envelope.keyId)||!signature(envelope.signature))throw invalid();
 canonicalLibraryLicensePayload(envelope.payload);return envelope;
}
export function verifyLibraryLicense(envelope,{libraryId,keys}={}){
 validateEnvelope(envelope);if(!validUuid(libraryId))throw invalid();
 if(envelope.payload.libraryId!==libraryId)throw Error('这份授权属于另一个资料库，未替换当前资料库标识或授权。');
 try{validateLicensePolicy({mode:'licensed',keys});}catch{throw Error('资料库授权验证公钥无效，请使用作者提供的完整软件。');}
 const issuer=keys.find(key=>key.keyId===envelope.keyId);if(!issuer)throw Error('资料库授权的签发者无法识别，请联系作者。');
 try{if(!verify(null,Buffer.from(canonicalLibraryLicensePayload(envelope.payload),'utf8'),issuer.publicKey,Buffer.from(envelope.signature,'base64url')))throw Error();}
 catch{throw Error('资料库授权签名无效，请使用作者签发的原始授权文件。');}
 return structuredClone(envelope.payload);
}
export function validateLibraryActivationRequest(value){
 exact(value,['format','version','product','requestId','libraryId','createdAt']);
 if(value.format!=='itsme-activation-request'||value.version!==2||value.product!==PRODUCT||!validId(value.requestId)||!validUuid(value.libraryId)||!validIso(value.createdAt))throw invalid();
 return value;
}
/** Structural backup check only. This never authenticates an issuer or grants editing rights. */
export function validateLibraryLicenseRecord(value){
 exact(value,['format','version','libraryId','createdAt','license']);
 if(value.format!=='itsme-library-identity'||value.version!==1||!validUuid(value.libraryId)||!validIso(value.createdAt))throw invalid();
 if(value.license!==null){validateEnvelope(value.license);if(value.license.payload.libraryId!==value.libraryId)throw invalid();}
 return value;
}
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const sameSnapshot=(a,b)=>sameFile(a,b)&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
const ordinaryFile=s=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1;
const decodeRecord=bytes=>validateLibraryLicenseRecord(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
const recoveryProblem=(message,code='LIBRARY_IDENTITY_RECOVERY_UNAVAILABLE')=>Object.assign(Error(message),{code});
const readProblem=()=>Error('资料库授权记录缺失、损坏或无法读取；可查看资料并从完整备份恢复，原文件不会自动重建或覆盖。');
const uncertainProblem=()=>Error('资料库授权保存结果无法确认，本次保持只读；请先保留资料并重新打开软件核对。');

export class LibraryLicenseStore{
 #directory;#file;#policy;#session;#recoveryStep;#queue=Promise.resolve();#observedRecord=false;#initialized=false;#uncertain=false;
 constructor({directory,policy,session,onRecoveryStep=()=>{}}={}){
  if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('资料库授权目录必须是绝对路径。');
  try{validateLicensePolicy(policy);}catch{throw Error('资料库授权验证配置无效。');}
  if(session!==undefined)assertLibrarySession(session,directory);this.#session=session;
  if(typeof onRecoveryStep!=='function')throw Error('资料库身份恢复参数无效。');this.#recoveryStep=onRecoveryStep;
  this.#directory=path.resolve(directory);this.#file=path.join(this.#directory,LIBRARY_LICENSE_FILE);this.#policy=structuredClone(policy);
 }
 #transaction(fn){const task=this.#session!==undefined?runWithLibrarySession(this.#session,this.#directory,fn):this.#queue.then(fn);this.#queue=task.catch(()=>{});return task;}
 async #directoryInfo(create=false){
  const parsed=path.parse(this.#directory);let current=parsed.root;
  for(const component of this.#directory.slice(parsed.root.length).split(path.sep).filter(Boolean)){
   current=path.join(current,component);let info;
   try{info=await lstat(current);}catch(e){
    if(e.code!=='ENOENT')throw readProblem();if(!create)return false;
    try{await mkdir(current);}catch(error){if(error.code!=='EEXIST')throw readProblem();}
    info=await lstat(current);
   }
   if(!info.isDirectory()||info.isSymbolicLink())throw readProblem();
  }
  return true;
 }
 async #raw(file=this.#file){
  let handle;
  try{
   if(!await this.#directoryInfo())return null;
   let before;try{before=await lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}
   if(file===this.#file)this.#observedRecord=true;
   if(!ordinaryFile(before)||before.size>MAX_BYTES)throw invalid();
   handle=await open(file,fsConstants.O_RDONLY|(fsConstants.O_NOFOLLOW??0));const opened=await handle.stat();
   if(!ordinaryFile(opened)||!sameSnapshot(before,opened))throw invalid();
   const bytes=Buffer.alloc(opened.size);let offset=0;
   while(offset<bytes.length){const result=await handle.read(bytes,offset,bytes.length-offset,offset);if(!result.bytesRead)break;offset+=result.bytesRead;}
   const tail=await handle.read(Buffer.alloc(1),0,1,bytes.length),after=await handle.stat(),current=await lstat(file);
   if(offset!==bytes.length||tail.bytesRead||!ordinaryFile(current)||!sameSnapshot(opened,after)||!sameSnapshot(opened,current))throw invalid();
   if(!await this.#directoryInfo())throw invalid();
   return{bytes,stat:current};
  }catch{throw readProblem();}finally{await handle?.close().catch(()=>{});}
 }
 async #read(){try{const value=await this.#raw();return value?{record:decodeRecord(value.bytes),bytes:value.bytes}:null;}catch{throw readProblem();}}
 async #withLock(operation,createDirectory=true){
  if(!await this.#directoryInfo(createDirectory))throw readProblem();
  if(this.#session!==undefined){assertLibrarySession(this.#session,this.#directory);return operation();}
  const lock=path.join(this.#directory,'.library-license.lock');let handle,created;
  try{
   try{handle=await open(lock,'wx',0o600);created=await handle.stat();}catch{throw Error('资料库授权正由另一项操作处理；请稍后重试，异常锁不会自动删除。');}
   return await operation();
  }finally{
   await handle?.close().catch(()=>{});
   if(created){try{const current=await lstat(lock);if(ordinaryFile(current)&&sameFile(current,created))await unlink(lock);}catch{}}
  }
 }
 async #publish(record,previous,recovery){
  validateLibraryLicenseRecord(record);if(this.#uncertain)throw uncertainProblem();
  const bytes=Buffer.from(JSON.stringify(record),'utf8');if(bytes.length>MAX_BYTES)throw invalid();
  const temporary=path.join(this.#directory,'.library-license-'+randomUUID()+'.tmp');let handle,published=false;
  try{
   handle=await open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
   if(recovery)await this.#recoveryStep('recovery-temp-written');
   const current=recovery?await this.#assertRecoverySnapshot(recovery):await this.#read();
   if(previous===null?current!==null:current===null||!current.bytes.equals(previous.bytes))throw Error('资料库授权记录已变化，未覆盖；请重新打开后重试。');
   await rename(temporary,this.#file);published=true;
   if(recovery)await this.#recoveryStep('identity-published');
   const checked=await this.#read();if(!checked||!checked.bytes.equals(bytes))throw uncertainProblem();
   this.#initialized=true;return checked.record;
  }catch(error){if(published){this.#uncertain=true;throw uncertainProblem();}throw error;}
  finally{await handle?.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
 }
 #statusFor(record,error){
  const base={mode:this.#policy.mode,active:false,binding:'library',libraryId:record?.libraryId??null,licenseId:null,hasLibraryIdentity:Boolean(record),canRecoverIdentity:false};
  if(this.#policy.mode==='development')return{...base,active:true,notice:'开发验证版本，未施加商业授权限制；不得作为付费商业包分发。'};
  if(this.#uncertain)return{...base,notice:uncertainProblem().message};
  if(error)return{...base,notice:readProblem().message};
  if(!record)return{...base,notice:'资料库授权标识缺失，可以查看和备份资料；请恢复完整资料库或联系作者，未自动补建授权。'};
  if(!record.license)return{...base,notice:'资料库尚未授权，可以查看和备份资料；导入对应资料库授权后才能编辑和导出。'};
  try{const p=verifyLibraryLicense(record.license,{libraryId:record.libraryId,keys:this.#policy.keys});return{...base,active:true,licenseId:p.licenseId,generation:p.generation,notice:'此资料库已授权，可离线编辑和导出；完整备份包含授权，换机可随资料库一起恢复。'};}
  catch{return{...base,notice:'资料库授权未通过验证，可以查看和备份资料；请导入作者签发的对应授权或恢复完整备份。'};}
 }
 async initialize(){return this.#transaction(async()=>{
  if(this.#uncertain)throw uncertainProblem();
  const existing=await this.#read();if(existing){this.#initialized=true;return this.#statusFor(existing.record);}
  if(this.#initialized||this.#observedRecord)throw readProblem();
  return this.#withLock(async()=>{
   const found=await this.#read();if(found){this.#initialized=true;return this.#statusFor(found.record);}
   if(this.#initialized||this.#observedRecord)throw readProblem();
   const record={format:'itsme-library-identity',version:1,libraryId:randomUUID(),createdAt:new Date().toISOString(),license:null};
   return this.#statusFor(await this.#publish(record,null));
  });
 });}
 async status(){
  try{const value=await this.#raw();if(!value)return{...this.#statusFor(null),canRecoverIdentity:!this.#uncertain&&await this.#directoryInfo()};
   let record;try{record=decodeRecord(value.bytes);}catch{return{...this.#statusFor(null,true),canRecoverIdentity:!this.#uncertain};}return this.#statusFor(record);
  }catch{return this.#statusFor(null,true);}
 }
 async #recoveryCandidate(){
  if(this.#uncertain)throw uncertainProblem();if(!await this.#directoryInfo())throw readProblem();const directoryStat=await lstat(this.#directory),original=await this.#raw();
  if(!sameFile(directoryStat,await lstat(this.#directory)))throw readProblem();
  if(original){let valid=true;try{decodeRecord(original.bytes);}catch{valid=false;}if(valid)throw recoveryProblem('资料库身份仍可读取，无需重建；请导出原资料库的授权申请。');}
  return{directoryStat,original};
 }
 async #assertRecoverySnapshot(candidate){
  if(!await this.#directoryInfo()||!sameFile(await lstat(this.#directory),candidate.directoryStat))throw recoveryProblem('资料库目录已变化，身份未重建。','LIBRARY_IDENTITY_CHANGED');
  const current=await this.#raw(),previous=candidate.original;
  if(previous===null?current!==null:current===null||!sameSnapshot(current.stat,previous.stat)||!current.bytes.equals(previous.bytes))throw recoveryProblem('原身份记录已变化，未覆盖；请重新核对后重试。','LIBRARY_IDENTITY_CHANGED');
  return current;
 }
 async recoverIdentity(){return this.#transaction(async()=>{
  let rescueFileName=null;
  try{
   const candidate=await this.#recoveryCandidate();await this.#recoveryStep('candidate-read');
   return await this.#withLock(async()=>{
    await this.#assertRecoverySnapshot(candidate);
    if(candidate.original){
     const digest=createHash('sha256').update(candidate.original.bytes).digest('hex'),name='.rescue-library-license-'+randomUUID()+'-'+digest+'.bin';await this.#recoveryStep('before-rescue-write',name);
     let handle,created;try{handle=await open(path.join(this.#directory,name),'wx',0o600);created=await handle.stat();await handle.writeFile(candidate.original.bytes);await handle.sync();}finally{await handle?.close();}
     const saved=await this.#raw(path.join(this.#directory,name));if(!saved||!sameFile(saved.stat,created)||!saved.bytes.equals(candidate.original.bytes)||createHash('sha256').update(saved.bytes).digest('hex')!==digest)throw readProblem();
     rescueFileName=name;await this.#recoveryStep('rescue-written',name);
    }
    const next={format:'itsme-library-identity',version:1,libraryId:randomUUID(),createdAt:new Date().toISOString(),license:null},saved=await this.#publish(next,candidate.original,candidate);
    return{status:this.#statusFor(saved),request:validateLibraryActivationRequest({format:'itsme-activation-request',version:2,product:PRODUCT,requestId:randomUUID(),libraryId:saved.libraryId,createdAt:new Date().toISOString()}),rescueFileName};
   },false);
  }catch(error){
   const safe=this.#uncertain?uncertainProblem():typeof error?.code==='string'&&error.code.startsWith('LIBRARY_IDENTITY_')?error:recoveryProblem('资料库身份重建未完成，原资料未改动；请保留现有文件并重试或联系作者。','LIBRARY_IDENTITY_RECOVERY_FAILED');
   if(this.#uncertain)safe.code='LIBRARY_IDENTITY_UNCERTAIN';safe.rescueFileName=rescueFileName;throw safe;
  }
 });}
 async request(){
  if(this.#uncertain)throw uncertainProblem();const value=await this.#read();if(!value)throw readProblem();
  return validateLibraryActivationRequest({format:'itsme-activation-request',version:2,product:PRODUCT,requestId:randomUUID(),libraryId:value.record.libraryId,createdAt:new Date().toISOString()});
 }
 async activate(license){const snapshot=structuredClone(license);return this.#transaction(async()=>{
  if(this.#uncertain)throw uncertainProblem();const before=await this.#read();if(!before)throw readProblem();
  verifyLibraryLicense(snapshot,{libraryId:before.record.libraryId,keys:this.#policy.keys});
  return this.#withLock(async()=>{
   const current=await this.#read();if(!current||!current.bytes.equals(before.bytes))throw Error('资料库授权记录已变化，未导入；请重试。');
   verifyLibraryLicense(snapshot,{libraryId:current.record.libraryId,keys:this.#policy.keys});
   const record={...current.record,license:snapshot};
   if(JSON.stringify(current.record)===JSON.stringify(record))return this.#statusFor(current.record);
   return this.#statusFor(await this.#publish(record,current));
  });
 });}
 async requireActive(){if(!(await this.status()).active)throw Error('请先导入此资料库的有效授权。未授权时可查看和备份，不能编辑或导出。');}
}
