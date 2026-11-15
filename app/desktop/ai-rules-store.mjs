import {readFile,writeFile,mkdir,rename,lstat,realpath,unlink,copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {AI_RULE_ACTIONS,getDefaultAiRulePreferences,normalizeAiRulePreferences} from '../core/ai-rule-preferences.mjs';
const credentialLike=/\b(?:sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/-]{16,})/u;
export class AiRulesStore {
 #directory;#file;#preferences=getDefaultAiRulePreferences();#notice='';#initializing;#queue=Promise.resolve();#damaged=false;#isBusy;#getSecret;
 constructor(directory,{isBusy=()=>false,getSecret=async()=>''}={}){this.#directory=path.resolve(directory);this.#file=path.join(this.#directory,'ai-rules.json');this.#isBusy=isBusy;this.#getSecret=getSecret;}
 async #checkDirectory(create=false){
  try{const info=await lstat(this.#directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('invalid');}
  catch(error){if(error.code!=='ENOENT')throw new Error('AI规则目录路径无效，未写入。');if(!create)return false;await mkdir(this.#directory,{recursive:true});}
  const info=await lstat(this.#directory);if(!info.isDirectory()||info.isSymbolicLink()||await realpath(this.#directory)!==path.join(await realpath(path.dirname(this.#directory)),path.basename(this.#directory)))throw new Error('AI规则目录路径无效，未写入。');return true;
 }
 async #fileInfo(){try{const info=await lstat(this.#file);if(!info.isFile()||info.isSymbolicLink())throw new Error('AI规则文件路径无效，未写入。');return info;}catch(error){if(error.code==='ENOENT')return null;throw error;}}
 async #guardSecrets(preferences){const serialized=JSON.stringify(preferences),secret=await this.#getSecret();if(credentialLike.test(serialized)||secret&&serialized.includes(secret))throw new Error('AI规则中不能填写API Key或访问令牌，请移除后再保存。');}
 async #initialize(){
  if(this.#initializing)return this.#initializing;
  this.#initializing=(async()=>{try{if(!await this.#checkDirectory())return;const info=await this.#fileInfo();if(!info)return;if(info.size>200000)throw Error('large');const record=JSON.parse(await readFile(this.#file,'utf8'));if(record?.version!==1||!Object.hasOwn(record,'general')||!record.actions||AI_RULE_ACTIONS.some(action=>!Object.hasOwn(record.actions,action)))throw Error('incomplete');const prefs=normalizeAiRulePreferences(record);await this.#guardSecrets(prefs);this.#preferences=prefs;}
   catch{this.#damaged=true;this.#notice='AI规则未能读取，原文件已保留，当前使用默认规则。重新保存有效规则时会另存原文件。';}
  })();return this.#initializing;
 }
 #snapshot(){return {preferences:normalizeAiRulePreferences(this.#preferences),...(this.#notice?{notice:this.#notice}:{})};}
 async status(){await this.#queue;await this.#initialize();return this.#snapshot();}
 configure(input){
  const task=this.#queue.then(async()=>{
   if(this.#isBusy())throw new Error('请先取消正在进行的AI请求，再修改规则设置。');
   const preferences=normalizeAiRulePreferences(input);await this.#guardSecrets(preferences);await this.#initialize();
   if(this.#isBusy())throw new Error('请等待AI请求完成或取消后再修改规则设置。');
   await this.#checkDirectory(true);const info=await this.#fileInfo();const temporary=this.#file+'.'+randomUUID()+'.tmp';
   try{
    await writeFile(temporary,JSON.stringify(preferences),{flag:'wx',mode:0o600});
    // A user explicitly replacing unreadable settings still keeps the original bytes for recovery.
    if(this.#damaged&&info)await copyFile(this.#file,path.join(this.#directory,'ai-rules.invalid-'+Date.now()+'-'+randomUUID()+'.json'),constants.COPYFILE_EXCL);
    await this.#fileInfo();await rename(temporary,this.#file);
   }catch{await unlink(temporary).catch(()=>{});throw new Error('AI规则未能保存，原有设置保留。');}
   this.#preferences=preferences;this.#notice='';this.#damaged=false;return this.#snapshot();
  });this.#queue=task.catch(()=>{});return task;
 }
}
