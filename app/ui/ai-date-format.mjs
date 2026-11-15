import { getPeriod } from '../core/entry-content.mjs';

const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const numericMonth = String.raw`\d{4}\s*(?:[.-]\s*\d{1,2}|年\s*\d{1,2}\s*月)`;
const namedMonth = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{4}`;
const monthPattern = `(?:${numericMonth}|${namedMonth})`;
const currentPattern = /^(?:至今|现在|目前|present|current|now|ongoing)$/iu;
const rangePattern = new RegExp(`^(${monthPattern})\\s*(?:—|–|~|～|-|至|到|\\bto\\b)\\s*(${monthPattern}|至今|现在|目前|present|current|now|ongoing)$`,'iu');
const currentOnlyRangePattern = new RegExp(`^(${monthPattern})\\s*(至今|现在|目前|present|current|now|ongoing)$`,'iu');
const languageName = language => language === 'en' ? '英文' : '中文';
function validLanguage(language) { if (!['zh','en'].includes(language)) throw new Error('时间格式语言无效。'); }
function parseMonth(value) {
  let match = value.match(/^(\d{4})\s*[.-]\s*(\d{1,2})$/u) || value.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月$/u);
  let year, month;
  if (match) { year=Number(match[1]); month=Number(match[2]); }
  else {
    match=value.match(/^([a-z]+)\.?\s+(\d{4})$/iu);
    if (!match) return null;
    const name=match[1].toLowerCase();
    month=monthNames.findIndex((full,index)=>full.toLowerCase()===name||months[index].toLowerCase()===name||(index===8&&name==='sept'))+1;
    year=Number(match[2]);
  }
  return year>=1000&&year<=9999&&month>=1&&month<=12 ? {year,month} : null;
}
function printMonth(value, language) { return language==='en' ? `${months[value.month-1]} ${value.year}` : `${value.year}年${value.month}月`; }
export function formatAiPeriodCandidate(value, language='zh') {
  validLanguage(language);
  const unknown = reason => ({recognized:false,candidate:null,reason});
  if (typeof value!=='string'||value.length>500) return unknown('日期文本无效，原文保留。');
  const source=value.trim();
  if (!source) return unknown('尚未填写时间，没有可整理的日期。');
  const single=parseMonth(source);
  if (single) return {recognized:true,candidate:printMonth(single,language),reason:'仅整理已识别的年月格式。'};
  const range=source.match(rangePattern) || source.match(currentOnlyRangePattern);
  if (!range) return unknown('不能无歧义识别年月或范围，原文保留；不会猜测月日顺序。');
  const start=parseMonth(range[1]),end=currentPattern.test(range[2])?null:parseMonth(range[2]);
  if (!start||(!end&&!currentPattern.test(range[2]))) return unknown('年月无效，原文保留。');
  if (end&&(end.year*12+end.month<start.year*12+start.month)) return unknown('结束年月早于开始年月，请手工核对；原文保留。');
  const endText=end?printMonth(end,language):language==='en'?'Present':'至今';
  return {recognized:true,candidate:printMonth(start,language)+(language==='en'?' – ':' — ')+endText,reason:'仅整理已识别的年月范围，不改动起止事实。'};
}
function getItem(document,scope,id) { return scope==='library' ? document.entries?.find(item=>item.id===id) : document.blocks?.find(item=>item.id===id); }
function dateSnapshot(item,language) {
  return {period:item.period,hasLocalized:Object.hasOwn(item.periodByLanguage||{},language),localized:item.periodByLanguage?.[language]??null};
}
export function createAiDateFormatPlan(document,{scope='project',ids=[],language='zh',viewLanguage}={}) {
  validLanguage(language);
  if (!document||!['library','project'].includes(scope)||!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string')) throw new Error('请先选择要核对时间的经历。');
  const selected=[...new Set(ids)];
  return {scope,language,viewLanguage:scope==='project'?document.language:viewLanguage||language,projectId:scope==='project'?document.id:null,ids:selected,rows:selected.map((id,index)=>{
    const item=getItem(document,scope,id);
    if (!item) {
      if (scope==='library'&&id==='person') return {id,label:'基本信息',current:'',candidate:null,selected:false,eligible:false,status:'此模块没有经历时间',reason:'请选择一段经历整理时间。',snapshot:null};
      throw new Error('所选经历已不存在，请重新打开时间预览。');
    }
    const supported=scope==='library'||item.kind==='entry';
    if (!supported) return {id,label:item[language]?.title||'模块 '+(index+1),current:'',candidate:null,selected:false,eligible:false,status:'此模块没有经历时间',reason:'请选择一段经历整理时间。',snapshot:null};
    const current=getPeriod(item,language),formatted=formatAiPeriodCandidate(current,language);
    const locked=Boolean(item.locked),hidden=Boolean(item.hiddenLanguages?.includes(language));
    const changed=formatted.recognized&&formatted.candidate!==current;
    const reason=locked?'模块已锁定，先解锁后重新预览。':hidden?'此模块在目标语言中隐藏，不能修改。':formatted.recognized&&!changed?'当前格式已一致，无需修改。':formatted.reason;
    return {id,label:item[language]?.title||item[language==='en'?'zh':'en']?.title||'经历 '+(index+1),current,candidate:formatted.candidate,selected:false,eligible:Boolean(changed&&!locked&&!hidden),status:current.trim()?'已有日期，待核对格式':'尚未填写时间',reason,snapshot:dateSnapshot(item,language)};
  })};
}
function selectedRows(document,plan,selectedIds) {
  if (!plan||!Array.isArray(plan.rows)||!Array.isArray(plan.ids)||!Array.isArray(selectedIds)||!['library','project'].includes(plan.scope)) throw new Error('时间预览无效，请重新打开。');
  validLanguage(plan.language);
  if (plan.scope==='project'&&(document.id!==plan.projectId||document.language!==plan.viewLanguage)) throw new Error('当前简历或显示语言已变化，请重新预览时间。');
  const ids=[...new Set(selectedIds)];
  return ids.map(id=>{
    if (!plan.ids.includes(id)) throw new Error('所选日期超出本次预览范围。');
    const row=plan.rows.find(row=>row.id===id),item=getItem(document,plan.scope,id);
    if (!row||!row.eligible) throw new Error('此项没有可采用的日期候选，请重新核对。');
    if (!item) throw new Error('原经历已不存在，请重新预览时间。');
    if (plan.scope==='project'&&item.kind!=='entry') throw new Error('原模块类型已变化，请重新选择经历。');
    if (item.locked||item.hiddenLanguages?.includes(plan.language)) throw new Error('模块已锁定或隐藏，请重新预览时间。');
    if (JSON.stringify(dateSnapshot(item,plan.language))!==JSON.stringify(row.snapshot)||getPeriod(item,plan.language)!==row.current) throw new Error('原日期或日期来源已变化，请重新预览。');
    const candidate=formatAiPeriodCandidate(row.current,plan.language);
    if (!candidate.recognized||candidate.candidate!==row.candidate) throw new Error('日期候选已变化，请重新预览。');
    return {id,candidate:row.candidate};
  });
}
export function applyAiDateFormatPlan(document,plan,selectedIds=[]) {
  const rows=selectedRows(document,plan,selectedIds),next=structuredClone(document);
  // Do not use setPeriod here: its compatibility initialization fills both
  // languages. Format confirmation writes only the explicitly selected language.
  for (const row of rows) {
    const item=getItem(next,plan.scope,row.id);
    item.periodByLanguage={...item.periodByLanguage,[plan.language]:row.candidate};
  }
  return next;
}
function assertUiContext(ctx,plan) {
  if (plan.scope==='library') {
    if (ctx.ui.screen!=='library'||ctx.ui.libraryLanguage!==plan.viewLanguage||ctx.ui.dirtyLibrary||ctx.ui.librarySaving) throw new Error('资料表单或显示语言已变化，请先保存资料后重新预览时间。');
  } else if (ctx.ui.screen!=='editor'||ctx.project?.id!==plan.projectId||ctx.project.language!==plan.viewLanguage) throw new Error('当前简历或显示语言已变化，请重新预览时间。');
}
export async function saveAiDateFormatSelection(ctx,plan,selectedIds=[]) {
  if (!selectedIds.length) return {applied:0};
  assertUiContext(ctx,plan);
  const ids=[...new Set(selectedIds)];
  if (plan.scope==='library') {
    const next=applyAiDateFormatPlan(ctx.state.library,plan,ids);
    await ctx.saveLibrary(next);
  } else {
    // Validate before opening the undo transaction, then recheck the fresh
    // project inside the one mutation so no unrelated local text is replaced.
    selectedRows(ctx.project,plan,ids);
    ctx.updateProject(project=>{
      const rows=selectedRows(project,plan,ids);
      for (const row of rows) {
        const item=getItem(project,'project',row.id);
        item.periodByLanguage={...item.periodByLanguage,[plan.language]:row.candidate};
      }
    });
    await ctx.flush();
  }
  return {applied:ids.length};
}
const node=(tag,text,className)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;};
export function openAiDateFormat(ctx,{scope='project',ids=[],language=scope==='library'?ctx.ui.libraryLanguage:ctx.project?.language}={}) {
  try {
    document.activeElement?.blur();
    if (scope==='library'&&(ctx.ui.dirtyLibrary||ctx.ui.librarySaving)) throw new Error('请先保存或处理资料表单修改，再整理时间格式。');
    const source=scope==='library'?ctx.state.library:ctx.project;
    const plan=createAiDateFormatPlan(source,{scope,ids,language,viewLanguage:ctx.ui.libraryLanguage});
    ctx.modal('整理时间格式','本机识别年月，不调用 AI。旧日期和另一语言保持；勾选并确认后，只写入本次目标语言。','<div data-ai-date-list></div><p class="panel-help" data-ai-date-status role="status"></p><div class="modal-actions"><button type="button" class="button secondary" data-ai-date-close>关闭</button><button type="button" class="button primary" data-ai-date-apply disabled>采用选中时间格式</button></div>',root=>{
      const list=root.querySelector('[data-ai-date-list]'),apply=root.querySelector('[data-ai-date-apply]'),close=root.querySelector('[data-ai-date-close]'),status=root.querySelector('[data-ai-date-status]'),controls=[];
      let busy=false;
      for (const row of plan.rows) {
        const section=node('section',undefined,'inspector-section'),label=node('label',undefined,'check-row'),check=node('input');
        check.type='checkbox';check.checked=false;check.disabled=!row.eligible;check.dataset.aiDateId=row.id;
        label.append(check,node('strong',row.label));section.append(label,node('p',row.status,'panel-help'));
        const original=node('label',`原时间 · ${languageName(language)}`,'field'),before=node('textarea');before.readOnly=true;before.rows=2;before.value=row.current||'（空）';original.append(before);section.append(original);
        if (row.candidate!==null) {const candidate=node('label',`格式候选 · ${languageName(language)}`,'field'),after=node('textarea');after.readOnly=true;after.rows=2;after.value=row.candidate;candidate.append(after);section.append(candidate);}
        section.append(node('p',row.reason,'panel-help'));list.append(section);controls.push(check);
        check.onchange=()=>{apply.disabled=!controls.some(control=>control.checked);status.textContent='已选 '+controls.filter(control=>control.checked).length+' 项；其余原文保留。';};
      }
      status.textContent=plan.rows.some(row=>row.eligible)?'尚未选择任何项。':'没有可无歧义整理的日期；原文已保留。';
      close.onclick=()=>{if(!busy)ctx.closeModal();};
      apply.onclick=async()=>{
        if(busy)return;
        const ids=controls.filter(control=>control.checked&&!control.disabled).map(control=>control.dataset.aiDateId);
        if(!ids.length)return;
        busy=true;apply.disabled=true;close.disabled=true;list.inert=true;
        try {const result=await saveAiDateFormatSelection(ctx,plan,ids);ctx.closeModal();ctx.notify(`已整理 ${result.applied} 项${languageName(language)}时间格式；旧日期与另一语言保留。`);}
        catch(error){ctx.notify(error.message,true);status.textContent='未完成保存；请核对原日期、语言和锁定状态后重新打开预览。';}
        finally{busy=false;list.inert=false;close.disabled=false;apply.disabled=!controls.some(control=>control.checked&&!control.disabled);}
      };
    });
    return plan;
  } catch(error) {ctx.notify(error.message,true);return null;}
}