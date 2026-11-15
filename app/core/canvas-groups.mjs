/** Persistent canvas relationships are language-local; no text or storage access. */
const languages=['zh','en'], columns=['auto','main','side'];
const clone=value=>structuredClone(value);
const visible=(block,language)=>!block.hiddenLanguages?.includes(language);
const otherLanguage=language=>language==='zh'?'en':'zh';
const groupKey='canvasGroupsByLanguage';
const fail=message=>{throw Error(message);};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const safeId=value=>typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f]/u.test(value);
const frameKeys=['x','y','width','height','page','fontSize','fixedHeight'];
const frameOf=(block,positions={})=>({...Object.fromEntries(frameKeys.filter(k=>block[k]!==undefined).map(k=>[k,block[k]])),...(positions[block.id]||{})});
export function preserveCanvasOtherLayout(project){const other=otherLanguage(project.language);project.layoutByLanguage||={};project.layoutByLanguage[other]||={mode:project.mode,positions:{}};for(const block of project.blocks){project.layoutByLanguage[other].positions[block.id]??=frameOf(block);if(project.freeLayoutByLanguage?.[other])project.freeLayoutByLanguage[other].positions[block.id]??=frameOf(block);}return project;}
export function canvasGroupFor(project,id,language=project.language){return project[groupKey]?.[language]?.find(group=>group.blockIds.includes(id))||null;}
export function canvasSelectionIds(project,id,language=project.language){return [...(canvasGroupFor(project,id,language)?.blockIds||[id])];}
export function pruneCanvasGroups(project){
 const ids=new Map(project.blocks.map(block=>[block.id,block]));
 for(const [language,groups]of Object.entries(project[groupKey]||{})){
  if(!Array.isArray(groups))continue;
  project[groupKey][language]=groups.map(group=>Array.isArray(group?.blockIds)?{...group,blockIds:group.blockIds.filter(id=>ids.has(id)&&visible(ids.get(id),language))}:group).filter(group=>!Array.isArray(group?.blockIds)||group.blockIds.length>=2);
 }
 for(const key of ['layoutByLanguage','freeLayoutByLanguage'])for(const layout of Object.values(project[key]||{}))for(const id of Object.keys(layout.positions||{}))if(!ids.has(id))delete layout.positions[id];
 return project;
}
function selection(project,ids,positions={}){
 if(!Array.isArray(ids)||ids.length<1||new Set(ids).size!==ids.length)fail('请选择不同的文字或装饰模块。');
 const selected=ids.map(id=>project.blocks.find(block=>block.id===id));
 if(selected.some(block=>!block||!visible(block,project.language)))fail('选择中有隐藏或不存在的模块。');
 if(selected.some(block=>block.locked))fail('分组中有锁定模块，请先解锁或解组。');
 if(new Set(selected.map(block=>frameOf(block,positions).page)).size!==1)fail('分组需要选择同一页的模块。');
 return selected;
}
export function createCanvasGroup(project,ids,positions={}){
 if(!Array.isArray(ids)||ids.length<2||new Set(ids).size!==ids.length)fail('请勾选同页至少两个不同模块。');
 const expanded=new Set(ids);for(const id of ids)for(const member of canvasSelectionIds(project,id))expanded.add(member);
 const chosen=[...expanded];selection(project,chosen,positions);
 const next=clone(project);next[groupKey]||={};const groups=next[groupKey][next.language]||[];
 next[groupKey][next.language]=[...groups.filter(group=>!group.blockIds.some(id=>expanded.has(id))),{id:crypto.randomUUID(),blockIds:chosen}];
 return next;
}
export function ungroupCanvasSelection(project,ids){const next=clone(project),chosen=new Set(ids);if(next[groupKey]?.[next.language])next[groupKey][next.language]=next[groupKey][next.language].filter(group=>!group.blockIds.some(id=>chosen.has(id)));return next;}
export function moveCanvasSelection(project,id,target,{positions={},resize=false}={}){
 const ids=canvasSelectionIds(project,id),blocks=selection(project,ids,positions),anchor=blocks.find(block=>block.id===id),start=frameOf(anchor,positions);
 if(!['x','y'].every(key=>Number.isFinite(target[key]))||!Number.isInteger(target.page??start.page)||(target.page??start.page)<0||(target.page??start.page)>1000)fail('模块位置无效。');
 const page=target.page??start.page,dx=target.x-start.x,dy=target.y-start.y;
 const frames=new Map(blocks.map(block=>{const current=frameOf(block,positions);return[block.id,resize?(block.id===id?{...current,...target,page}:{...current}):{...current,x:current.x+dx,y:current.y+dy,page}];}));
 for(const frame of frames.values())if(![frame.x,frame.y,frame.width,frame.height].every(Number.isFinite)||frame.width<=0||frame.height<=0||frame.x<-.001||frame.y<-.001||frame.x+frame.width>project.paper.width+.001||frame.y+frame.height>project.paper.height+.001)fail('分组超出纸张，整组位置保持不变。');
 if(resize&&ids.length>1&&page!==start.page)fail('调整尺寸不能把组内单项移到其它页。');
 preserveCanvasOtherLayout(project);
 for(const block of blocks){const frame=frames.get(block.id);for(const key of ['x','y','width','height','page'])block[key]=Math.round(frame[key]*100)/100;}
 return project;
}
export function duplicateCanvasSelection(project,id){
 const ids=canvasSelectionIds(project,id),blocks=selection(project,ids),next=clone(project),other=otherLanguage(project.language);
 if(next.blocks.length+blocks.length>500)fail('复制后模块超过500个，请先精简。');
 const right=Math.max(...blocks.map(b=>b.x+b.width)),bottom=Math.max(...blocks.map(b=>b.y+b.height)),left=Math.min(...blocks.map(b=>b.x)),top=Math.min(...blocks.map(b=>b.y));
 const dx=right+4<=project.paper.width?4:left>=4?-4:0,dy=bottom+4<=project.paper.height?4:top>=4?-4:0;
 const mapping=new Map(ids.map(id=>[id,crypto.randomUUID()]));
 for(const source of blocks){const copied=clone(source);copied.id=mapping.get(source.id);copied.x+=dx;copied.y+=dy;copied.locked=false;copied.hiddenLanguages=[other];if(copied.continuation&&mapping.has(copied.continuation.sourceBlockId))copied.continuation.sourceBlockId=mapping.get(copied.continuation.sourceBlockId);next.blocks.push(copied);}
 if(ids.length>1){next[groupKey]||={};next[groupKey][next.language]||=[];next[groupKey][next.language].push({id:crypto.randomUUID(),blockIds:[...mapping.values()]});}
 return next;
}
// Recovery is explicit: ungroup this language and copy only the selected member.
// The UI freezes measured frames before invoking this one-draft transaction.
export function ungroupAndDuplicateCanvasSelection(project,id){
 const group=canvasGroupFor(project,id);if(!group)fail('当前组合已变化，请关闭窗口后重新选择。');
 if(project.mode!=='free')fail('请先保留当前画面进入自由摆放，再处理跨页组合。');
 const members=group.blockIds.map(member=>project.blocks.find(block=>block.id===member));
 if(members.some(block=>!block||!visible(block,project.language)))fail('组合中有隐藏或不存在的模块，请重新选择。');
 if(members.some(block=>block.locked))fail('组合中有锁定模块，请先解锁，再解组并复制。');
 if(new Set(members.map(block=>block.page)).size<2)fail('该组合已不再跨页，请关闭窗口后重试。');
 for(const block of members)if(![block.x,block.y,block.width,block.height].every(Number.isFinite)||block.width<=0||block.height<=0||block.x<0||block.y<0||block.x+block.width>project.paper.width+.001||block.y+block.height>project.paper.height+.001)fail('组合中有模块超出纸张，请先调整位置或尺寸后再复制。');
 const ungrouped=ungroupCanvasSelection(project,[id]);preserveCanvasOtherLayout(ungrouped);
 const next=duplicateCanvasSelection(ungrouped,id),copy=next.blocks.at(-1),source=project.blocks.find(block=>block.id===id);
 if(!['photo','shape','line'].includes(source.kind)){
  const preferred=project.readingOrderByLanguage?.[project.language]||[],visibleText=project.blocks.filter(block=>visible(block,project.language)&&!['photo','shape','line'].includes(block.kind));
  const order=[...preferred,...visibleText.map(block=>block.id).filter(value=>!preferred.includes(value))],index=order.indexOf(id);
  order.splice(index+1,0,copy.id);next.readingOrderByLanguage={...next.readingOrderByLanguage,[project.language]:order};
 }
 validateCanvasGroups(next);return next;
}
export function deleteCanvasSelection(project,id){
 const ids=canvasSelectionIds(project,id),blocks=selection(project,ids),next=clone(project),chosen=new Set(ids),other=otherLanguage(project.language);
 preserveCanvasOtherLayout(next);
 next.blocks=next.blocks.filter(block=>{if(!chosen.has(block.id))return true;if(!visible(block,other))return false;block.hiddenLanguages=[...new Set([...(block.hiddenLanguages||[]),project.language])];return true;});
 return pruneCanvasGroups(next);
}
export function flowColumn(block,language){if(block.kind==='profile')return'main';const value=block.flowColumnByLanguage?.[language];return value&&value!=='auto'?value:['education','skills','certificate'].includes(block.category)?'side':'main';}
export function setFlowColumn(project,id,value){if(!columns.includes(value))fail('模板栏位无效。');const block=project.blocks.find(block=>block.id===id);if(!block||['profile','photo','line','shape'].includes(block.kind))fail('此模块不支持切换模板栏位。');if(block.locked)fail('请先解锁模块。');block.flowColumnByLanguage={...block.flowColumnByLanguage,[project.language]:value};return project;}
export function hasSidebarContent(project){return project.blocks.some(block=>visible(block,project.language)&&!['profile','photo','line','shape'].includes(block.kind)&&flowColumn(block,project.language)==='side');}
export function templateDecorationSettings(project,language=project.language){return{sidebarMode:'auto',sectionRules:true,profileRule:true,...project.templateDecorationsByLanguage?.[language]};}
export function setTemplateDecoration(project,key,value){
 if(!['sidebarMode','sectionRules','profileRule'].includes(key)||(key==='sidebarMode'?!['auto','hidden','custom'].includes(value):typeof value!=='boolean'))fail('模板装饰设置无效。');
 const next=clone(project);next.templateDecorationsByLanguage||={};next.templateDecorationsByLanguage[next.language]={...templateDecorationSettings(next),[key]:value};
 if(key==='sidebarMode'&&value!=='custom'){const other=otherLanguage(next.language);next.blocks=next.blocks.filter(block=>{if(block.templateDecoration!=='sidebar'||!visible(block,next.language))return true;if(!visible(block,other))return false;block.hiddenLanguages=[...new Set([...(block.hiddenLanguages||[]),next.language])];return true;});pruneCanvasGroups(next);}
 return next;
}
export function editTemplateSidebar(project,pageCount=1){
 if(project.template!=='sidebar')fail('当前模板没有侧栏色带。');
 if(!Number.isInteger(pageCount)||pageCount<1||pageCount>1001||project.blocks.length+pageCount>500)fail('侧栏装饰页数超过可用模块数量。');
 const next=setTemplateDecoration(project,'sidebarMode','hidden'),other=otherLanguage(project.language);next.templateDecorationsByLanguage[next.language].sidebarMode='custom';
 for(let page=0;page<pageCount;page++)next.blocks.push({id:crypto.randomUUID(),sourceId:null,kind:'shape',category:'other',period:'',tags:[],zh:{title:'侧栏色带',subtitle:'',body:''},en:{title:'Sidebar decoration',subtitle:'',body:''},stale:{zh:false,en:false},hiddenLanguages:[other],x:0,y:0,width:Math.min(53,project.paper.width*.28)+26,height:project.paper.height,page,fontSize:10.5,color:'#26343f',background:'#eef5f3',locked:false,column:'main',fixedHeight:true,layer:0,templateDecoration:'sidebar'});
 return next;
}
function validateDecorationSettings(settings){if(!object(settings))fail('模板装饰设置无效。');for(const [key,value]of Object.entries(settings)){if(!['sidebarMode','sectionRules','profileRule'].includes(key))fail('未知的模板装饰设置。');if(key==='sidebarMode'?!['auto','hidden','custom'].includes(value):typeof value!=='boolean')fail('模板装饰设置无效。');}}
export function validateCanvasBlock(block){
 if(block.flowColumn!==undefined&&!columns.includes(block.flowColumn))fail('模板栏位无效。');
 if(block.flowColumnByLanguage!==undefined){if(!object(block.flowColumnByLanguage))fail('模板栏位无效。');for(const [language,value]of Object.entries(block.flowColumnByLanguage))if(!languages.includes(language)||!columns.includes(value))fail('模板栏位无效。');}
 if(block.templateDecoration!==undefined&&(!['sidebar'].includes(block.templateDecoration)||block.kind!=='shape'))fail('模板装饰类型无效。');return true;
}
export function validateCanvasGroups(project){
 for(const block of project.blocks||[])validateCanvasBlock(block);
 if(project.templateDecorationsByLanguage!==undefined){if(!object(project.templateDecorationsByLanguage))fail('模板装饰语言无效。');for(const [language,value]of Object.entries(project.templateDecorationsByLanguage)){if(!languages.includes(language))fail('模板装饰语言无效。');validateDecorationSettings(value);}}
 if(project[groupKey]===undefined)return true;if(!object(project[groupKey]))fail('画布分组无效。');
 for(const [language,groups]of Object.entries(project[groupKey])){if(!languages.includes(language)||!Array.isArray(groups)||groups.length>250)fail('画布分组无效。');const members=new Set(),groupIds=new Set();for(const group of groups){if(!object(group)||Object.keys(group).some(key=>!['id','blockIds'].includes(key))||!safeId(group.id)||groupIds.has(group.id)||!Array.isArray(group.blockIds)||group.blockIds.length<2||group.blockIds.length>500)fail('画布分组无效。');groupIds.add(group.id);for(const id of group.blockIds){const block=project.blocks.find(b=>b.id===id);if(!safeId(id)||members.has(id)||!block||!visible(block,language))fail('画布分组包含重复、隐藏或不存在的模块。');members.add(id);}}}
 return true;
}
export function validateCanvasTemplate(template){
 if(template.templateDecorations!==undefined)validateDecorationSettings(template.templateDecorations);
 if(template.canvasGroups===undefined)return true;if(!Array.isArray(template.canvasGroups)||template.canvasGroups.length>250)fail('模板分组无效。');const members=new Set();
 for(const group of template.canvasGroups){if(!object(group)||Object.keys(group).some(k=>k!=='frameIndexes')||!Array.isArray(group.frameIndexes)||group.frameIndexes.length<2||group.frameIndexes.length>500)fail('模板分组无效。');for(const index of group.frameIndexes){if(!Number.isInteger(index)||index<0||index>=template.frames.length||members.has(index))fail('模板分组引用无效。');members.add(index);}}
 return true;
}
