const strings = {jobPreset:80,jobTitle:160,jobDescription:30000,projectName:120,personalTemplateId:160};
const storage = ctx => { try { return ctx.draftStorage || globalThis.localStorage; } catch { return null; } };
const key = ctx => `its-me:wizard-draft:v1:${ctx.draftScope || 'default'}`;
const ids = value => Array.isArray(value) ? [...new Set(value.filter(item=>typeof item==='string'&&item.length<=200))].slice(0,1000) : [];
export function cleanWizardDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return null;
  const clean = {isNew:draft.isNew!==false,projectId:typeof draft.projectId==='string'?draft.projectId.slice(0,200):null,step:draft.step===2?2:1,template:['classic','sidebar','blank'].includes(draft.template)?draft.template:'classic',language:draft.language==='en'?'en':'zh'};
  for (const [name,max] of Object.entries(strings)) clean[name] = typeof draft[name]==='string'?draft[name].slice(0,max):'';
  for (const name of ['entryIds','personFields','attachmentIds']) clean[name] = ids(draft[name]);
  clean.personFields=clean.personFields.filter(name=>['name','headline','city','email','phone','website'].includes(name));
  for (const name of ['selectionInitialized','usePhoto','photoFromLibrary']) clean[name] = Boolean(draft[name]);
  if(draft.selectionByLanguage&&typeof draft.selectionByLanguage==='object'&&!Array.isArray(draft.selectionByLanguage)){clean.selectionByLanguage={};for(const language of ['zh','en']){const choice=draft.selectionByLanguage[language];if(choice&&typeof choice==='object'&&!Array.isArray(choice))clean.selectionByLanguage[language]={entryIds:ids(choice.entryIds),personFields:ids(choice.personFields).filter(name=>['name','headline','city','email','phone','website'].includes(name)),usePhoto:Boolean(choice.usePhoto),photoFromLibrary:Boolean(choice.photoFromLibrary)};}}
  if (draft.aiRequirements && typeof draft.aiRequirements==='object') {
    const value=draft.aiRequirements;clean.aiRequirements={};
    for(const [name,max] of [['action',30],['instruction',6000],['translationMode',30]])if(typeof value[name]==='string')clean.aiRequirements[name]=value[name].slice(0,max);
    if(value.constraints&&typeof value.constraints==='object')clean.aiRequirements.constraints=Object.fromEntries(['maxCharacters','maxBullets','maxTags','maxFindings','maxQuestions'].filter(name=>Number.isInteger(value.constraints[name])&&value.constraints[name]>0&&value.constraints[name]<=30000).map(name=>[name,value.constraints[name]]));
  }
  return clean;
}
export function saveWizardDraft(ctx,draft=ctx.ui?.wizard) {
  const clean=cleanWizardDraft(draft);if(!clean)return false;
  try {const store=storage(ctx);if(!store)return false;store.setItem(key(ctx),JSON.stringify(clean));return true;}catch{ctx.notify?.('向导草稿未能写入本机，请先保留填写内容。',true);return false;}
}
export function loadWizardDraft(ctx) {
  try {const value=storage(ctx)?.getItem(key(ctx));return value?cleanWizardDraft(JSON.parse(value)):null;}catch{return null;}
}
export function clearWizardDraft(ctx) {try{const store=storage(ctx);if(store?.removeItem)store.removeItem(key(ctx));else store?.setItem(key(ctx),'null');return true;}catch{return false;}}
export function restoreWizardDraft(ctx,{render=true}={}) {
  const draft=loadWizardDraft(ctx);if(!draft)return false;
  if(!draft.isNew&&!ctx.state?.projects?.some(project=>project.id===draft.projectId)){ctx.notify?.('草稿对应的简历已不存在，草稿仍保留在本机。',true);return false;}
  if(!draft.isNew&&ctx.state.activeProjectId!==draft.projectId){ctx.notify?.('请先打开草稿对应的简历，再继续选材。',true);return false;}
  ctx.ui.wizard=draft;ctx.ui.screen='wizard';if(render)ctx.render?.();return true;
}
export async function enterAiSettings(ctx,{resume,label='返回 AI 辅助'}={}) {
  if(ctx.ui.wizard)saveWizardDraft(ctx);
  ctx.ui.aiReturn={screen:ctx.ui.screen,label:typeof label==='string'?label.slice(0,80):'返回 AI 辅助',resume:typeof resume==='function'?resume:null};
  return ctx.navigate('settings');
}
export async function returnFromAiSettings(ctx) {
  const pending=ctx.ui.aiReturn;if(!pending)return false;
  if(pending.screen==='wizard'&&!ctx.ui.wizard&&!restoreWizardDraft(ctx,{render:false}))return false;
  const moved=await ctx.navigate(pending.screen||'projects');if(moved===false)return false;
  ctx.ui.aiReturn=null;
  if(pending.resume)await pending.resume();
  return true;
}
