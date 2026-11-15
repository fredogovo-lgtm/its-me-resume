// Measurements are visible text rectangles in paper millimetres, not text-frame bounds.
export function findTextOverlaps(regions, { maxPairs = 100 } = {}) {
  if (!Number.isInteger(maxPairs) || maxPairs < 1 || maxPairs > 1000) throw new Error('遮挡检查数量无效。');
  const fragments = [];
  (Array.isArray(regions) ? regions : []).forEach((region, index) => {
    if (!region || typeof region.blockId !== 'string' || !Number.isInteger(region.page) || region.page < 0) return;
    for (const rect of region.rects || []) {
      if (!rect || !['x','y','width','height'].every(key => Number.isFinite(rect[key])) || rect.width <= 0 || rect.height <= 0) continue;
      fragments.push({ ...rect, right: rect.x + rect.width, bottom: rect.y + rect.height, index, region });
    }
  });
  fragments.sort((a,b) => a.region.page - b.region.page || a.y - b.y || a.x - b.x || a.index - b.index);
  let page = -1, active = [];
  const found = new Set(), issues = [];
  for (const rect of fragments) {
    if (rect.region.page !== page) { page = rect.region.page; active = []; }
    active = active.filter(item => item.bottom - rect.y > .25);
    for (const other of active) {
      if (other.region.blockId === rect.region.blockId) continue;
      const left = Math.min(other.index, rect.index), right = Math.max(other.index, rect.index), key = page + ':' + left + ':' + right;
      if (found.has(key)) continue;
      const w = Math.min(other.right, rect.right) - Math.max(other.x, rect.x);
      const h = Math.min(other.bottom, rect.bottom) - Math.max(other.y, rect.y);
      if (w <= .25 || h <= .25 || w * h < .2) continue;
      found.add(key);
      const first = regions[left], second = regions[right];
      issues.push({ code: 'text-overlap', page, blockIds: [first.blockId, second.blockId], message: '第' + (page + 1) + '页“' + (first.label || '文字模块') + '”与“' + (second.label || '文字模块') + '”的文字可能互相遮挡。' });
      if (issues.length >= maxPairs) return issues;
    }
    active.push(rect);
  }
  return issues;
}

// Photos cover their whole visible frame. Decorative lines/shapes are omitted
// deliberately, since they commonly sit behind headings as part of a template.
export function findImageOverlaps(photos, textRegions = [], {maxPairs = 100} = {}) {
  const valid = photos.filter(p => p && typeof p.blockId === 'string' && Number.isInteger(p.page) && p.page >= 0 && ['x','y','width','height'].every(k=>Number.isFinite(p[k])) && p.width > 0 && p.height > 0);
  const issues = [], found = new Set();
  const intersects = (a,b) => {const w=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),h=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);return w>.25&&h>.25&&w*h>.2;};
  const add = (a,b) => {
    const key=a.page+':'+[a.blockId,b.blockId].sort().join(':');
    if (found.has(key)) return; found.add(key);
    issues.push({code:'image-overlap',page:a.page,blockIds:[a.blockId,b.blockId],message:'第'+(a.page+1)+'页照片与'+(b.rects?'“'+(b.label||'文字模块')+'”的文字':'另一张照片')+'可能互相遮挡。'});
  };
  for(let i=0;i<valid.length;i++) {
    const photo=valid[i];
    for(let j=i+1;j<valid.length;j++) if(photo.page===valid[j].page&&intersects(photo,valid[j])) {add(photo,valid[j]);if(issues.length>=maxPairs)return issues;}
    for(const region of textRegions) if(region.page===photo.page&&region.blockId!==photo.blockId&&(region.rects||[]).some(rect=>intersects(photo,rect))) {add(photo,region);if(issues.length>=maxPairs)return issues;}
  }
  return issues;
}
