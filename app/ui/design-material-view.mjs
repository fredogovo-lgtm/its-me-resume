export function paintDesignMaterial(element,block,project) {
  if(block.kind!=='shape'||(!block.image&&!block.shapeVariant))return false;
  const frame=document.createElement('div');frame.className='design-material-frame';frame.style.cssText='position:absolute;inset:0;overflow:hidden;pointer-events:none';
  if(block.shapeVariant==='round')frame.style.borderRadius='3mm';
  if(block.shapeVariant==='ellipse')frame.style.borderRadius='50%';
  if(block.shapeVariant==='diamond')frame.style.clipPath='polygon(50% 0,100% 50%,50% 100%,0 50%)';
  if(block.image){const image=document.createElement('img');image.src=block.image.dataUrl;image.alt=block[project.language]?.title||'图片素材';image.draggable=false;image.style.cssText='width:100%;height:100%;object-fit:contain;display:block';frame.append(image);}else frame.style.background=block.background||project.accent;
  element.append(frame);return true;
}