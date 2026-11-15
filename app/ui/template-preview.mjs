import { renderResume } from './resume-view.mjs';
import { sidebarIsAvailable } from '../core/template-layout.mjs';
import { findProjectContentIssues } from '../core/content-check.mjs';
import { escape } from './helpers.mjs';
import { applyLayoutMode } from './language-layout.mjs';

const pxPerMm = 96 / 25.4;
const titles = { classic: '经典单栏', sidebar: '有序分栏', blank: '空白画布' };
const cache = new WeakMap();
const create = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };

function variant(source, template) {
  const project = structuredClone(source);
  project.template = template;
  // Preview the same restoration behavior as selecting a template in the editor.
  if (template !== 'blank') applyLayoutMode(project, 'flow');
  else if (project.mode !== 'free') {
    const staging = create('div');
    staging.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden';
    document.body.append(staging);
    try { applyLayoutMode(project, 'free', renderResume(staging, project).positions); }
    finally { staging.remove(); }
  }
  return project;
}
function selectedTemplate(root, fallback) {
  return root.querySelector('input[name="template"]:checked')?.value || root.querySelector('[data-template].selected')?.dataset.template || fallback || 'classic';
}
function layoutNote(project) {
  return project.template === 'sidebar' && project.mode !== 'free' && !sidebarIsAvailable(project)
    ? '未选教育、技能或证书，当前自动使用单栏；加入这些资料后会自动分栏。' : '';
}

export function showTemplatePreview(ctx, source, template = source.template, { note = '' } = {}) {
  const project = variant(source, template);
  const language = project.language === 'en' ? '英文' : '中文';
  ctx.modal(titles[template] + ' · 实际内容预览', `${language} · ${project.paper.name} · ${project.paper.width} × ${project.paper.height} mm；这里只预览，不会改动当前简历。`, '<div class="template-preview-dialog"><div class="template-preview-meta" role="status"></div><div class="template-preview-sheet-area"><div class="template-preview-document"></div></div></div>', root => {
    const area = root.querySelector('.template-preview-sheet-area');
    const documentRoot = root.querySelector('.template-preview-document');
    const result = renderResume(documentRoot, project);
    const contentIssues = findProjectContentIssues(project);
    const meta = root.querySelector('.template-preview-meta');
    const messages = [note, layoutNote(project), contentIssues.length ? `${language}版有 ${contentIssues.length} 个模块待补充，预览中不会自动填入另一语言。` : '', result.warnings.length ? `有 ${result.warnings.length} 处排版提示，需在编辑中处理后导出。` : ''].filter(Boolean);
    meta.innerHTML = `<strong data-template-full-page-count>${result.pages} 页</strong>${messages.map(message => `<p>${escape(message)}</p>`).join('')}`;
    const viewport = root.querySelector('.template-preview-dialog');
    const viewportStyle = getComputedStyle(viewport);
    const availableWidth = viewport.clientWidth - parseFloat(viewportStyle.paddingLeft) - parseFloat(viewportStyle.paddingRight);
    const scale = Math.min(1, Math.max(.15, availableWidth / (project.paper.width * pxPerMm)));
    documentRoot.style.width = `${project.paper.width * pxPerMm}px`;
    const fullHeight = Math.max(documentRoot.scrollHeight, documentRoot.offsetHeight, result.pages * (project.paper.height * pxPerMm + 34));
    area.style.width = `${project.paper.width * pxPerMm * scale}px`;
    area.style.height = `${fullHeight * scale}px`;
    documentRoot.style.transform = `scale(${scale})`;
  });
}

/** Replace only schematic artwork; existing selection controls retain listeners. */
export function renderTemplateThumbnails(ctx, root, source = ctx.project, { note = '' } = {}) {
  if (!root || !source) return null;
  // Newly constructed wizard snapshots have fresh IDs on every keystroke; IDs
  // do not change the picture and should not force all templates to remeasure.
  const blocksForPicture = source.blocks.map(({ id, ...block }) => block);
  const fingerprint = JSON.stringify({ language: source.language, mode: source.mode, paper: source.paper, accent: source.accent, fontFamily: source.fontFamily, fontSize: source.fontSize, blocks: blocksForPicture, freeLayoutByLanguage: source.freeLayoutByLanguage, note });
  let mounted = cache.get(root);
  if (!mounted || mounted.fingerprint !== fingerprint) {
    const results = new Map();
    for (const card of root.querySelectorAll('.template-choice, [data-template]')) {
      const template = card.querySelector('input[name="template"]')?.value || card.dataset.template;
      if (!titles[template]) continue;
      const preview = variant(source, template);
      const frame = create('div', 'template-live-preview');
      frame.setAttribute('aria-hidden', 'true');
      const pages = create('div', 'template-preview-pages');
      frame.append(pages);
      const old = card.querySelector('.template-mini, .template-live-preview');
      if (old) old.replaceWith(frame); else card.prepend(frame);
      const rendered = renderResume(pages, preview);
      const scale = Math.max(.01, frame.clientWidth / (preview.paper.width * pxPerMm));
      pages.style.transform = `scale(${scale})`;
      frame.style.height = `${preview.paper.height * pxPerMm * scale}px`;
      // All pages are measured before the thumbnail is reduced to its first page.
      for (const extra of Array.from(pages.children).slice(1)) extra.remove();
      const textRoot = card.matches('.template-choice') ? card.querySelector(':scope > span:last-child') || card : card;
      const caption = card.querySelector('.template-live-caption') || create('em', 'template-live-caption');
      caption.textContent = `${rendered.pages} 页 · 当前所选内容`;
      if (!caption.isConnected) textRoot.append(caption);
      const information = card.querySelector('.template-layout-note') || create('span', 'template-layout-note');
      information.textContent = layoutNote(preview);
      information.hidden = !information.textContent;
      if (!information.isConnected) textRoot.append(information);
      results.set(template, rendered);
    }
    root.querySelector(':scope > .template-preview-tools')?.remove();
    const tools = create('div', 'template-preview-tools');
    const enlarge = create('button', 'button secondary'); enlarge.type = 'button'; enlarge.dataset.enlargeTemplate = '';
    const provenance = create('p', 'template-preview-provenance', note); provenance.hidden = !note;
    tools.append(enlarge, provenance); root.append(tools);
    mounted = { fingerprint, results, enlarge, source: structuredClone(source), note };
    enlarge.onclick = event => { event.preventDefault(); event.stopPropagation(); showTemplatePreview(ctx, mounted.source, selectedTemplate(root, source.template), { note: mounted.note }); };
    cache.set(root, mounted);
  }
  const selected = selectedTemplate(root, source.template);
  mounted.enlarge.textContent = `放大所选模板 · ${mounted.results.get(selected)?.pages || 1} 页`;
  mounted.enlarge.setAttribute('aria-label', `放大查看${titles[selected] || '所选模板'}的全部页面`);
  return { selected, results: mounted.results };
}
