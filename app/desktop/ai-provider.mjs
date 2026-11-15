import {createAiTask,buildAiMessages,getAiResponseSchema} from '../core/ai-tasks.mjs';
export function makeAiProviderRequest(config,input,{structuredResponses=false,rulePreferences}={}){
 const task=createAiTask(input),messages=buildAiMessages(task,{rulePreferences});
 if(structuredResponses&&task.protocolVersion===2&&!['role','select'].includes(task.action)&&config.provider==='deepseek'&&config.baseUrl==='https://api.deepseek.com')return {kind:'responses',url:config.baseUrl+'/responses',body:{model:config.model,input:messages,reasoning:{effort:'none'},max_output_tokens:8192,stream:false,tools:[],tool_choice:'none',text:{format:{type:'json_schema',name:'its_me_'+task.action,schema:getAiResponseSchema(task)}}}};
 return {kind:'chat',url:config.baseUrl+'/chat/completions',body:{model:config.model,messages,max_tokens:8192,stream:false,response_format:{type:'json_object'},...(config.provider==='deepseek'?{thinking:{type:'disabled'}}:{})}};
}
function usageFor(kind,usage){
 if(!usage||typeof usage!=='object')return undefined;
 const input=kind==='responses'?usage.input_tokens:usage.prompt_tokens,output=kind==='responses'?usage.output_tokens:usage.completion_tokens,total=usage.total_tokens;
 if(![input,output,total].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1e12))return undefined;
 return {inputTokens:input,outputTokens:output,totalTokens:total};
}
export function readAiProviderResponse(kind,envelope){
 if(kind==='chat'){const choice=envelope?.choices?.[0];return {content:choice?.message?.content,finish:choice?.message?.tool_calls?.length?'incomplete':choice?.finish_reason,usage:usageFor(kind,envelope?.usage)};}
 if(kind!=='responses')return {finish:'incomplete'};
 if(envelope?.status!=='completed')return {finish:envelope?.status==='incomplete'&&envelope?.incomplete_details?.reason==='max_output_tokens'?'length':'incomplete'};
 if(!Array.isArray(envelope.output)||envelope.output.some(item=>!['message','reasoning'].includes(item?.type)))return {finish:'incomplete'};
 const messages=envelope.output.filter(item=>item.type==='message');if(!messages.length||messages.some(item=>item.role&&item.role!=='assistant'||!Array.isArray(item.content)||item.content.some(part=>part.type!=='output_text'||typeof part.text!=='string')))return {finish:'incomplete'};
 return {content:messages.flatMap(item=>item.content.map(part=>part.text)).join(''),finish:'stop',usage:usageFor(kind,envelope.usage)};
}
