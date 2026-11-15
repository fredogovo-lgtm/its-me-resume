// Editable expression preferences. These never replace the fixed fact, scope, privacy or JSON guards.
export const AI_RULE_ACTIONS=Object.freeze(['polish','shorten','proofread','expand','translate','review','role','select','layout','tags','organize','questions','optimize']);
const GENERAL='使用自然、清楚、简洁的表达，避免空话、口号和过度包装。资料已经充分或原文合适时可以保持，不为凑数强行修改。summary只概括实际返回的改动或建议；notes不把已提供的信息当作缺失，也不重复正文和其他建议。';
const ACTIONS=Object.freeze({
 polish:'改善表达的清晰度和专业性，保留原有语气与信息密度，优先修改真正影响阅读的地方。',
 shorten:'优先去掉重复和空话，保留主要职责、证据和结果；以简历易读为目标，不机械压缩所有句子。',
 proofread:'集中修正错别字、标点、语法和表达不顺，原本正确的内容不必改写。',
 expand:'根据已提供资料主动找出影响表达完整性的具体信息缺口，提出少量明确、容易回答的问题。内容充分时可不提问，并简短说明；不只在summary泛泛要求补充。',
 translate:'使用符合目标语言简历习惯的自然表达。英文采用简洁、平行的职责或成果短语，避免逐字直译和生硬句式。',
 review:'优先给出对投递最有帮助的具体建议，说明问题所在及可以怎么改。结合只读背景一起判断，已有信息不建议重复添加。',
 role:'区分硬性要求、优先条件和可选条件，优先解释岗位核心职责与任职条件；未要求某经历不代表禁止该经历。',
 select:'按岗位相关性和证据充分程度推荐已有资料，突出理由，避免推荐重复内容；信息不足时明确不确定。',
 layout:'根据给定几何信息优先指出可操作的排版问题；页面已合理时可以不提建议，保持建议简洁。',
 tags:'从现有资料提取少量具体、好检索的标签，避免同义重复和泛化的能力口号，沿用现有标签语言。',
 organize:'按阅读顺序整理已有内容，让职责、做法和结果层次清楚；保留信息，不为结构整齐强行补齐经历。',
 questions:'围绕已有资料中真正影响简历质量的信息缺口主动给出少量具体问题，一题只问一件事。资料充分时可返回空问题并说明原因；不只在summary提示用户自行补充。',
 optimize:'完整查看本次填写和只读事实，按字段改善清晰度、简洁度和一致性，不必改动原本合适的字段。保留姓名、机构、正式证书名称、时间层级及事实限定。',
});
const fail=message=>{throw new Error('AI规则'+message);};
function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length)fail(label+'格式无效。');return value;}
function keys(value,allowed,label){object(value,label);if(Object.keys(value).some(key=>!allowed.includes(key)))fail(label+'含有不支持的字段。');}
function text(value,label){if(typeof value!=='string')fail(label+'必须是文字。');if(value.length>8000)fail(label+'不能超过8000字。');if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value))fail(label+'含有不可用的控制字符。');return value;}
export function getDefaultAiRulePreferences(){return {version:1,general:GENERAL,actions:{...ACTIONS}};}
export function normalizeAiRulePreferences(input){
 if(input===undefined)return getDefaultAiRulePreferences();
 keys(input,['version','general','actions'],'设置');if(input.version!==undefined&&input.version!==1)fail('设置版本不受支持。');
 const result=getDefaultAiRulePreferences();if(Object.hasOwn(input,'general'))result.general=text(input.general,'通用偏好');
 if(Object.hasOwn(input,'actions')){keys(input.actions,AI_RULE_ACTIONS,'任务偏好');for(const key of Object.keys(input.actions))result.actions[key]=text(input.actions[key],'任务偏好');}
 if(result.general.length+Object.values(result.actions).reduce((sum,value)=>sum+value.length,0)>24000)fail('全局设置总长度不能超过24000字。');
 return result;
}
export function normalizeAiRuleOverrides(input){
 if(input===undefined)return {};keys(input,['general','action'],'临时设置');const out={};
 for(const key of ['general','action'])if(Object.hasOwn(input,key))out[key]=text(input[key],'临时偏好');
 if(Object.values(out).reduce((sum,value)=>sum+value.length,0)>16000)fail('临时设置总长度不能超过16000字。');return out;
}
export function resolveAiRulePreferences(preferences,action,overrides){
 if(!AI_RULE_ACTIONS.includes(action))fail('任务不受支持。');const global=normalizeAiRulePreferences(preferences),local=normalizeAiRuleOverrides(overrides);
 return {general:Object.hasOwn(local,'general')?local.general:global.general,action:Object.hasOwn(local,'action')?local.action:global.actions[action]};
}
