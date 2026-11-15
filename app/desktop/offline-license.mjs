// Public-key offline licenses. No private signing key is shipped in the application.
import {createHash,createPublicKey,verify,randomUUID} from 'node:crypto';
import{readFile,writeFile,rename,mkdir,lstat}from'node:fs/promises';import path from'node:path';
const PRODUCT='its-me',HEX=/^[a-f0-9]{64}$/u,ID=/^[a-zA-Z0-9_-]{1,120}$/u;
const plain=o=>o&&typeof o==='object'&&!Array.isArray(o)&&[Object.prototype,null].includes(Object.getPrototypeOf(o));
function exact(o,fields){if(!plain(o)||Object.keys(o).length!==fields.length||fields.some(k=>!Object.hasOwn(o,k)))throw Error('授权文件字段无效。');}
const iso=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(s)&&Number.isFinite(Date.parse(s));
export function createDeviceId({machineGuid,systemUuid}){
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
 if(!uuid.test(machineGuid)||!uuid.test(systemUuid)||/^0{8}-/u.test(systemUuid)||/^f{8}-/iu.test(systemUuid))throw Error('本机设备标识未能读取，请联系作者协助恢复授权。');
 return createHash('sha256').update('ITS-ME/OFFLINE-DEVICE/v1\0'+machineGuid.toLowerCase()+'\0'+systemUuid.toLowerCase()).digest('hex');
}
export function canonicalLicensePayload(payload){
 exact(payload,['product','licenseId','deviceId','issuedAt','generation','rights']);
 if(payload.product!==PRODUCT||typeof payload.licenseId!=='string'||!ID.test(payload.licenseId)||typeof payload.deviceId!=='string'||!HEX.test(payload.deviceId)||!iso(payload.issuedAt)||!Number.isSafeInteger(payload.generation)||payload.generation<1||payload.generation>1000000||!Array.isArray(payload.rights)||payload.rights.length!==1||payload.rights[0]!=='desktop')throw Error('授权文件内容无效。');
 return JSON.stringify({product:PRODUCT,licenseId:payload.licenseId,deviceId:payload.deviceId,issuedAt:payload.issuedAt,generation:payload.generation,rights:['desktop']});
}
export function validateLicensePolicy(policy){
 if(!plain(policy)||!['development','licensed','free'].includes(policy.mode)||!Array.isArray(policy.keys)||policy.keys.length>16||policy.mode==='licensed'&&!policy.keys.length||policy.mode==='free'&&policy.keys.length!==0)throw Error('授权验证配置无效，请重新安装作者提供的完整程序。');
 const ids=new Set();for(const k of policy.keys){exact(k,['keyId','publicKey']);if(typeof k.keyId!=='string'||!/^[a-f0-9]{24}$/u.test(k.keyId)||typeof k.publicKey!=='string'||k.publicKey.length>2048||ids.has(k.keyId))throw Error('授权验证公钥无效。');const pub=createPublicKey(k.publicKey);if(pub.asymmetricKeyType!=='ed25519'||createHash('sha256').update(pub.export({type:'spki',format:'pem'})).digest('hex').slice(0,24)!==k.keyId)throw Error('授权验证公钥不匹配。');ids.add(k.keyId);}return policy;
}
export function resolveLicensePolicy(policy,{isPackaged=false}={}){if(typeof isPackaged!=='boolean')throw Error('授权运行环境无效。');validateLicensePolicy(policy);return validateLicensePolicy({...structuredClone(policy),mode:policy.mode==='free'?'free':isPackaged?'licensed':policy.mode});}
export function verifyLicense(envelope,{deviceId,keys}){
 exact(envelope,['format','version','keyId','payload','signature']);if(envelope.format!=='itsme-offline-license'||envelope.version!==1||typeof envelope.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/u.test(envelope.signature))throw Error('授权文件格式或签名无效。');
 const data=canonicalLicensePayload(envelope.payload),issuer=keys?.find(k=>k.keyId===envelope.keyId);if(!issuer)throw Error('授权文件的签发者无法识别，请联系作者。');
 try{if(!verify(null,Buffer.from(data),issuer.publicKey,Buffer.from(envelope.signature,'base64url')))throw Error('invalid');}catch{throw Error('授权文件签名无效，请使用作者签发的原始文件。');}
 if(envelope.payload.deviceId!==deviceId)throw Error('这份授权绑定了另一台设备。请在新电脑导出申请文件，凭原订单办理换机。');return structuredClone(envelope.payload);
}
export function validateActivationRequest(value){exact(value,['format','version','product','requestId','deviceId','createdAt']);if(value.format!=='itsme-activation-request'||value.version!==1||value.product!==PRODUCT||typeof value.requestId!=='string'||!ID.test(value.requestId)||typeof value.deviceId!=='string'||!HEX.test(value.deviceId)||!iso(value.createdAt))throw Error('激活申请无效。');return value;}
function validateReceipt(receipt){exact(receipt,['format','version','licenseId','generation','deviceId','deactivatedAt','notice']);if(receipt.format!=='itsme-deactivation-receipt'||receipt.version!==1||typeof receipt.licenseId!=='string'||!ID.test(receipt.licenseId)||!Number.isSafeInteger(receipt.generation)||receipt.generation<1||receipt.generation>1000000||typeof receipt.deviceId!=='string'||!HEX.test(receipt.deviceId)||!iso(receipt.deactivatedAt)||receipt.notice!=='本机已停用。离线凭证仅供作者核对，不能证明其它旧副本均已停用。')throw Error('停用记录无效。');return receipt;}
export class OfflineLicenseStore{
 #directory;#file;#deviceId;#policy;#queue=Promise.resolve();
 constructor({directory,deviceId,policy}){if(!path.isAbsolute(directory)||!HEX.test(deviceId))throw Error('本机授权目录或设备信息无效。');validateLicensePolicy(policy);this.#directory=directory;this.#file=path.join(directory,'license.json');this.#deviceId=deviceId;this.#policy=structuredClone(policy);}
 async #read(){try{const info=await lstat(this.#file);if(!info.isFile()||info.isSymbolicLink()||info.size>65536)throw Error('invalid');const value=JSON.parse(await readFile(this.#file,'utf8'));exact(value,Object.hasOwn(value,'deactivationReceipt')?['version','license','retired','deactivationReceipt']:['version','license','retired']);if(value.deactivationReceipt!=null)validateReceipt(value.deactivationReceipt);if(value.version!==1||!plain(value.retired)||Object.entries(value.retired).some(([id,g])=>!ID.test(id)||!Number.isSafeInteger(g)||g<1))throw Error('invalid');return value;}catch(e){if(e.code==='ENOENT')return{version:1,license:null,retired:{}};throw Error('本机授权记录损坏或无法读取，原文件已保留；可重新导入授权文件恢复。');}}
 async status(){
  if(this.#policy.mode==='development')return{mode:'development',active:true,licenseId:null,deviceId:this.#deviceId,hasDeactivationReceipt:false,notice:'开发验证版本，无商业激活限制；不得作为已付费激活的商业包发放。'};
  let hasDeactivationReceipt=false;
  try{const state=await this.#read();hasDeactivationReceipt=Boolean(state.deactivationReceipt?.deviceId===this.#deviceId);if(!state.license)return{mode:'licensed',active:false,licenseId:null,deviceId:this.#deviceId,hasDeactivationReceipt,notice:hasDeactivationReceipt?'此设备已停用，可查看和备份资料；可重导出最近停用记录，或联系作者补发授权。':'尚未激活，可查看和备份已有资料；导入本机授权文件后开始编辑。'};const p=verifyLicense(state.license,{deviceId:this.#deviceId,keys:this.#policy.keys});if((state.retired[p.licenseId]||0)>=p.generation)throw Error('这份授权已在本机停用，请联系作者补发。');return{mode:'licensed',active:true,licenseId:p.licenseId,generation:p.generation,deviceId:this.#deviceId,hasDeactivationReceipt,notice:'已激活，日常使用无需联网验证。'};}catch(e){return{mode:'licensed',active:false,licenseId:null,deviceId:this.#deviceId,hasDeactivationReceipt,notice:e.message};}
 }
 async requireActive(){if(!(await this.status()).active)throw Error('请先在设置中导入本机授权文件。已有资料与备份会保留。');}
 async request(){return validateActivationRequest({format:'itsme-activation-request',version:1,product:PRODUCT,requestId:randomUUID(),deviceId:this.#deviceId,createdAt:new Date().toISOString()});}
 async #write(state){await mkdir(this.#directory,{recursive:true});const info=await lstat(this.#directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('本机授权目录无效，未写入。');try{const old=await lstat(this.#file);if(!old.isFile()||old.isSymbolicLink())throw Error('授权记录路径无效。');}catch(e){if(e.code!=='ENOENT')throw e;}const temporary=this.#file+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(state),{flag:'wx',mode:0o600});await rename(temporary,this.#file);}
 #transaction(fn){const task=this.#queue.then(fn);this.#queue=task.catch(()=>{});return task;}
 activate(license){return this.#transaction(async()=>{const p=verifyLicense(license,{deviceId:this.#deviceId,keys:this.#policy.keys});let state;try{state=await this.#read();}catch{state={version:1,license:null,retired:{}};}if((state.retired[p.licenseId]||0)>=p.generation)throw Error('这份授权已在本机停用，请联系作者补发新版授权。');await this.#write({...state,license:structuredClone(license)});return this.status();});}
 async deactivationReceipt(){const state=await this.#read();if(!state.deactivationReceipt)throw Error('暂无可导出的停用记录。');validateReceipt(state.deactivationReceipt);if(state.deactivationReceipt.deviceId!==this.#deviceId)throw Error('这份停用记录属于另一台设备。');return structuredClone(state.deactivationReceipt);}
 deactivate(){return this.#transaction(async()=>{const state=await this.#read();if(!state.license)throw Error('当前没有可停用的授权。');const p=verifyLicense(state.license,{deviceId:this.#deviceId,keys:this.#policy.keys}),receipt=validateReceipt({format:'itsme-deactivation-receipt',version:1,licenseId:p.licenseId,generation:p.generation,deviceId:this.#deviceId,deactivatedAt:new Date().toISOString(),notice:'本机已停用。离线凭证仅供作者核对，不能证明其它旧副本均已停用。'});await this.#write({version:1,license:null,retired:{...state.retired,[p.licenseId]:Math.max(p.generation,state.retired[p.licenseId]||0)},deactivationReceipt:receipt});return structuredClone(receipt);});}
}
