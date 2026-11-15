import {validateCanvasBlock,canvasSelectionIds,preserveCanvasOtherLayout} from './canvas-groups.mjs';
import {validatePhoto} from './photo.mjs';
import {createEntry} from './entry-content.mjs';
export const SHAPE_VARIANTS=['rect','round','ellipse','diamond'];
export function validateDesignBlock(block,path='block') {
  validateCanvasBlock(block);
  if(block.image!==undefined){if(block.kind!=='shape')throw new Error(path+'：图片必须属于素材框。');validatePhoto(block.image,path+'.image');}
  if(block.shapeVariant!==undefined&&!SHAPE_VARIANTS.includes(block.shapeVariant))throw new Error(path+'：装饰形状无效。');
  if(block.layer!==undefined&&(!Number.isInteger(block.layer)||block.layer< -1000||block.layer>1000))throw new Error(path+'：图层顺序无效。');
  return true;
}
export function makeDesignMaterial({variant='rect',image,language='zh'}={}) {
  if(!['zh','en'].includes(language))throw new Error('素材语言无效。');
  const entry=createEntry({category:'other'}),title=image?'图片素材':({rect:'装饰色块',round:'圆角色块',ellipse:'圆形装饰',diamond:'菱形装饰'}[variant]);
  Object.assign(entry,{kind:'shape',sourceId:null,x:16,y:65,width:image?60:45,height:image?Math.max(12,Math.min(80,60*image.height/image.width)):20,page:0,fontSize:10.5,color:'#26343f',background:image?'transparent':'#dbeafe',fixedHeight:true,locked:false,column:'main',shapeVariant:variant,hiddenLanguages:[language==='zh'?'en':'zh']});
  entry.zh.title=title||'装饰';entry.en.title=image?'Image':'Decoration';if(image)entry.image=structuredClone(image);validateDesignBlock(entry);return entry;
}
const round=value=>Math.round(value*100)/100;
const visible=(block,language)=>!block.hiddenLanguages?.includes(language);
const stack=block=>block.layer??(['shape','line'].includes(block.kind)?1:2);
export function transformDesignSelection(project,ids,action) {
  if(!Array.isArray(ids)||new Set(ids).size!==ids.length||!ids.length)throw new Error('请先选择素材或文字模块。');
  const next=structuredClone(project),expanded=[...new Set(ids.flatMap(id=>canvasSelectionIds(project,id)))],selected=expanded.map(id=>next.blocks.find(block=>block.id===id));
  if(selected.some(block=>!block||block.locked||!visible(block,next.language)))throw new Error('选择或分组中有已锁定、隐藏或不存在的模块。');
  if(['bring-front','send-back'].includes(action)){
    const ordered=next.blocks.filter(block=>visible(block,next.language)).sort((a,b)=>stack(a)-stack(b)||next.blocks.indexOf(a)-next.blocks.indexOf(b));
    const chosen=new Set(expanded),kept=ordered.filter(b=>!chosen.has(b.id)),group=ordered.filter(b=>chosen.has(b.id));
    const list=action==='bring-front'?[...kept,...group]:[...group,...kept];list.forEach((block,index)=>block.layer=index+1);return next;
  }
  if(next.mode!=='free')throw new Error('请先按当前画面进入自由摆放，再进行对齐。');
  if(selected.length<2||new Set(selected.map(b=>b.page)).size!==1)throw new Error('请选择同一页的至少两个模块。');
  const seen=new Set(),units=[];
  for(const id of ids){if(seen.has(id))continue;const members=canvasSelectionIds(next,id).map(member=>selected.find(b=>b.id===member));members.forEach(b=>seen.add(b.id));const x=Math.min(...members.map(b=>b.x)),y=Math.min(...members.map(b=>b.y));units.push({members,x,y,width:Math.max(...members.map(b=>b.x+b.width))-x,height:Math.max(...members.map(b=>b.y+b.height))-y});}
  if(units.length<2)throw new Error('当前只选中一个分组，请再选其它模块或分组。');
  const bounds={left:Math.min(...units.map(b=>b.x)),right:Math.max(...units.map(b=>b.x+b.width)),top:Math.min(...units.map(b=>b.y)),bottom:Math.max(...units.map(b=>b.y+b.height))};
  const coordinate={
    'align-left':b=>b.x=bounds.left,'align-center':b=>b.x=(bounds.left+bounds.right-b.width)/2,'align-right':b=>b.x=bounds.right-b.width,
    'align-top':b=>b.y=bounds.top,'align-middle':b=>b.y=(bounds.top+bounds.bottom-b.height)/2,'align-bottom':b=>b.y=bounds.bottom-b.height,
  }[action];
  const original=new Map(units.map(unit=>[unit,{x:unit.x,y:unit.y}]));
  if(coordinate)units.forEach(coordinate);
  else if(['distribute-x','distribute-y'].includes(action)){
    if(units.length<3)throw new Error('平均分布需要同页至少三个模块或分组。');
    const axis=action==='distribute-x'?'x':'y',size=axis==='x'?'width':'height',ordered=[...units].sort((a,b)=>a[axis]-b[axis]);
    const end=ordered.at(-1)[axis]+ordered.at(-1)[size],start=ordered[0][axis],gap=(end-start-ordered.reduce((sum,b)=>sum+b[size],0))/(ordered.length-1);
    if(gap<0)throw new Error('模块总尺寸超过分布范围，请先拉开位置。');
    let cursor=start;for(const block of ordered){block[axis]=cursor;cursor+=block[size]+gap;}
  }else throw new Error('不支持的对齐操作。');
  preserveCanvasOtherLayout(next);
  for(const unit of units){const start=original.get(unit),dx=unit.x-start.x,dy=unit.y-start.y;for(const b of unit.members){b.x=round(b.x+dx);b.y=round(b.y+dy);if(b.x<0||b.y<0||b.x+b.width>next.paper.width+.01||b.y+b.height>next.paper.height+.01)throw new Error('对齐结果超出纸张，未修改。');}}
  return next;
}
