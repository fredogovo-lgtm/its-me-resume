const fail=message=>{throw new Error(message);};
export function normalizeProjectName(value){
  if(typeof value!=='string')fail('请输入简历名称。');const name=value.trim();
  if(!name||name.length>500||/[\u0000-\u001f]/u.test(name))fail('简历名称需为1—500个字符，且不能包含控制字符。');return name;
}
function timestamp(now){const value=now();if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)||!Number.isFinite(Date.parse(value)))fail('简历时间无效。');return value;}
export function suggestProjectName(projects,baseName){
  const names=new Set(projects.map(project=>project.name)),base=typeof baseName==='string'&&baseName.trim()?baseName.trim():'我的简历';let index=1,name;
  do{const suffix=' · 副本'+(index>1?' '+index:'');let prefix=base.slice(0,500-suffix.length);if(/[\uD800-\uDBFF]$/u.test(prefix))prefix=prefix.slice(0,-1);name=prefix.trimEnd()+suffix;index++;}while(names.has(name));return name;
}
export function duplicateProject(project,name,{idFactory=()=>crypto.randomUUID(),now=()=>new Date().toISOString()}={}){
  const normalized=normalizeProjectName(name),id=idFactory(),time=timestamp(now);
  if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/u.test(id)||id===project.id)fail('复制简历编号无效。');
  return{...structuredClone(project),id,name:normalized,archived:false,createdAt:time,updatedAt:time};
}
export function renameProject(project,name,{now=()=>new Date().toISOString()}={}){return{...structuredClone(project),name:normalizeProjectName(name),updatedAt:timestamp(now)};}
export function setProjectArchived(project,archived,{now=()=>new Date().toISOString()}={}) {
  if(typeof archived!=='boolean')fail('归档状态无效。');
  return {...structuredClone(project),archived,updatedAt:timestamp(now)};
}
export function filterProjects(projects,{query='',language='all',status='active'}={}) {
  const text=String(query).trim().toLocaleLowerCase();
  return projects.filter(project=>(status==='all'||(status==='archived'?project.archived===true:project.archived!==true))
    &&(!['zh','en'].includes(language)||project.language===language)
    &&(!text||[project.name,project.jobTitle].some(value=>String(value||'').toLocaleLowerCase().includes(text))))
    .sort((left,right)=>right.updatedAt.localeCompare(left.updatedAt));
}
export function projectThumbnailContent(project) {
  const visible=project.blocks.filter(block=>!block.hiddenLanguages?.includes(project.language));
  return {title:visible.find(block=>block.kind==='profile')?.[project.language]?.title||project.name,
    entries:visible.filter(block=>block.kind==='entry').slice(0,3).map(block=>block[project.language]?.title||'')};
}
