import { analyzeDocumentQuality, documentStyle, setGlobalDocumentStyle } from '../core/document-style.mjs';
import { renderResume } from './resume-view.mjs';
import { applyLayoutMode } from './language-layout.mjs';
export function buildDocumentQualityCandidate(project, {compact = false, reflow = false, collapsedPages = []} = {}) {
  const candidate = structuredClone(project), style = documentStyle(project);
  if (compact) setGlobalDocumentStyle(candidate,{lineHeight:Math.min(style.lineHeight,1.5),sectionSpacing:Math.min(style.sectionSpacing,5)});
  if (reflow) applyLayoutMode(candidate,'flow');
  if (candidate.mode === 'flow' && project.template === 'sidebar' && (collapsedPages.length || style.collapsedSidebarPages?.[project.language]?.length)) {
    setGlobalDocumentStyle(candidate,{collapsedSidebarPages:{...style.collapsedSidebarPages,[project.language]:[...new Set(collapsedPages)].sort((a,b) => a-b)}});
  }
  return candidate;
}
export function renderDocumentQuality(ctx, root) {
  const quality = analyzeDocumentQuality(ctx.project,ctx.layoutResult);
  root.replaceChildren(); root.hidden = !quality.issues.length;
  if (!quality.issues.length) return;
  const text = document.createElement('span'); text.textContent = quality.issues.join(' '); root.append(text);
  const action = document.createElement('button'); action.type = 'button'; action.className = 'button quiet'; action.textContent = '预览排版方案'; action.onclick = () => previewDocumentQuality(ctx); root.append(action);
}
export function previewDocumentQuality(ctx) {
  const original = structuredClone(ctx.project), signature = JSON.stringify(original), initial = analyzeDocumentQuality(original,ctx.layoutResult), style = documentStyle(original);
  ctx.modal('预览排版方案', '方案只在此窗口预览。检查每页后再采用；采用后可一次撤销。', `<div class="document-quality-dialog"><div class="document-quality-options"><label class="check-row"><input type="checkbox" data-compact>紧凑间距：全局行距最多1.5倍、模块后间距最多5mm（保留局部覆盖）</label>${original.mode === 'free' ? '<label class="check-row"><input type="checkbox" data-reflow>将当前语言转为模板排版并重新排列文字</label><p class="panel-help">当前是自由摆放；勾选后才会重排。未勾选时保留坐标。</p>' : ''}${original.template === 'sidebar' ? `<p class="panel-help">仅收起没有侧栏内容的续页；有侧栏资料的页保持两栏。</p>${initial.emptySidebarPages.map(page => `<label class="check-row"><input type="checkbox" data-collapse-page="${page}" ${style.collapsedSidebarPages?.[original.language]?.includes(page)?'checked':''}>收起第${page + 1}页空侧栏</label>`).join('') || '<p class="panel-help">当前没有可收起的空侧栏续页。</p>'}` : ''}</div><p data-quality-summary role="status"></p><div class="document-quality-preview" aria-label="排版方案逐页预览"></div><div class="modal-actions"><button type="button" class="button secondary" data-quality-cancel>返回</button><button type="button" class="button primary" data-quality-apply disabled>采用已预览方案</button></div></div>`, root => {
    const preview = root.querySelector('.document-quality-preview'), summary = root.querySelector('[data-quality-summary]'), apply = root.querySelector('[data-quality-apply]'); let candidate;
    const rebuild = () => {
      const compact = root.querySelector('[data-compact]').checked, reflow = Boolean(root.querySelector('[data-reflow]')?.checked);
      const choices = [...root.querySelectorAll('[data-collapse-page]:checked')].map(input => Number(input.dataset.collapsePage));
      candidate = buildDocumentQualityCandidate(original,{compact,reflow,collapsedPages:choices});
      for (const checkbox of root.querySelectorAll('[data-collapse-page]')) checkbox.disabled = candidate.mode !== 'flow';
      const result = renderResume(preview,candidate), quality = analyzeDocumentQuality(candidate,result), problems = result.warnings.length + result.overlaps.length;
      summary.textContent = `${original.blocks.filter(block => !block.hiddenLanguages?.includes(original.language)).length}个模块完整保留 · ${result.pages}页${quality.targetPages ? ` / 目标${quality.targetPages}页` : ''}${problems ? ` · ${problems}项溢出或重叠，请返回调整后再采用` : ' · 未检测到溢出或文字重叠'}${quality.sparseLastPage ? ' · 末页仍较稀疏' : ''}`;
      apply.disabled = problems > 0 || JSON.stringify(candidate) === signature;
    };
    root.querySelector('[data-quality-cancel]').onclick = () => ctx.closeModal();
    root.querySelector('.document-quality-options').onchange = rebuild;
    apply.onclick = () => {
      if (JSON.stringify(ctx.project) !== signature) return ctx.notify('当前简历已经改变，请关闭此预览后重新检查。',true);
      const result = renderResume(preview,candidate);
      if (result.warnings.length || result.overlaps.length) return ctx.notify('方案仍有排版问题，请返回调整。',true);
      ctx.closeModal(); ctx.updateProject(next => { Object.keys(next).forEach(key => delete next[key]); Object.assign(next,structuredClone(candidate)); });
    };
    rebuild();
  });
}
