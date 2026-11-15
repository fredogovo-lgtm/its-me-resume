import {runStateTransaction} from './state-transactions.mjs';
import {confirmPersonalTemplateImpact} from './personal-template-review.mjs';
import { createPersonalTemplate, applyPersonalTemplate } from '../core/personal-templates.mjs';
import { escape } from './helpers.mjs';
import { measureTextBlock } from './resume-view.mjs';

const LIMIT = 30;
const baseNames = { classic: '经典单栏', sidebar: '有序分栏', blank: '空白画布' };
const templatesOf = ctx => ctx.state.personalTemplates ?? [];
const summary = template => `${baseNames[template.base] || '个人版式'} · ${template.paper.name} · ${template.mode === 'free' ? '自由摆放' : '模板排版'}`;
const actions = confirm => `<div class="modal-actions"><button type="button" class="button secondary" data-cancel-personal-template>取消</button>${confirm}</div>`;

function saveCurrentDesign(ctx) {
  if (!ctx.project) return;
  if (templatesOf(ctx).length >= LIMIT) return ctx.notify('最多保存 30 个个人模板，请先删除不再需要的模板。');
  const projectId = ctx.project.id;
  ctx.modal('将当前设计保存为个人模板', '保存纸张、字体、颜色、布局和装饰，供其他简历复用。不会保存姓名、正文、个人照片或补充文件；主动加入的图片素材会随装饰保存。',
    `<form id="personal-template-name-form" class="personal-template-dialog"><label class="field"><span>模板名称</span><input name="templateName" maxlength="80" required placeholder="例如：产品岗位单页" autocomplete="off"></label><p class="personal-template-note">当前简历继续保留原有内容。个人模板仅保存在本机，最多 30 个。</p>${actions('<button type="submit" class="button primary">保存个人模板</button>')}</form>`, root => {
      const form = root.querySelector('form');
      const input = form.elements.templateName;
      const submit = form.querySelector('[type="submit"]');
      let busy = false;
      root.querySelector('[data-cancel-personal-template]').onclick = () => ctx.closeModal();
      input.focus();
      form.onsubmit = async event => {
        event.preventDefault();
        if (busy) return;
        busy = true; submit.disabled = true;
        try {
          await runStateTransaction(ctx,'正在保存个人模板',async()=>{await ctx.flush();
          if (ctx.project?.id !== projectId) throw new Error('当前简历已改变，请关闭后重新保存模板。');
          const templates = templatesOf(ctx);
          if (templates.length >= LIMIT) throw new Error('最多保存 30 个个人模板，请先删除不再需要的模板。');
          const template = createPersonalTemplate(ctx.project, input.value, ctx.layoutResult?.positions ?? {});
          ctx.merge(await window.resume.savePersonalTemplates([template,...templates]));});
          if (form.isConnected) ctx.closeModal();
          ctx.render(); ctx.notify('个人模板已保存到本机');
        } catch (error) {
          ctx.notify(`模板未能保存：${error.message}`, true);
        } finally {
          busy = false;
          if (submit.isConnected) submit.disabled = false;
        }
      };
    });
}

async function applySavedDesign(ctx, id) {
  const source = templatesOf(ctx).find(item => item.id === id);
  if (!source || !ctx.project) return;
  const template = structuredClone(source), projectId = ctx.project.id;
  let applied=false;
  try {
    await ctx.flush();
    if(ctx.project?.id!==projectId)throw new Error('当前简历已改变，请重新选择模板。');
    const before=structuredClone(ctx.project),snapshot=JSON.stringify(before),templateSnapshot=JSON.stringify(template);
    const next=applyPersonalTemplate(before,template,{measureBlock:measureTextBlock});
    const accepted=await confirmPersonalTemplateImpact(ctx,before,next,{name:template.name,isCurrent:()=>ctx.project?.id===projectId&&JSON.stringify(ctx.project)===snapshot&&JSON.stringify(templatesOf(ctx).find(item=>item.id===id))===templateSnapshot});
    if(!accepted)return;
    if (ctx.ui) ctx.ui.selectedBlockId = null;
    ctx.updateProject(project => { Object.keys(project).forEach(key => delete project[key]); Object.assign(project, next); });
    applied=true;await ctx.flush();ctx.notify('个人模板已应用，文字和照片保留；可撤销本次操作');
  } catch(error) {ctx.notify(`${applied?'版式已应用，保存未完成':'模板未能应用'}：${error.message}`,true);}
}

