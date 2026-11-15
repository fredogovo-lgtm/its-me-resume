export const DEFAULT_AI_CONFIG=Object.freeze({provider:'deepseek',baseUrl:'https://api.deepseek.com',model:'deepseek-flash'});
export function normalizeAiConfig(input={}) {
  const provider=input.provider??'deepseek';
  if(!['deepseek','custom'].includes(provider))throw new Error('请选择DeepSeek或兼容服务。');
  let baseUrl=provider==='deepseek'?DEFAULT_AI_CONFIG.baseUrl:input.baseUrl;
  if(typeof baseUrl!=='string'||baseUrl.length>500)throw new Error('API地址无效。');
  let url;try{url=new URL(baseUrl);}catch{throw new Error('请输入完整API地址。');}
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if((url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))||url.username||url.password||url.search||url.hash)throw new Error('API地址需使用HTTPS，仅本机服务可用HTTP；不要把Key写入地址。');
  baseUrl=url.href.replace(/\/+$/u,'');
  const model=typeof input.model==='string'?input.model.trim():DEFAULT_AI_CONFIG.model;
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/u.test(model))throw new Error('模型名称无效，请填写服务商提供的模型ID。');
  return {provider,baseUrl,model};
}
