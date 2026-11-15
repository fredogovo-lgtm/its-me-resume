import {createAiTask,parseAiResult,getAiErrorMessage} from '../core/ai-tasks.mjs';
import {makeAiProviderRequest,readAiProviderResponse} from './ai-provider.mjs';
const safe=(message,code)=>Object.assign(new Error((code?code+': ':'')+message),{publicAiError:true,...(code?{code}:{})});
const providerErrorCodes={400:'AI_PROVIDER_PARAMETERS',401:'AI_AUTH',402:'AI_BALANCE',422:'AI_PROVIDER_PARAMETERS',429:'AI_RATE_LIMIT',500:'AI_PROVIDER_SERVICE',503:'AI_PROVIDER_SERVICE'};
const errorMessages={400:'请求格式不被服务支持，请检查模型与兼容接口。',401:'API Key无效，请在设置中更新。',402:'API账户余额不足，请自行检查服务账户。',422:'模型或参数不受支持，请检查设置。',429:'请求过于频繁，请稍后手动重试。',500:'AI服务暂时出错，请稍后手动重试。',503:'AI服务繁忙，请稍后手动重试。'};
async function limitedBody(response){
  if(Number(response.headers.get('content-length'))>262144)throw safe('AI返回内容过大，已停止处理。');
  const reader=response.body?.getReader();if(!reader)throw safe('AI未返回有效内容。');
  const pieces=[];let total=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>262144){await reader.cancel();throw safe('AI返回内容过大，已停止处理。');}pieces.push(value);}}finally{reader.releaseLock();}
  return Buffer.concat(pieces).toString('utf8');
}
export class AiService {
  #vault;#fetch;#timeout;#active=null;#structuredResponses;#rulesStore;
  constructor(vault,{fetchImpl=globalThis.fetch,timeoutMs=60000,structuredResponses=true,rulesStore}={}){this.#vault=vault;this.#fetch=fetchImpl;this.#timeout=timeoutMs;this.#structuredResponses=structuredResponses;this.#rulesStore=rulesStore;}
  get busy(){return Boolean(this.#active);}
  cancel(id){if(this.#active?.id!==id)return false;this.#active.cancelled=true;this.#active.controller.abort();return true;}
  cancelAll(){if(this.#active)this.cancel(this.#active.id);}
  async generate({id,task:input}={}){
    if(this.#active)throw safe('已有AI请求正在进行，请先取消或等待完成。');
    if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/u.test(id))throw safe('AI请求编号无效。');
    const task=createAiTask(input),active={id,controller:new AbortController(),cancelled:false,timedOut:false};this.#active=active;
    const timer=setTimeout(()=>{active.timedOut=true;active.controller.abort();},this.#timeout);
    try{
      const config=await this.#vault.status(),key=await this.#vault.getSecret();
      if(!key)throw safe('请先在设置中填写自己的API Key。');
      if(active.controller.signal.aborted)throw safe('本次AI请求已取消。');
      let rulePreferences;try{if(this.#rulesStore){const rules=await this.#rulesStore.status();if(rules.notice)throw Error('unreadable');rulePreferences=rules.preferences;}}catch{throw safe('AI规则未能读取，本次未发送，请到设置中检查并保存后重试。');}
      if(active.controller.signal.aborted)throw safe('本次AI请求已取消。');
      const request=makeAiProviderRequest(config,task,{structuredResponses:this.#structuredResponses,rulePreferences}),payload=request.body;
      if(JSON.stringify(payload).includes(key))throw safe('本次文字包含已配置凭据，已停止发送，请先移除敏感信息。');
      const response=await this.#fetch(request.url,{method:'POST',redirect:'manual',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify(payload),signal:active.controller.signal});
      if(active.controller.signal.aborted)throw safe('本次AI请求已取消。');
      if(!response.ok){await response.body?.cancel().catch(()=>{});throw safe(errorMessages[response.status]||(response.status>=300&&response.status<400?'API地址发生重定向，为保护Key已停止请求，请核对服务地址。':'AI服务未接受请求，请核对服务与模型设置。'),providerErrorCodes[response.status]);}
      const raw=await limitedBody(response);let envelope;try{envelope=JSON.parse(raw);}catch{throw safe('AI返回格式无效，原文未修改。');}
      if(active.controller.signal.aborted)throw safe('本次AI请求已取消。');
      const decoded=readAiProviderResponse(request.kind,envelope),content=decoded.content,finish=decoded.finish;
      if(finish==='length')throw safe('AI返回内容达到输出长度上限，原文未修改。请缩小到单个模块或选区后重新生成。');
      if(finish==='content_filter')throw safe('AI服务因内容规则未生成结果，原文未修改。请检查本次文字后再发送。');
      if(finish!=='stop')throw safe('AI返回内容不完整，原文未修改；可稍后手动重试。');
      if(typeof content==='string'&&!content.trim())throw safe('AI返回空白结果，原文未修改。请补充要求或缩小处理范围后重新发送。');
      if(typeof content!=='string'||content.includes(key))throw safe('AI返回内容无效，原文未修改。');
      let result;try{result=parseAiResult(task,content);}catch(error){const known=new Set(['AI_EMPTY','AI_JSON','AI_TRUNCATED','AI_REQUIRED','AI_TYPE','AI_STRUCTURE','AI_PROTOCOL','AI_READ_ONLY','AI_TARGET','AI_FIELD','AI_DUPLICATE','AI_SOURCE','AI_CONSTRAINT','AI_LIMIT','AI_INVALID']);const code=known.has(error.code)?error.code:/缺少必要字段/u.test(error.message)?'AI_REQUIRED':'AI_STRUCTURE';throw safe('AI返回结果：'+getAiErrorMessage(code)+'原文未修改。',code);}
      const containsSecret=value=>typeof value==='string'?value.includes(key):Array.isArray(value)?value.some(containsSecret):value&&typeof value==='object'?Object.values(value).some(containsSecret):false;
      if(containsSecret(result))throw safe('AI返回内容无效，原文未修改。');
      return {...result,...(decoded.usage?{usage:decoded.usage}:{})};
    }catch(error){if(active.timedOut)throw safe('AI请求超时，原文未修改；可稍后手动重试。','AI_TIMEOUT');if(active.cancelled)throw safe('本次AI请求已取消。');if(error.publicAiError)throw error;throw safe('AI网络连接失败，原文未修改。请检查网络或服务地址。','AI_NETWORK');}
    finally{clearTimeout(timer);if(this.#active===active)this.#active=null;}
  }
}
