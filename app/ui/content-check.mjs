import { findProjectContentIssues } from '../core/content-check.mjs';
import { escape } from './helpers.mjs';

/** Mount a soft warning without blocking editing or deciding for the user. */
export function renderContentWarning(ctx, root = document.querySelector('#content-warning')) {
  const issues = findProjectContentIssues(ctx.project);
  if (!root) return issues;
  root.hidden = !issues.length;
  root.classList.add('content-warning');
  root.setAttribute('role', 'status');
  if (!issues.length) { root.replaceChildren(); return issues; }
  const language = ctx.project.language === 'en' ? '英文' : '中文';
  root.innerHTML = `<div class="content-warning-copy"><strong>${language}版有 ${issues.length} 个模块待补充</strong><span>${escape(issues[0].message)}可在纸面补写，或按当前内容继续导出。</span></div><button type="button" class="button quiet" data-locate-content-issue>查看首个模块</button>`;
  root.querySelector('[data-locate-content-issue]').onclick = () => {
    const issue = findProjectContentIssues(ctx.project)[0];
    if (!issue) return;
    ctx.ui.selectedBlockId = issue.blockId;
    ctx.ui.editorTab = 'content';
    ctx.ui.inspectorPanels ||= {};
    ctx.ui.inspectorPanels.text ||= {};
    ctx.ui.inspectorPanels.text.content = true;
    ctx.render();
    requestAnimationFrame(() => {
      const article = Array.from(document.querySelectorAll('#resume-pages [data-block-id]')).find(element => element.dataset.blockId === issue.blockId);
      article?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const field = issue.fields.find(value => ['title', 'subtitle', 'body'].includes(value));
      document.querySelector(`#block-form [name="${field || 'title'}"]`)?.focus({ preventScroll: true });
    });
  };
  return issues;
}
