import {pruneCanvasGroups,templateDecorationSettings,validateCanvasTemplate} from './canvas-groups.mjs';
import { validateProject } from './model.mjs';
const clone = value => structuredClone(value);
export const designKeys = ['x','y','width','height','page','fontSize','fontFamily','fontWeight','fontStyle','textDecoration','textAlign','lineHeight','color','background','fixedHeight','column','locked','image','shapeVariant','layer','fontSizeMode','sectionSpacing','templateDecoration'];
const layoutKeys = ['x','y','width','height','page','fontSize','fixedHeight'];
const geometry = block => Object.fromEntries(layoutKeys.filter(key => block[key] !== undefined).map(key => [key, clone(block[key])]));
const layout = project => ({mode:project.mode,positions:Object.fromEntries(project.blocks.map(block => [block.id,geometry(block)]))});
const decoration = block => ['line','shape'].includes(block.kind);
export function groupFlowBlocks(blocks) {
  const groups=new Map(),ordered=[];
  for(const block of blocks) {
    if(block.kind==='entry') { if(!groups.has(block.category)){const group=[];groups.set(block.category,group);ordered.push(group);} groups.get(block.category).push(block); }
    else ordered.push([block]);
  }
  return ordered.flat();
}
export function createPersonalTemplate(project,name,positions={}) {
  validateProject(project);
  if(typeof name!=='string'||!name.trim()||name.trim().length>80) throw new Error('模板名称需为1—80个字符。');
  const visible=project.blocks.filter(block=>!block.hiddenLanguages?.includes(project.language)),indexes=new Map(visible.map((block,index)=>[block.id,index]));
  const canvasGroups=(project.canvasGroupsByLanguage?.[project.language]||[]).map(group=>({frameIndexes:group.blockIds.map(id=>indexes.get(id)).filter(index=>index!==undefined)})).filter(group=>group.frameIndexes.length>=2);
  return {id:crypto.randomUUID(),name:name.trim(),createdAt:new Date().toISOString(),base:project.template,mode:project.mode,paper:clone(project.paper),accent:project.accent,fontFamily:project.fontFamily,fontSize:project.fontSize,groupSections:project.groupSections!==false,...(project.documentStyle?{documentStyle:clone(project.documentStyle)}:{}),...(project.sectionTitles?{sectionTitles:clone(project.sectionTitles)}:{}),templateDecorations:clone(templateDecorationSettings(project)),canvasGroups,frames:visible.map(block=>({kind:block.kind,category:block.category,style:{...clone(Object.fromEntries(designKeys.filter(key=>block[key]!==undefined||positions[block.id]?.[key]!==undefined).map(key=>[key,positions[block.id]?.[key]??block[key]]))),flowColumn:block.flowColumnByLanguage?.[project.language]||'auto'}}))};
}
const textBlock = block => !['line','shape','photo'].includes(block.kind);
const horizontallyOverlaps = (left,right) => left.x < right.x + right.width && right.x < left.x + left.width;
const overlapsWithGap = (left,right,gap) => left.page === right.page && horizontallyOverlaps(left,right) && left.y < right.y + right.height + gap && right.y < left.y + left.height + gap;
function reserveUnmatchedPhotos(project,photos,measureBlock) {
  if(!photos.length)return;
  const visible=project.blocks.filter(block=>!block.hiddenLanguages?.includes(project.language));
  const text=visible.filter(textBlock).sort((left,right)=>left.page-right.page||left.y-right.y||left.x-right.x);
  const margin=Math.min(16,project.paper.width/10,project.paper.height/10),gap=8,right=project.paper.width-margin,bottom=project.paper.height-margin;
  const page=text[0]?.page??0,existing=visible.filter(block=>block.kind==='photo'&&!photos.includes(block)&&block.page===page);
  let top=margin,rowRight=Math.min(right,...existing.filter(block=>block.y<margin+60&&block.y+block.height>margin).map(block=>block.x-gap));
  if(rowRight-margin<12){top=Math.max(margin,...existing.map(block=>block.y+block.height+gap));rowRight=right;}
  for(const photo of photos){
    const scale=Math.min(1,48/photo.width,60/photo.height,(right-margin)/photo.width,(bottom-top-24)/photo.height);
    if(!(scale>0))throw new Error('照片尺寸无法安全放入页眉，请先缩小照片或调整模板。');
    photo.width*=scale;photo.height*=scale;
  }
  const totalWidth=photos.reduce((sum,photo)=>sum+photo.width,0),available=rowRight-margin-gap*(photos.length-1),rowScale=Math.min(1,available/totalWidth);
  if(!(rowScale>0))throw new Error('照片过多，无法安全放入同页页眉，请先精简照片。');
  for(const photo of photos){
    photo.width*=rowScale;photo.height*=rowScale;
    if(photo.width<.1||photo.height<.1)throw new Error('照片过多，无法安全放入同页页眉，请先精简照片。');
    Object.assign(photo,{page,x:rowRight-photo.width,y:top});rowRight=photo.x-gap;
  }
  if(!text.length)return;
  const pageText=text.filter(block=>block.page===page),anchor=pageText.find(block=>block.kind==='profile')||pageText[0];
  const oldAnchor={...geometry(anchor)},portraits=[...existing,...photos],photoBottom=Math.max(...portraits.map(photo=>photo.y+photo.height));
  const measure=(block,width)=>{
    const measured=measureBlock?measureBlock({...block,width,fixedHeight:false},project,width):{height:block.height,horizontalOverflow:false};
    if(!measured||!Number.isFinite(measured.height)||measured.height<=0)throw new Error('文字测量结果无效，照片与模板均未修改。');
    return measured;
  };
  let inline=false;
  if(measureBlock&&anchor.kind==='profile'){
    const width=Math.min(anchor.width,Math.min(...portraits.map(photo=>photo.x))-gap-anchor.x);
    if(width>=12){const measured=measure(anchor,width);if(!measured.horizontalOverflow&&anchor.y+measured.height<=bottom){Object.assign(anchor,{width,height:measured.height,fixedHeight:false});inline=true;}}
  }
  if(!inline){
    const measured=measure(anchor,anchor.width);
    if(measured.horizontalOverflow)throw new Error('基本信息宽度无法容纳完整文字，请先调整后再应用照片模板。');
    Object.assign(anchor,{y:Math.max(anchor.y,photoBottom+gap),height:measured.height,fixedHeight:false});
  }
  if(anchor.y+anchor.height>bottom)throw new Error('基本信息与照片无法安全放入一页，请先缩短基本信息、缩小照片或调整模板。');
  const occupied=[...portraits,anchor],growth=anchor.y+anchor.height-oldAnchor.y-oldAnchor.height;
  let lastPage=Math.max(0,...visible.map(block=>block.page));
  for(const block of pageText.filter(block=>block!==anchor)){
    const measured=measure(block,block.width);
    if(measured.horizontalOverflow)throw new Error('文字宽度无法容纳完整内容，请先调整后再应用照片模板。');
    const height=Math.max(measured.height,block.fixedHeight?block.height:0),originalY=block.y;
    if(growth>0&&originalY>=oldAnchor.y+oldAnchor.height&&horizontallyOverlaps(block,oldAnchor))block.y+=growth;
    let frame={...block,height},hits;
    // Once an earlier block in this horizontal text lane continues, later
    // text follows it; independent columns can retain their original page.
    const precedingPage=Math.max(page,...occupied.filter(placed=>textBlock(placed)&&horizontallyOverlaps(frame,placed)).map(placed=>placed.page));
    if(precedingPage>frame.page)Object.assign(frame,{page:precedingPage,y:margin});
    while((hits=occupied.filter(placed=>overlapsWithGap(frame,placed,gap))).length){frame.y=Math.max(...hits.map(placed=>placed.y+placed.height+gap));}
    if(frame.y+height>bottom){
      if(height>bottom-margin)throw new Error('文字模块高于一页，无法安全避开照片，请先按页拆分正文。');
      if(lastPage>=1000)throw new Error('照片避让后的页数超出上限，请先精简页面。');
      const insertedPage=frame.page+1;
      // Insert immediately after the overflowing lane so existing later
      // sections retain their reading order. Other-language frames stay put.
      for(const later of visible)if(later.page>=insertedPage)later.page++;
      lastPage++;
      Object.assign(frame,{page:insertedPage,y:margin});
    }
    Object.assign(block,{page:frame.page,y:frame.y,height});
    if(block.y!==originalY||block.page!==page)block.fixedHeight=false;
    occupied.push({...block,height});
  }
}

