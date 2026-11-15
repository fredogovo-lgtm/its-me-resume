import {getPeriod} from './entry-content.mjs';
import {linkLabel} from './document-style.mjs';
const clone=value=>structuredClone(value),languages=['zh','en'];
const textBlock=block=>!['photo','shape','line'].includes(block.kind);
const visible=(block,language)=>textBlock(block)&&!block.hiddenLanguages?.includes(language);
const error=message=>{throw Error(message);};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
function defaultOrder(project,language){
 const blocks=project.blocks.filter(block=>visible(block,language));
 if(project.mode!=='flow'||project.groupSections===false)return blocks;
 const categories=new Map(),ordered=[];
 for(const block of blocks){if(block.kind==='entry'){if(!categories.has(block.category)){const group=[];categories.set(block.category,group);ordered.push(group);}categories.get(block.category).push(block);}else ordered.push([block]);}
 return ordered.flat();
}
export function readingBlocks(project,language=project.language,{positions}={}){
 if(!languages.includes(language))error('阅读语言无效。');
 const baseline=defaultOrder(project,language),index=new Map(baseline.map((block,i)=>[block.id,i])),preferred=project.readingOrderByLanguage?.[language]||[],rank=new Map(preferred.map((id,i)=>[id,i]));
 const ordered=[...baseline].sort((a,b)=>(rank.get(a.id)??preferred.length+index.get(a.id))-(rank.get(b.id)??preferred.length+index.get(b.id)));
 if(positions)ordered.sort((a,b)=>(positions[a.id]?.page??a.page??0)-(positions[b.id]?.page??b.page??0));
 return ordered;
}
export function validateReadingOrder(project){
 if(project.readingOrderByLanguage===undefined)return true;if(!object(project.readingOrderByLanguage))error('文字阅读顺序无效。');
 for(const [language,ids]of Object.entries(project.readingOrderByLanguage)){if(!languages.includes(language)||!Array.isArray(ids)||ids.length>500||new Set(ids).size!==ids.length)error('文字阅读顺序语言或列表无效。');for(const id of ids){const block=project.blocks.find(b=>b.id===id);if(typeof id!=='string'||!block||!visible(block,language))error('文字阅读顺序引用了不存在、隐藏或非文字模块。');}}
 return true;
}
export function pruneReadingOrder(project){for(const [language,ids]of Object.entries(project.readingOrderByLanguage||{}))if(Array.isArray(ids))project.readingOrderByLanguage[language]=ids.filter(id=>project.blocks.some(block=>block.id===id&&visible(block,language)));return project;}
export function setReadingOrder(project,ids,language=project.language){const next=clone(project);next.readingOrderByLanguage={...next.readingOrderByLanguage,[language]:clone(ids)};validateReadingOrder(next);return next;}
export function moveReadingBlock(project,id,direction,{positions}={}){
 if(![-1,1].includes(direction))error('请选择向前或向后调整。');
 const blocks=readingBlocks(project,project.language,{positions}),index=blocks.findIndex(block=>block.id===id),other=index+direction;
 if(index<0||other<0||other>=blocks.length)error('已经到达阅读顺序边界。');
 const page=block=>positions?.[block.id]?.page??block.page??0;
 if(page(blocks[index])!==page(blocks[other]))error('文字仍按PDF页码阅读；只能在同页调整顺序。跨页请先移动纸面模块。');
 if(positions){const left=blocks[index],right=blocks[other],a=positions[left.id],b=positions[right.id];if((left.layer??2)===(right.layer??2)&&a&&b&&Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>.2&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>.2)error('这两个同图层文本框在纸面重叠，调整阅读顺序可能改变遮挡。请先调整位置或尺寸，或建立简洁投递版。');}
 [blocks[index],blocks[other]]=[blocks[other],blocks[index]];return setReadingOrder(project,blocks.map(block=>block.id));
}
export function readingText(project,language=project.language,{positions}={}){
 return readingBlocks(project,language,{positions}).map(block=>{const text=block[language]||{};return[text.title,text.subtitle,getPeriod(block,language),text.body,...(block.links||[]).map(link=>(linkLabel(link,language)?linkLabel(link,language)+' | ':'')+link.url)].filter(Boolean).join('\n');}).join('\n\n');
}
function neutralRichText(block){for(const fields of Object.values(block.richText||{}))for(const [field,runs]of Object.entries(fields)){fields[field]=runs.map(run=>({...run,style:Object.fromEntries(Object.entries(run.style).filter(([key])=>['fontWeight','fontStyle','textDecoration'].includes(key)))})).filter(run=>Object.keys(run.style).length);if(!fields[field].length)delete fields[field];}if(block.richText&&!Object.values(block.richText).some(fields=>Object.keys(fields).length))delete block.richText;}
export function createSubmissionProject(project,{name=(project.name||'我的简历')+' · 简洁投递',idFactory=()=>crypto.randomUUID(),now=()=>new Date().toISOString(),positions,paper}={}){
 const current=readingBlocks(project,project.language,{positions});
 if(!current.some(block=>Object.values(block[project.language]||{}).some(text=>typeof text==='string'&&text.trim())||getPeriod(block,project.language)||(block.links||[]).length))error('当前语言还没有可制作投递版的文字内容。');
 if(typeof name!=='string'||!name.trim()||name.trim().length>500||/[\u0000-\u001f]/u.test(name))error('简历名称需为1—500字。');
 const id=idFactory(),time=now();if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/u.test(id)||id===project.id)error('简历编号无效。');if(typeof time!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(time)||!Number.isFinite(Date.parse(time)))error('简历时间无效。');
 const next=clone(project),currentIds=new Set(current.map(block=>block.id)),rest=project.blocks.filter(block=>textBlock(block)&&!currentIds.has(block.id));
 Object.assign(next,{id,name:name.trim(),createdAt:time,updatedAt:time,template:'classic',mode:'flow',groupSections:false,paper:paper?clone(paper):{name:'A4',width:210,height:297},fontFamily:project.language==='en'?'Arial':'Microsoft YaHei',fontSize:10.5,accent:'#26343f',documentStyle:{lineHeight:1.45,sectionSpacing:4,targetPages:0,continuationHeader:false,pageNumbers:false,continuationMarkers:false},blocks:clone([...current,...rest])});
 for(const key of ['layoutByLanguage','freeLayoutByLanguage','canvasGroupsByLanguage'])delete next[key];
 next.templateDecorationsByLanguage={zh:{sidebarMode:'hidden',sectionRules:false,profileRule:false},en:{sidebarMode:'hidden',sectionRules:false,profileRule:false}};
 const styleKeys=['fontFamily','fontWeight','fontStyle','textDecoration','textAlign','lineHeight','sectionSpacing','layer','image','shapeVariant','templateDecoration'];
 for(const block of next.blocks){for(const key of styleKeys)delete block[key];Object.assign(block,{x:16,y:16,width:next.paper.width-32,height:20,page:0,fontSize:10.5,fontSizeMode:'inherit',color:'#26343f',background:'transparent',fixedHeight:false,locked:false,column:'main',flowColumnByLanguage:{zh:'main',en:'main'}});neutralRichText(block);}
 next.readingOrderByLanguage={zh:readingBlocks(project,'zh').filter(block=>next.blocks.some(b=>b.id===block.id)).map(block=>block.id),en:readingBlocks(project,'en').filter(block=>next.blocks.some(b=>b.id===block.id)).map(block=>block.id)};
 next.readingOrderByLanguage[project.language]=current.map(block=>block.id);
 pruneReadingOrder(next);validateReadingOrder(next);return next;
}
