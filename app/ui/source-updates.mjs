import { $, $$, escape, categories } from './helpers.mjs';
import { compareProjectSources, applyProjectSourceUpdates } from '../core/source-updates.mjs';

const labels = { name: '姓名', headline: '求职方向', city: '城市', phone: '电话', email: '邮箱', website: '网站', title: '标题', subtitle: '公司 / 补充说明', body: '正文', period: '时间', category: '分类', tags: '标签' };
const valueText = (row, value) => Array.isArray(value) ? value.join('，') : row.field === 'category' ? categories[value] || String(value || '') : String(value ?? '');
export function sourceUpdateNoticeHtml(project, library) {
  if (!project) return '';
  if (!project.blocks.some(block => block.kind === 'profile' || block.kind === 'entry' && block.sourceId)) return '';
  const report = compareProjectSources(project, library);
  if (!report.changes.length && !report.unavailable.length && report.baselineKnown) return '';
  const message = !report.baselineKnown ? '旧项目未保存来源基线，可比较当前简历与资料库。' : report.updateCount ? `资料库有 ${report.updateCount} 项来源更新，当前简历保留原稿。` : '部分来源已不在资料库，当前简历副本仍保留。';
  return `<div class="source-update-notice" role="status"><span>${escape(message)}</span><button type="button" class="button quiet" data-action="source-updates">比较资料来源</button></div>`;
}
export function bindSourceUpdateNotice(ctx, root = globalThis.document) {
  root?.querySelectorAll('[data-action="source-updates"]').forEach(button => { button.onclick = () => showSourceUpdates(ctx); });
}
function rowHtml(row, index) {
  const language = row.language === 'zh' ? '中文' : row.language === 'en' ? 'English' : '中英共用';
  const current = row.kind === 'person' && ['city', 'phone', 'email', 'website'].includes(row.field) ? row.currentText : row.current;
  const known = row.baselineKnown;
  return `<section class="source-update-row"><label class="selection-row"><input type="checkbox" name="sourceChange" value="${index}" ${row.blocked ? 'disabled' : ''}><span><strong>${escape(row.title)} · ${language} · ${escape(labels[row.field] || row.field)}</strong><small>${known ? '资料库来源已更新' : '无旧来源基线，仅比较当前值'}${row.localChanged ? ' · 当前简历含局部改写' : ''}</small></span></label>${row.reason ? `<p class="source-update-protection">${escape(row.reason)}</p>` : row.localChanged ? '<p class="source-update-protection">勾选此项将把这一个字段的局部文案替换为资料库内容；其他字段保留。</p>' : ''}<div class="source-update-comparison">${known ? `<label class="field"><span>上次采用的资料来源</span><textarea readonly rows="3">${escape(valueText(row, row.previous))}</textarea></label>` : ''}<label class="field"><span>当前简历${row.kind === 'person' && ['city', 'phone', 'email', 'website'].includes(row.field) ? '基本信息正文' : '文字'}</span><textarea readonly rows="3">${escape(valueText(row, current))}</textarea></label><label class="field"><span>当前资料库 · ${escape(labels[row.field] || row.field)}</span><textarea readonly rows="3">${escape(valueText(row, row.next))}</textarea></label></div></section>`;
}
export function showSourceUpdates(ctx) {
  if (!ctx.project) return;
  const projectId = ctx.project.id, report = compareProjectSources(ctx.project, ctx.state.library);
  const signature = JSON.stringify(report);
  const description = report.baselineKnown ? '逐项比较并勾选需要采用的新内容。默认保留当前简历；确认后可一次撤销。' : '此旧项目没有保存当时采用的资料来源，无法判断资料库何时发生变化。这里只比较当前值，由你明确选择。';
  const warnings = report.unavailable.map(row => `<p class="source-update-protection"><strong>${escape(row.title)}</strong>：${escape(row.reason)}</p>`).join('');
  const html = `<form id="source-updates-form">${warnings}${report.changes.length ? report.changes.map(rowHtml).join('') : '<p>当前可比较的字段没有差异。</p>'}<div class="modal-actions"><button type="button" class="button secondary" data-action="source-keep">保留当前简历</button><button type="submit" class="button primary" ${report.changes.some(row => !row.blocked) ? '' : 'disabled'}>采用勾选的更新</button></div></form>`;
  ctx.modal('比较资料来源', description, html, root => {
    $('[data-action="source-keep"]', root).onclick = () => ctx.closeModal();
    const form = $('#source-updates-form', root);
    form.onsubmit = async event => {
      event.preventDefault();
      const selected = $$('input[name="sourceChange"]:checked', form).map(control => report.changes[Number(control.value)].id);
      if (!selected.length) return ctx.notify('请勾选要采用的具体字段，或保留当前简历。');
      if (ctx.project?.id !== projectId || JSON.stringify(compareProjectSources(ctx.project, ctx.state.library)) !== signature) return ctx.notify('简历或资料库已改变，请关闭后重新比较。', true);
      const submit = $('button[type="submit"]', form); submit.disabled = true;
      try {
        const next = applyProjectSourceUpdates(ctx.project, ctx.state.library, selected);
        ctx.closeModal();
        ctx.updateProject(project => { Object.keys(project).forEach(key => delete project[key]); Object.assign(project, next); });
        await ctx.flush(); ctx.notify(`已采用 ${selected.length} 项资料更新，可撤销本次操作`);
      } catch (error) { ctx.notify(error.message, true); }
      finally { if (submit.isConnected) submit.disabled = false; }
    };
  });
}