// The optional synchronous renderer callback returns {height,horizontalOverflow}.
export function applyPersonalTemplate(project,template,{measureBlock}={}) {
  if(measureBlock!==undefined&&typeof measureBlock!=='function')throw new Error('文字测量方法无效。');
  validateCanvasTemplate(template);
  const next=clone(project),current=project.language,other=current==='zh'?'en':'zh';
  next.canvasGroupsByLanguage||={};next.canvasGroupsByLanguage[current]=[];
  next.templateDecorationsByLanguage||={};next.templateDecorationsByLanguage[current]=clone(template.templateDecorations||{sidebarMode:'auto',sectionRules:true,profileRule:true});
  // Fill older partial snapshots before changing geometry; never invent the
  // other language's new template coordinates from already changed blocks.
  next.layoutByLanguage||={};next.layoutByLanguage[other]||=layout(project);
  for(const block of project.blocks) next.layoutByLanguage[other].positions[block.id]??=geometry(block);
  if(next.freeLayoutByLanguage?.[other]) for(const block of project.blocks) next.freeLayoutByLanguage[other].positions[block.id]??=geometry(block);
  Object.assign(next,{template:template.base,mode:template.mode,paper:clone(template.paper),accent:template.accent,fontFamily:template.fontFamily,fontSize:template.fontSize,groupSections:template.groupSections!==false});
  if(template.documentStyle)next.documentStyle=clone(template.documentStyle);else delete next.documentStyle;
  const headings=clone(next.sectionTitles||{});
  if(template.sectionTitles?.[current])headings[current]=clone(template.sectionTitles[current]);else delete headings[current];
  if(Object.keys(headings).length)next.sectionTitles=headings;else delete next.sectionTitles;
  next.blocks=next.blocks.filter(block=>{
    if(!decoration(block)||block.hiddenLanguages?.includes(current))return true;
    if(block.hiddenLanguages?.includes(other))return false;
    block.hiddenLanguages=[...new Set([...(block.hiddenLanguages||[]),current])];return true;
  });
  const frameIds=new Map();
  const used=new Map(),unmatchedPhotos=[];let lastPage=Math.max(0,...template.frames.map(frame=>frame.style.page));
  for(const block of next.blocks) {
    if(block.hiddenLanguages?.includes(current)||decoration(block))continue;
    const frames=template.frames.filter(frame=>frame.kind===block.kind&&(frame.kind!=='entry'||frame.category===block.category));
    const key=block.kind+':'+block.category,index=used.get(key)||0;used.set(key,index+1);
    const exact=frames[index],frame=exact||frames.at(-1);
    if(frame){for(const key of designKeys)delete block[key];const style=clone(frame.style);delete style.flowColumn;Object.assign(block,style);block.flowColumnByLanguage={...block.flowColumnByLanguage,[current]:frame.style.flowColumn||'auto'};if(exact)frameIds.set(template.frames.indexOf(exact),block.id);}
    if(next.mode==='free'&&!exact&&block.kind==='photo'){unmatchedPhotos.push(block);continue;}
    if(next.mode==='free'&&!exact) {
      if(++lastPage>1000)throw new Error('模板需要的续页超过上限，请先减少资料或改用模板排版。');
      Object.assign(block,{page:lastPage,x:16,y:16,width:Math.min(block.width,next.paper.width-32),height:Math.min(block.height,next.paper.height-32)});
    }
  }
  for(const [index,frame]of template.frames.entries())if(decoration(frame)){const style=clone(frame.style);delete style.flowColumn;const block={id:crypto.randomUUID(),sourceId:null,kind:frame.kind,category:'other',period:'',tags:[],zh:{title:'',subtitle:'',body:''},en:{title:'',subtitle:'',body:''},stale:{zh:false,en:false},hiddenLanguages:[other],...style};next.blocks.push(block);frameIds.set(index,block.id);}
  next.canvasGroupsByLanguage[current]=(template.canvasGroups||[]).map(group=>({id:crypto.randomUUID(),blockIds:group.frameIndexes.map(index=>frameIds.get(index)).filter(Boolean)})).filter(group=>group.blockIds.length>=2);
  reserveUnmatchedPhotos(next,unmatchedPhotos,measureBlock);
  if(next.mode==='free')for(const group of next.canvasGroupsByLanguage[current]){
    const pages=new Set(group.blockIds.map(id=>next.blocks.find(block=>block.id===id)?.page));
    if(pages.size>1){const error=new Error('照片避让会把同一组合拆到不同页，模板未应用。请先解组，或缩短组内文字、调整模板后重试。');error.code='TEMPLATE_GROUP_PAGE_SPLIT';throw error;}
  }
  next.layoutByLanguage[current]=layout(next);
  if(next.mode==='free'){next.freeLayoutByLanguage||={};next.freeLayoutByLanguage[current]=layout(next);}
  else if(next.freeLayoutByLanguage)delete next.freeLayoutByLanguage[current];
  const ids=new Set(next.blocks.map(block=>block.id));
  for(const maps of [next.layoutByLanguage,next.freeLayoutByLanguage])for(const saved of Object.values(maps||{}))for(const id of Object.keys(saved.positions))if(!ids.has(id))delete saved.positions[id];
  pruneCanvasGroups(next);validateProject(next);return next;
}
