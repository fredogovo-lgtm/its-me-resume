const round = value => Math.round(value * 100) / 100;
const snapEdge = (value, { snap = false, grid = 2 }) => snap ? Math.round(value / grid) * grid : value;

// Geometry uses document millimetres, independent of the preview zoom and font size.
export function moveFrame(frame, dx, dy, options = {}) {
  return {
    x: round(Math.max(0, snapEdge(frame.x + dx, options))),
    y: round(Math.max(0, snapEdge(frame.y + dy, options))),
    width: frame.width,
    height: frame.height,
  };
}

export function resizeFrame(frame, direction, dx, dy, options = {}) {
  const { minWidth = 12, minHeight = 6 } = options;
  let left = Math.max(0, frame.x), top = Math.max(0, frame.y);
  let right = left + Math.max(minWidth, frame.width), bottom = top + Math.max(minHeight, frame.height);
  if (direction.includes('w')) left = Math.max(0, Math.min(right - minWidth, snapEdge(left + dx, options)));
  if (direction.includes('e')) right = Math.max(left + minWidth, snapEdge(right + dx, options));
  if (direction.includes('n')) top = Math.max(0, Math.min(bottom - minHeight, snapEdge(top + dy, options)));
  if (direction.includes('s')) bottom = Math.max(top + minHeight, snapEdge(bottom + dy, options));
  return { x: round(left), y: round(top), width: round(right - left), height: round(bottom - top) };
}
// Locate an actual paper under the pointer, so scrolling, zoom and page gaps do
// not become stored y offsets on the source page. The grip offset is in mm.
export function placeDraggedFrame(frame, pointer, papers, size, grip, options = {}) {
  const paper = papers.find(p => p.width > 0 && p.height > 0 && pointer.x >= p.left && pointer.x <= p.left + p.width && pointer.y >= p.top && pointer.y <= p.top + p.height);
  if (!paper) return null;
  const local = {x:(pointer.x-paper.left)*size.width/paper.width-grip.x,y:(pointer.y-paper.top)*size.height/paper.height-grip.y};
  return { x:round(Math.max(0,Math.min(Math.max(0,size.width-frame.width),snapEdge(local.x,options)))), y:round(Math.max(0,Math.min(Math.max(0,size.height-frame.height),snapEdge(local.y,options)))), width:frame.width,height:frame.height,page:paper.page };
}

// Mutates only the caller's project draft; ctx.updateProject owns undo/save.
export function duplicateProjectBlock(project, id, newId, positions = {}) {
  const source = project.blocks.find(block => block.id === id);
  if (!source) throw new Error('待复制模块已不存在。');
  if (source.kind === 'photo' && project.mode === 'flow') {
    const other = project.language === 'zh' ? 'en' : 'zh';
    project.layoutByLanguage ||= {};
    project.layoutByLanguage[other] ||= {mode:project.mode,positions:Object.fromEntries(project.blocks.map(block=>[block.id,Object.fromEntries(['x','y','width','height','page','fontSize','fixedHeight'].filter(key=>block[key]!==undefined).map(key=>[key,block[key]]))]))};
    for (const block of project.blocks) Object.assign(block, positions[block.id] || {});
    project.mode = 'free';
  }
  const copied = structuredClone(source); copied.id = newId; copied.locked = false;
  const offset = (value,extent,limit) => value+extent+4<=limit ? value+4 : Math.max(0,value-4);
  copied.x = offset(source.x,source.width,project.paper.width); copied.y = offset(source.y,source.height,project.paper.height);
  if(source.kind === 'photo') copied.hiddenLanguages = [...new Set([...(copied.hiddenLanguages || []),project.language === 'zh' ? 'en' : 'zh'])];
  project.blocks.push(copied);
}
