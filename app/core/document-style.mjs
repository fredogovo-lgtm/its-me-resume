import {flowColumn} from './canvas-groups.mjs';
const textBlock = block => !['photo', 'shape', 'line'].includes(block.kind);
const fail = (path, message) => { throw new Error(`${path}: ${message}`); };
const number = (value, path, min, max, integer = false) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) fail(path, '数值超出允许范围'); };
const object = (value, path) => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '需要对象'); };

export function safeLinkTarget(value) {
  if (typeof value !== 'string' || !value || value.length > 2000 || /[\s\u0000-\u001f\u007f]/u.test(value) || /%0[ad]/iu.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null;
    if (url.protocol === 'mailto:') return /^[^?@]+@[^?@]+/u.test(url.pathname) ? url.href : null;
    if (!/^https?:\/\//iu.test(value) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
// Certificate fields represent one complete destination, including encoded
// spaces. Keep validation and old rendered verification lines on one rule.
export function canonicalHttpLink(value) {
  if (typeof value !== 'string' || value.length > 2000 || !/^https?:\/\//iu.test(value) || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  try { return safeLinkTarget(new URL(value).href); } catch { return null; }
}
function validateLinkLabels(labels, path) {
  object(labels, path);
  for (const [language, label] of Object.entries(labels)) if (!['zh', 'en'].includes(language) || typeof label !== 'string' || label.length > 200 || /[\u0000-\u001f\u007f]/u.test(label)) fail(path, '显示名称只支持中英文，且每项最多200字');
}
const rawLinkLabel = (link, language) => String(link?.labels?.[language] ?? link?.label ?? '');
export const linkLabel = (link, language) => rawLinkLabel(link,language) || String(link?.url || '');
export const personWebsiteLabel = (person, language) => String(person?.websiteLabelByLanguage?.[language] ?? person?.websiteLabel ?? '');
function validateLinks(links, path, max = 11) {
  if (!Array.isArray(links) || links.length > max) fail(path, `链接最多${max}条`);
  links.forEach((item, index) => {
    const name = `${path}[${index}]`; object(item, name);
    if (typeof item.label !== 'string' || item.label.length > 200) fail(name + '.label', '显示名称最多200字');
    if (!safeLinkTarget(item.url)) fail(name + '.url', '请使用完整的http、https或mailto链接');
    if (item.labels !== undefined) validateLinkLabels(item.labels, name + '.labels');
    if (Object.keys(item).some(key => !['label', 'url', 'labels'].includes(key))) fail(name, '链接包含未知字段');
  });
}
export function validatePersonLinks(person, path = 'person') {
  if (person.websiteLabel !== undefined && (typeof person.websiteLabel !== 'string' || person.websiteLabel.length > 200)) fail(path + '.websiteLabel', '显示名称最多200字');
  if (person.websiteLabelByLanguage !== undefined) validateLinkLabels(person.websiteLabelByLanguage, path + '.websiteLabelByLanguage');
  if (person.links !== undefined) validateLinks(person.links, path + '.links', 10);
  return true;
}
export function buildPersonLinks(person) {
  const items = [...(person.website ? [{ label: person.websiteLabel || person.website, url: person.website, ...(person.websiteLabelByLanguage ? { labels: structuredClone(person.websiteLabelByLanguage) } : {}) }] : []), ...(person.links || [])];
  const seen = new Set();
  return items.flatMap(item => {
    const url = safeLinkTarget(item.url); if (!url || seen.has(url)) return []; seen.add(url);
    return [{ label: String(item.label || item.url).slice(0, 200), url, ...(item.labels ? { labels: structuredClone(item.labels) } : {}) }];
  });
}
export function parseLinkLines(text, max = 10) {
  const links = String(text || '').split(/\r?\n/u).map(line => line.trim()).filter(Boolean).map(line => {
    const split = line.indexOf('|'); return split < 0 ? { label: '', url: line } : { label: line.slice(0, split).trim(), url: line.slice(split + 1).trim() };
  });
  validateLinks(links, 'links', max); return links;
}
export const formatLinkLines = (links, language) => (links || []).map(item => `${language ? rawLinkLabel(item,language) : item.label || ''} | ${item.url}`).join('\n');
// URLs and row order are shared, while names can differ by language. Reserve
// exact destinations first, then unique current-language names. A sole remaining
// replacement is identifiable even when the other rows have moved.
function matchLinkRows(next, existing, language) {
  const used = new Set(), matches = next.map(item => {
    const index = existing.findIndex((old, index) => !used.has(index) && safeLinkTarget(old.url) === safeLinkTarget(item.url));
    if (index >= 0) used.add(index); return index;
  });
  for (let row = 0; row < next.length; row++) {
    if (matches[row] >= 0) continue;
    const label = rawLinkLabel(next[row], language);
    if (!label || next.filter((item, index) => matches[index] < 0 && rawLinkLabel(item, language) === label).length !== 1) continue;
    const candidates = existing.flatMap((item, index) => !used.has(index) && rawLinkLabel(item, language) === label ? [index] : []);
    if (candidates.length === 1) { matches[row] = candidates[0]; used.add(candidates[0]); }
  }
  const rows = matches.flatMap((index, row) => index < 0 ? [row] : []);
  const remaining = existing.flatMap((_, index) => used.has(index) ? [] : [index]);
  if (next.length === existing.length && rows.length === 1 && remaining.length === 1) matches[rows[0]] = remaining[0];
  else if (next.length === existing.length && rows.length > 1 && remaining.length > 1) {
    throw new Error('多条链接的名称和网址同时变化，无法确定对应关系。请分次修改名称、网址或增删链接后保存，再调整顺序。');
  }
  return matches.map(index => index < 0 ? null : existing[index]);
}
export function updateLinkLines(text, existing = [], language = 'zh', max = 10) {
  if (!['zh','en'].includes(language)) throw new Error('链接语言无效。');
  const parsed = parseLinkLines(text,max), matches = matchLinkRows(parsed,existing,language);
  return parsed.map((item,index) => {
    const previous = matches[index];
    if (!previous) return { ...item };
    if ((previous.labels?.[language] ?? previous.label ?? '') === item.label) return { ...structuredClone(previous), url:item.url };
    return { label: previous.label, url: item.url, labels: { ...(previous.labels || {}), [language]: item.label } };
  });
}
export function adoptLinkLanguage(existing = [], incoming = [], language = 'zh') {
  if (!['zh','en'].includes(language)) throw new Error('链接语言无效。');
  const other = language === 'zh' ? 'en' : 'zh', matches = matchLinkRows(incoming,existing,language);
  return incoming.map((item,index) => ({ label:item.label, url:item.url, labels: { ...(item.labels || {}), [language]:rawLinkLabel(item,language), [other]:matches[index] ? rawLinkLabel(matches[index],other) : rawLinkLabel(item,other) } }));
}
export function profileContactData(person, language, selectedFields = ['name', 'headline', 'city', 'email', 'phone', 'website']) {
  const selected = new Set(selectedFields), value = person[language] || {};
  const links = selected.has('website') ? buildPersonLinks(person) : [];
  // Old non-URL website notes remain plain text rather than disappearing on generation.
  const legacyWebsite = selected.has('website') && person.website && !safeLinkTarget(person.website) ? person.website : '';
  return { title: selected.has('name') ? value.name || '' : '', subtitle: selected.has('headline') ? value.headline || '' : '', body: [selected.has('city') && value.city, selected.has('phone') && person.phone, selected.has('email') && person.email, legacyWebsite].filter(Boolean).join(' · '), links };
}
export function documentStyle(project) {
  return { lineHeight: 1.65, sectionSpacing: 7, targetPages: 0, continuationHeader: false, pageNumbers: false, continuationMarkers: false, ...(project.documentStyle || {}) };
}
export function effectiveBlockStyle(block, project) {
  const style = documentStyle(project);
  const inherited = block.fontSizeMode === 'inherit' || block.fontSizeMode !== 'override' && (block.fontSize == null || block.fontSize === project.fontSize || style.legacyFontSize !== undefined && block.fontSize === style.legacyFontSize);
  return { fontSize: inherited ? project.fontSize : block.fontSize || project.fontSize, lineHeight: block.lineHeight ?? style.lineHeight, sectionSpacing: block.sectionSpacing ?? style.sectionSpacing, inheritedFontSize: inherited };
}
export function setGlobalDocumentStyle(project, changes) {
  const {fontSize, ...rest} = changes;
  if (fontSize !== undefined) number(fontSize,'documentStyle.fontSize',4,144);
  const nextStyle = { ...(project.documentStyle || {}), ...rest };
  validateDocumentStyle({...project,documentStyle:nextStyle});
  if (fontSize !== undefined) {
    const baseline = project.fontSize;
    for (const block of project.blocks.filter(textBlock)) if (block.fontSizeMode === undefined) block.fontSizeMode = block.fontSize === baseline ? 'inherit' : 'override';
    project.fontSize = fontSize;
  }
  project.documentStyle = nextStyle;
  return project;
}
export function resetBlockDocumentStyle(block) {
  block.fontSizeMode = 'inherit'; delete block.lineHeight; delete block.sectionSpacing;
}
export function validateDocumentStyle(project, path = 'project') {
  if (project.documentStyle !== undefined) {
    const style = project.documentStyle; object(style, path + '.documentStyle');
    const allowed = ['lineHeight','sectionSpacing','legacyFontSize','targetPages','continuationHeader','pageNumbers','continuationMarkers','collapsedSidebarPages'];
    for (const key of Object.keys(style)) if (!allowed.includes(key)) fail(path + '.documentStyle.' + key, '未知成稿设置');
    if (style.lineHeight !== undefined) number(style.lineHeight, path + '.documentStyle.lineHeight', 1, 2.5);
    if (style.sectionSpacing !== undefined) number(style.sectionSpacing, path + '.documentStyle.sectionSpacing', 0, 30);
    if (style.legacyFontSize !== undefined) number(style.legacyFontSize, path + '.documentStyle.legacyFontSize', 4, 144);
    if (style.targetPages !== undefined) number(style.targetPages, path + '.documentStyle.targetPages', 0, 50, true);
    for (const key of ['continuationHeader','pageNumbers','continuationMarkers']) if (style[key] !== undefined && typeof style[key] !== 'boolean') fail(path + '.documentStyle.' + key, '需要布尔值');
    if (style.collapsedSidebarPages !== undefined) {
      object(style.collapsedSidebarPages, path + '.documentStyle.collapsedSidebarPages');
      for (const [language,pages] of Object.entries(style.collapsedSidebarPages)) {
        if (!['zh','en'].includes(language) || !Array.isArray(pages) || pages.length > 1000 || new Set(pages).size !== pages.length) fail(path + '.documentStyle.collapsedSidebarPages', '页列表无效');
        pages.forEach(page => number(page, path + '.documentStyle.collapsedSidebarPages.' + language, 1, 1000, true));
      }
    }
  }
  for (const [index, block] of (project.blocks || []).entries()) {
    const name = `${path}.blocks[${index}]`;
    if (block.fontSizeMode !== undefined && !['inherit', 'override'].includes(block.fontSizeMode)) fail(name + '.fontSizeMode', '字号继承设置无效');
    if (block.sectionSpacing !== undefined) number(block.sectionSpacing, name + '.sectionSpacing', 0, 30);
    if (block.links !== undefined) validateLinks(block.links, name + '.links');
  }
  return true;
}
export function linkRanges(text) {
  const ranges = [], certificateLines = [];
  text = String(text);
  for (const match of text.matchAll(/^(?:核验链接|Verification):[ \t]*(.*)$/gmu)) {
    const start = match.index + match[0].length - match[1].length, end = start + match[1].length;
    certificateLines.push({start,end});
    const url = canonicalHttpLink(match[1]);
    if (url) ranges.push({start,end,url});
  }
  for (const match of text.matchAll(/(?:https?:\/\/|mailto:)[^\s<>"'\u3000，。；！、：）】》]+/giu)) {
    if (certificateLines.some(line => match.index >= line.start && match.index < line.end)) continue;
    let value = match[0].replace(/[.,;!?:，。；！、：）】》]+$/u, '');
    while (value.endsWith(')') && (value.match(/\)/gu) || []).length > (value.match(/\(/gu) || []).length) value = value.slice(0,-1);
    const url = safeLinkTarget(value); if (url) ranges.push({start:match.index, end:match.index + value.length, url});
  }
  return ranges.sort((a,b)=>a.start-b.start);
}
export function pageChrome(project) {
  const style = documentStyle(project);
  return { top: style.continuationHeader ? 22 : 16, bottom: style.pageNumbers ? 21 : 16 };
}
export function analyzeDocumentQuality(project, result) {
  const style = documentStyle(project), pages = Math.max(1, result.pages || 1), visible = project.blocks.filter(block => !block.hiddenLanguages?.includes(project.language) && block.kind !== 'line' && (block.kind !== 'shape' || block.image));
  const byPage = Array.from({length:pages}, () => []);
  for (const block of visible) { const frame = result.positions?.[block.id]; if (frame && byPage[frame.page]) byPage[frame.page].push({block,frame}); }
  const sideBoundary = 16 + Math.min(53,project.paper.width * .28) + 10;
  const emptySidebarPages = project.template === 'sidebar' && byPage.some(items => items.some(({block,frame}) => textBlock(block) && flowColumn(block,project.language)==='side' && frame.x < sideBoundary)) ? byPage.flatMap((items,page) => page > 0 && !items.some(({frame}) => frame.x < sideBoundary && frame.width <= Math.min(53,project.paper.width * .28) + 1) ? [page] : []) : [];
  const last = byPage.at(-1), chars = last.reduce((count,{block}) => count + ['title','subtitle','body'].reduce((sum,key) => sum + (block[project.language]?.[key]?.length || 0),0),0);
  const extent = last.length ? Math.max(...last.map(({frame}) => frame.y + frame.height)) - Math.min(...last.map(({frame}) => frame.y)) : 0;
  const sparseLastPage = pages > 1 && extent < (project.paper.height - 32) * .3 && chars < 500;
  const issues = [];
  if (style.targetPages && pages > style.targetPages) issues.push(`当前${pages}页，超过目标${style.targetPages}页。可预览调整间距，或自行精简内容。`);
  if (sparseLastPage) issues.push(`末页内容较少（约${Math.round(extent)}mm高），可检查是否适合并入前页。`);
  const remaining = emptySidebarPages.filter(page => !(result.collapsedSidebarPages || []).includes(page));
  if (remaining.length) issues.push(`第${remaining.map(page => page + 1).join('、')}页侧栏为空，可预览收起。`);
  return {pages, targetPages:style.targetPages, sparseLastPage, emptySidebarPages, issues};
}
