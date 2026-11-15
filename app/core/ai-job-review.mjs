// Conservative, local presentation of job suggestions. This is not a semantic fact verifier.
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'?value:'';
const normalized=value=>text(value).normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim();
const compact=value=>normalized(value).replace(/\s+/gu,'');
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
const relations=new Set(['direct','background','unknown','contradiction']);
const fragments=value=>text(value).split(/[。；;\r\n]|[.!?](?=\s|$)/u).map(part=>part.trim()).filter(Boolean);
function contexts(source,quote){
 if(!quote.trim()||!source.includes(quote))return[];
 const result=[];let index=0;while((index=source.indexOf(quote,index))!==-1&&result.length<100){
  const before=source.slice(0,index),after=source.slice(index+quote.length),left=[...before.matchAll(/[。；;\r\n]|[.!?](?=\s|$)/gu)].at(-1);
  const closed=/[。；;\r\n]\s*$/u.test(quote)||/[.!?]\s*$/u.test(quote)&&(/\s$/u.test(quote)||!after||/^\s/u.test(after)),right=closed?0:after.search(/[。；;\r\n]|[.!?](?=\s|$)/u);
  result.push(source.slice(left?left.index+left[0].length:0,right<0?source.length:index+quote.length+right));index+=Math.max(quote.length,1);
 }return result;
}
function contextKind(value){
 const duty=/(?:^|[，,：:])\s*(?:(?:负责|职责|工作内容|岗位职责|需要|需|须|承担)[：:]?\s*)?(?:审核|核验|核查|审查|审计|识别|检查|筛查|验证|指导求职者|辅导求职者|帮助求职者|培训求职者)|\b(?:responsibilities|duties)\s*:|\b(?:verify|audit|screen|review)\b.{0,45}\b(?:resume|cv|candidate|authenticity|claims)\b|\b(?:coach|advise|teach)\b.{0,35}\b(?:candidate|applicant|job seeker)/iu;
 const writer=/(?:简历|自述|个人资料|申请材料).{0,55}(?:如实|真实填写|保证.{0,4}(?:真实|准确)|书写|填写|虚写|虚构|编造|夸大|表述|撰写)|(?:不得|不要|不能|禁止|不应).{0,12}(?:把|将).{0,35}(?:未|没有|不具备|虚假).{0,35}(?:写成|写为|写进|表述|宣称)|\b(?:resume|cv)\b.{0,60}\b(?:honest|truthful|write|claim|fabricat|misrepresent)|\b(?:write|fill|describe|claim|fabricate)\b.{0,70}\b(?:resume|cv)\b|\bdo not claim\b.{0,70}\b(?:unlearned|not learned|do not have|haven.t learned)/iu;
 if(duty.test(value))return'job';if(writer.test(value))return'writing';return'job';
}
function classify(jd,item){
 const spans=contexts(jd,item.quote);if(!spans.length)return{status:'uncertain',note:'岗位引用缺失或无法定位，保留待核对。'};
 const kinds=spans.flatMap(span=>fragments(span).map(contextKind));
 if(kinds.includes('writing')&&kinds.every(kind=>kind==='writing'))return{status:'writing',note:'本机将明确的简历书写/如实表述约束单列，不据此降低其它岗位条件。'};
 if(kinds.includes('writing'))return{status:'uncertain',note:'引用包含岗位条件与书写约束的混合或重复语境，保留待核对，不自动删除。'};
 return{status:'job',note:'按岗位原句保留；AI重要程度和语义仍须本人核对。'};
}
const prefix=/^(?:(?:岗位要求|任职条件|任职资格|职责|要求|条件|responsibilities|qualifications?|requirements?)\s*[:：]?\s*|(?:需要|必须|要求|应当|应|须|需|能够|能)\s*|(?:must(?: be)?|should(?: be)?|can|able to|ability to|required to)\s+)/iu;
const governor=/^(?:(?:未(?:曾)?|没有|不)(?:学习|学过|学|掌握|熟悉|精通|了解)|熟悉|熟练(?:使用|掌握)?|精通|掌握|了解|擅长|proficient (?:in|with)|familiar with|skilled (?:in|at)|expert (?:in|at))\s*/iu;
function atoms(value){
 let carry='';return text(value).replace(/\bnot only\b|不仅仅?|不只|不单/giu,'').split(/[、，,；;。\r\n]|\b(?:and|but also|but|whereas|while)\b|并且|而且|以及|且|和|及|并|但是|但|却|只是|而|不过|然而/iu).map(part=>{
  let atom=part.trim().replace(prefix,'').replace(/[.!?]+$/u,'').trim();const own=atom.match(governor);
  if(own)carry=own[0];else if(carry&&/^(?:基础|基本|进阶|basic\s+|advanced\s+)?[A-Za-z][A-Za-z0-9 +#./-]*$/u.test(atom))atom=carry+atom;
  return normalized(atom);
 }).filter(Boolean);
}
const tokens=value=>normalized(value).match(/[a-z][a-z0-9]*(?:[.+#-][a-z0-9+#.-]+)*(?:\+\+|#)?|\d+(?:\.\d+)?/gu)||[];
function contains(haystack,needle){
 const a=normalized(haystack),b=normalized(needle);if(!b)return false;
 if(/^[a-z][a-z0-9+#.-]*$/u.test(b))return tokens(a).includes(b);
 const full=compact(a),part=compact(b);if(!full.includes(part))return false;
 const left=/^[a-z0-9]/u.test(part)?'(?<![a-z0-9_])':'',right=/[a-z0-9]$/u.test(part)?'(?![a-z0-9_])':'';return new RegExp(left+escape(part)+right,'u').test(full);
}
function subject(value){return normalized(value).replace(governor,'').replace(/^(?:具有|拥有|具备|至少)\s*/u,'');}
function overlaps(unit,atom){
 const wanted=tokens(subject(atom)).filter(token=>!['in','with','of','a','the','years','year','months','month','experience','work','professional'].includes(token));
 if(wanted.some(token=>/[a-z]/u.test(token)))return wanted.filter(token=>/[a-z]/u.test(token)).some(token=>tokens(unit).includes(token));
 return contains(unit,subject(atom));
}
const negative=/(?:从未|未(?:曾)?|没有|没)(?:使用(?:过)?|用过|接触(?:过)?|学习|学过|学|掌握|具备|了解)|不会(?:使用)?|不(?:熟悉|精通|掌握|了解|具备|能|会)|(?:不|未|没有)(?:独立)?(?:负责|主导|参与|完成)|(?:没有|无)[^，,；;。\n]{0,20}(?:经验|能力|经历)|\b(?:not|never)\s+(?:yet\s+)?(?:use|used|learned|learnt|proficient|familiar|able|experienced|responsible|know|have)|\b(?:did|do|does|have|has|had)\s+not\s+(?:yet\s+)?(?:use|used|learn|learned|work|worked|have)|\b(?:haven['’]t|hasn['’]t|hadn['’]t|didn['’]t|don['’]t|doesn['’]t)\s+(?:yet\s+)?(?:use|used|learned|learn|know|have)|\bno\s+(?:[a-z]+\s+){0,3}(?:experience|knowledge|proficiency|ability)\b|\b(?:cannot|can.t|don.t know|have not learned|no knowledge of)\b/iu;
const ambiguousNegative=/不是不|并非不|不能不|不得不|没有不|\b(?:not unfamiliar|not unable|not without|cannot not)\b/iu;
function contradicts(unit,atom){
 if(ambiguousNegative.test(unit))return false;
 const wanted=tokens(subject(atom)).filter(token=>/[a-z]/u.test(token)&&!['in','with','of','a','the','years','year','months','month','experience','work','professional'].includes(token));
 for(const match of unit.matchAll(new RegExp(negative.source,'giu'))){const scope=unit.slice(match.index).split(/但是|但|却|只是|而|不过|然而|\b(?:but|although|whereas)\b/iu)[0];if(wanted.length?wanted.some(token=>tokens(scope).includes(token)):contains(scope,subject(atom)))return true;}
 return false;
}
function validatedRefs(task,item,entryId){
 if(!record(item)||!Object.keys(item).every(key=>['requirementId','relation','reason','sources'].includes(key))||!['requirementId','relation','reason','sources'].every(key=>Object.hasOwn(item,key))||!relations.has(item.relation)||!text(item.reason).trim()||item.reason.length>2000||!Array.isArray(item.sources)||item.sources.length>50)return null;
 const refs=[];for(const ref of item.sources){if(!record(ref)||Object.keys(ref).length!==2||!Object.hasOwn(ref,'sourceId')||!Object.hasOwn(ref,'quote')||!text(ref.quote).trim())return null;const source=list(task.sources).find(source=>source.sourceId===ref.sourceId);if(!source||source.kind!=='entry'||source.entryId!==entryId||!text(source.text).includes(ref.quote))return null;refs.push({sourceId:ref.sourceId,quote:ref.quote});}
 if(!refs.length&&item.relation!=='unknown')return null;return refs;
}
function assess(task,requirement,rec){
 const base={requirementId:requirement.id,requirementText:requirement.text,requirementQuote:requirement.quote,status:'unknown',explanation:'本次未提供逐条件证据；不能用整条推荐的来源代替，也不表示本人没有能力。',sources:[],claimedRelation:null};
 const candidates=list(rec.evidence).filter(item=>record(item)&&item.requirementId===requirement.id);if(!candidates.length)return base;
 if(candidates.length!==1)return{...base,explanation:'逐条件证据重复，保留待核对。'};
 const item=candidates[0],refs=validatedRefs(task,item,rec.entryId);base.claimedRelation=relations.has(item.relation)?item.relation:null;
 if(!refs)return{...base,explanation:'本机未接受该条件证据的来源或结构，保留待核对。'};base.sources=refs;
 if(requirement.reviewStatus==='uncertain')return{...base,explanation:'岗位条件本身存在语境歧义，暂不作对应判断。'};
 if(item.relation==='unknown')return{...base,explanation:'模型将此项标为不确定；本机不升级为直接对应。'};
 const needed=atoms(requirement.text),cited=refs.flatMap(ref=>atoms(ref.quote)),contextAtoms=refs.flatMap(ref=>{const source=task.sources.find(source=>source.sourceId===ref.sourceId);return contexts(source.text,ref.quote).flatMap(atoms);});
 const negated=needed.some(atom=>contextAtoms.some(unit=>contradicts(unit,atom)));
 if(negated)return{...base,status:'contradiction',explanation:'本条引用语境对相关条件有明确否定或限制，请核对原句；这不判定本人没有其它能力。'};
 if(item.relation==='contradiction')return{...base,explanation:'模型声称存在矛盾，但本机未能从本条引文明确核对，保留待核对。'};
 if(item.relation==='background')return{...base,status:'background',explanation:'模型仅标为相关背景，本机不将其升级为达到岗位条件。'};
 const jdAtoms=atoms(requirement.quote),relevantJD=jdAtoms.filter(unit=>needed.some(atom=>overlaps(unit,atom))),durationJD=jdAtoms.filter(unit=>/^(?:至少|不少于|具有|拥有|有|at least|minimum|with|\d)/iu.test(unit)&&/(?:\d|经验|experience)/iu.test(unit)),guarded=[...needed,...relevantJD,...durationJD];
 const complete=needed.length>0&&needed.every(atom=>jdAtoms.some(unit=>contains(unit,atom)))&&guarded.every(atom=>cited.some(unit=>contains(unit,atom)));
 const sourceContexts=refs.flatMap(ref=>{const source=task.sources.find(source=>source.sourceId===ref.sourceId);return contexts(source.text,ref.quote);});
 if(sourceContexts.some(unit=>ambiguousNegative.test(unit)))return{...base,explanation:'引文含多重否定或含糊语义，本机不作能力对照。'};
 if(contextAtoms.some(unit=>/(?:计划|打算|准备).{0,12}(?:使用|学习|掌握|熟悉|精通|了解|接触)/u.test(unit)&&needed.some(atom=>overlaps(unit,atom))))return{...base,explanation:'引文对相关技能描述的是计划或准备，不能作为本人已具备能力的依据。'};
 if(sourceContexts.some(unit=>/同事|他人|客户|候选人|求职者|(?:项目|系统).{0,12}(?:计划|用于|可用于)|尚未开始|岗位说明|岗位要求|招聘要求|需求文档|\b(?:colleague|customer|client|candidate|applicant|someone else|job description|planned|planning)\b/iu.test(unit)))return{...base,explanation:'引文可能涉及他人、需求转述或计划用途，不能据此对照本人的已具备能力。'};
 const ambiguous=/或|或者|\bor\b/iu.test(requirement.text),entry=task.entries.find(entry=>entry.id===rec.entryId),scopeText=[entry?.title,entry?.subtitle,...refs.map(ref=>ref.quote)].join('\n'),qualified=/课程|课堂|练习|模拟|虚构|未上线|无.{0,8}数据|\b(?:coursework|fictional|simulation|course exercise|not launched)\b/iu.test(scopeText);
 if(complete&&!ambiguous&&!qualified)return{...base,status:'aligned',explanation:'本条引文可逐项对照该条件的明确表述；不是能力满足或事实认证。'};
 const related=needed.some(atom=>cited.some(unit=>overlaps(unit,atom)));
 return{...base,status:related?'background':'unknown',explanation:qualified?'引文含课程、模拟或其它真实性限定，只能保留为相关背景，不能推成工作实绩或条件满足。':ambiguous?'条件含可选或组合语义，本机无法可靠细分，保留待核对。':'引文未完整覆盖该条件的具体内容、并列要点或程度/年限，仅保留可见背景，不推定满足。'};
}
export function reviewAiJobResult(task,result){
 if(task?.protocolVersion!==2||!['role','select'].includes(task?.action))return null;
 const view={requirements:[],writingGuidance:[],recommendations:[],notices:['本机只核对引用与有限文字线索，不认证事实或岗位能力；选材顺序不等于达到门槛。']};
 for(const [index,raw]of list(result?.requirements).slice(0,50).entries()){
  const item=typeof raw==='string'?{id:'legacy-'+index,text:raw,quote:'',level:'verify'}:record(raw)?{id:text(raw.id),text:text(raw.text),quote:text(raw.quote),level:text(raw.level)}:null;if(!item||!item.id)continue;
  const kind=classify(text(task.jobDescription),item);if(kind.status==='writing')view.writingGuidance.push({id:item.id,text:item.text,quote:item.quote,originalLevel:item.level,reviewNote:kind.note});else view.requirements.push({...item,reviewStatus:kind.status,reviewNote:kind.note});
 }
 const byId=new Map(view.requirements.map(item=>[item.id,item]));
 for(const rec of list(result?.recommendations).slice(0,200)){if(!record(rec)||!list(task.entries).some(entry=>entry.id===rec.entryId))continue;const ids=[...new Set(list(rec.requirementIds).filter(id=>typeof id==='string'))],conditions=ids.filter(id=>byId.has(id)).map(id=>assess(task,byId.get(id),rec)),warnings=[];
  if(!Object.hasOwn(rec,'evidence'))warnings.push('旧结果未包含逐条件证据，相关背景不作为能力满足证明。');if(ids.some(id=>!byId.has(id)))warnings.push('写作约束或无效条件不用于能力对应判断。');view.recommendations.push({entryId:rec.entryId,conditions,warnings});
 }return view;
}