function deleteSavedDesign(ctx, id) {
  const template = templatesOf(ctx).find(item => item.id === id);
  if (!template) return;
  ctx.modal('删除个人模板', '只从个人模板列表中删除，已应用此模板的简历保持原样。',
    `<div class="personal-template-dialog"><p>删除“<strong>${escape(template.name)}</strong>”？</p>${actions('<button type="button" class="button secondary danger" data-confirm-delete-personal-template>删除此模板</button>')}</div>`, root => {
      const confirm = root.querySelector('[data-confirm-delete-personal-template]');
      let busy = false;
      root.querySelector('[data-cancel-personal-template]').onclick = () => ctx.closeModal();
      confirm.onclick = async () => {
        if (busy) return;
        busy = true; confirm.disabled = true;
        try {
          await runStateTransaction(ctx,'正在删除个人模板',async()=>{await ctx.flush();
          ctx.merge(await window.resume.savePersonalTemplates(templatesOf(ctx).filter(item=>item.id!==id)));});
          if (root.contains(confirm)) ctx.closeModal();
          ctx.render(); ctx.notify('个人模板已删除，已有简历保持原样');
        } catch (error) {
          ctx.notify(`模板未能删除：${error.message}`, true);
        } finally {
          busy = false;
          if (confirm.isConnected) confirm.disabled = false;
        }
      };
    });
}

/** Mount inside the existing template sidebar; applying a design is one project edit. */
export function mountPersonalTemplates(ctx, host) {
  if (!host) return;
  const templates = templatesOf(ctx).slice(0, LIMIT), full = templatesOf(ctx).length >= LIMIT;
  host.classList.add('personal-templates-panel');
  host.innerHTML = `<div class="personal-templates-heading"><h3>个人模板</h3><span>${templates.length} / ${LIMIT}</span></div><p class="personal-template-note">留住调好的版式，在其他简历中复用。</p><button type="button" class="button secondary personal-template-save" data-action="save-personal-template" ${full || !ctx.project ? 'disabled' : ''}>将当前设计保存为个人模板</button>${full ? '<p class="personal-template-limit" role="status">已保存 30 个，请先删除不再需要的模板。</p>' : ''}${templates.length ? `<div class="personal-template-list">${templates.map(template => `<section class="personal-template-item"><strong>${escape(template.name)}</strong><small>${escape(summary(template))}</small><div class="personal-template-actions"><button type="button" class="button secondary" data-apply-personal-template="${escape(template.id)}" aria-label="${escape('应用模板：' + template.name)}" ${ctx.project ? '' : 'disabled'}>应用</button><button type="button" class="button quiet danger" data-delete-personal-template="${escape(template.id)}" aria-label="${escape('删除模板：' + template.name)}">删除</button></div></section>`).join('')}</div>` : '<p class="personal-template-empty">还没有个人模板。调好当前简历后，在这里保存设计。</p>'}`;
  host.querySelector('[data-action="save-personal-template"]').onclick = () => saveCurrentDesign(ctx);
  host.querySelectorAll('[data-apply-personal-template]').forEach(button => { button.onclick = () => applySavedDesign(ctx, button.dataset.applyPersonalTemplate); });
  host.querySelectorAll('[data-delete-personal-template]').forEach(button => { button.onclick = () => deleteSavedDesign(ctx, button.dataset.deletePersonalTemplate); });
}
