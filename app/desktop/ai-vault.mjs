import {readFile,writeFile,mkdir,rename,lstat} from 'node:fs/promises';
import path from 'node:path';import {randomUUID} from 'node:crypto';
import {normalizeAiConfig} from './ai-config.mjs';

export class AiVault {
  #directory;#file;#crypto;#config=normalizeAiConfig();#secret='';#remember=false;#canPersist=false;#notice='';#initializing;#queue=Promise.resolve();
  constructor(directory,encryption){this.#directory=directory;this.#file=path.join(directory,'ai-credentials.json');this.#crypto=encryption;}
  async #initialize(){
    if(this.#initializing)return this.#initializing;
    this.#initializing=(async()=>{
      this.#canPersist=await this.#crypto.isAsyncEncryptionAvailable().catch(()=>false);
      try{
        const info=await lstat(this.#file);if(!info.isFile()||info.isSymbolicLink()||info.size>32768)throw Error('invalid');
        const record=JSON.parse(await readFile(this.#file,'utf8'));this.#config=normalizeAiConfig(record.config);
        if(record.encryptedKey&&this.#canPersist){const decrypted=await this.#crypto.decryptStringAsync(Buffer.from(record.encryptedKey,'base64'));const stored=JSON.parse(decrypted.result);if(record.version!==2||stored.provider!==this.#config.provider||stored.baseUrl!==this.#config.baseUrl||typeof stored.key!=='string'||!/^[\x21-\x7e]{8,512}$/u.test(stored.key))throw Error('credential binding');this.#secret=stored.key;this.#remember=true;}
        else if(record.encryptedKey)this.#notice='本机加密暂不可用，请重新填写Key，仅本次使用。';
      }catch(error){if(error.code!=='ENOENT')this.#notice='AI设置未能读取，原文件已保留；重新保存设置可替换它。';}
    })();return this.#initializing;
  }
  async status(){await this.#initialize();return{...this.#config,keyPresent:Boolean(this.#secret),rememberKey:this.#remember,canPersist:this.#canPersist,...(this.#notice?{notice:this.#notice}:{})};}
  async getSecret(){await this.#initialize();return this.#secret;}
  configure(input={}){
    const task=this.#queue.then(async()=>{
      await this.#initialize();
      const config=normalizeAiConfig({...this.#config,...input});
      if(input.key!==undefined&&(typeof input.key!=='string'||input.key.length>512||input.key&&(!/^[\x21-\x7e]{8,512}$/u.test(input.key))))throw new Error('API Key格式无效，请检查是否有空格或换行。');
      const changed=config.provider!==this.#config.provider||config.baseUrl!==this.#config.baseUrl;
      const key=input.clearKey?'':input.key||(!changed?this.#secret:'');
      const remember=Boolean((input.rememberKey??this.#remember)&&this.#canPersist&&key);
      const record={version:2,config};
      if(remember){try{record.encryptedKey=(await this.#crypto.encryptStringAsync(JSON.stringify({key,provider:config.provider,baseUrl:config.baseUrl}))).toString('base64');}catch{throw new Error('Key未能安全加密，旧设置保留；可选择仅本次使用。');}}
      await mkdir(this.#directory,{recursive:true});
      try{const info=await lstat(this.#file);if(!info.isFile()||info.isSymbolicLink())throw new Error('AI设置路径无效，未写入。');}catch(error){if(error.code!=='ENOENT')throw error;}
      const temporary=this.#file+'.'+randomUUID()+'.tmp';
      try{await writeFile(temporary,JSON.stringify(record),{flag:'wx',mode:0o600});await rename(temporary,this.#file);}catch{throw new Error('AI设置未能保存，原有配置保留。');}
      this.#config=config;this.#secret=key;this.#remember=remember;this.#notice='';return this.status();
    });this.#queue=task.catch(()=>{});return task;
  }
}
