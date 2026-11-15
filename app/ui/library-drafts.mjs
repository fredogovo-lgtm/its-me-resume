import {experienceFieldDefinitions} from '../core/library-experience.mjs';
import {updateExperienceCategory} from './experience-controls.mjs';
import { escape, $, $$ } from './helpers.mjs';

const allowed = ['name', 'headline', 'city', 'email', 'phone', 'website', 'category', 'period', 'title', 'subtitle', 'body', 'tags', 'websiteLabel', 'linksText', 'companyGroupId', 'showCompanyTenure', 'attachmentIdsText', ...experienceFieldDefinitions.map(field=>field.key)];
const key = ctx => `its-me:library-drafts:v1:${ctx.draftScope || 'default'}`;
const storage = ctx => { try { return ctx.draftStorage || globalThis.localStorage; } catch { return null; } };
const identity = ctx => `${ctx.ui.librarySelection || 'person'}:${ctx.ui.libraryLanguage || 'zh'}`;
function read(ctx) { try { const value = JSON.parse(storage(ctx)?.getItem(key(ctx)) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } }
function write(ctx, drafts) { try { storage(ctx)?.setItem(key(ctx), JSON.stringify(drafts)); return true; } catch { if (!ctx.ui.libraryDraftErrorShown) { ctx.ui.libraryDraftErrorShown = true; ctx.notify?.('表单草稿暂未能写入本机，请及时保存资料。', true); } return false; } }
export function libraryFormValues(form) {
  return Object.fromEntries(allowed.flatMap(name => {
    if(name==='attachmentIdsText'){const controls=Array.from(form?.elements||[]).filter(control=>control.name==='linkedAttachment');return controls.length||form?.elements?.category ? [[name,JSON.stringify(controls.filter(control=>control.checked).map(control=>control.value))]]:[];}
    const control = form?.elements?.namedItem?.(name) || form?.elements?.[name];
    if(name==='showCompanyTenure'&&control)return [[name,String(Boolean(control.checked))]];
    return control && typeof control.value === 'string' ? [[name, control.value]] : []; }));
}
function preserveDraft(drafts,id) {
  const draft=drafts[id];if(!draft)return;
  const kept=id+':preserved:'+crypto.randomUUID();drafts[kept]={...draft,id:kept};delete drafts[id];
}
export function saveLibraryDraft(ctx, values) {
  const drafts = read(ctx), clean = {};
  for (const name of allowed) if (typeof values?.[name] === 'string') clean[name] = values[name];
  const entry = ctx.state.library.entries.find(item => item.id === ctx.ui.librarySelection);
  const current=identity(ctx);ctx.ui.libraryDraftWorkingIds||={};
  if(!ctx.ui.libraryDraftWorkingIds[current]&&drafts[current])preserveDraft(drafts,current);
  ctx.ui.libraryDraftWorkingIds[current]=true;
  drafts[current] = { id: identity(ctx), selection: ctx.ui.librarySelection || 'person', language: ctx.ui.libraryLanguage || 'zh', label: entry?.[ctx.ui.libraryLanguage]?.title || (entry ? '未命名经历' : '基本信息'), updatedAt: new Date().toISOString(), values: clean };
  return write(ctx, drafts);
}
export function listLibraryDrafts(ctx) { return Object.values(read(ctx)).filter(row => row && ['zh', 'en'].includes(row.language) && typeof row.selection === 'string' && row.values && typeof row.values === 'object').sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))); }
export function clearLibraryDraft(ctx, id = identity(ctx)) { const drafts = read(ctx); delete drafts[id]; return write(ctx, drafts); }
export function applyLibraryDraft(ctx, draft, form = globalThis.document?.querySelector('#library-form')) {
  if (!draft || !form) return false;
  const drafts=read(ctx),current=identity(ctx);
  if(draft.id!==current){if(drafts[current])preserveDraft(drafts,current);delete drafts[draft.id];drafts[current]={...draft,id:current};write(ctx,drafts);}
  ctx.ui.libraryDraftWorkingIds||={};ctx.ui.libraryDraftWorkingIds[current]=true;
  for (const name of allowed) {
    const control = form.elements?.namedItem?.(name) || form.elements?.[name];
    if(name==='attachmentIdsText'&&typeof draft.values?.[name]==='string'){try{const ids=JSON.parse(draft.values[name]);for(const item of Array.from(form.elements||[]).filter(item=>item.name==='linkedAttachment'))item.checked=ids.includes(item.value);}catch{}continue;}
    if(name==='showCompanyTenure'&&control&&typeof draft.values?.[name]==='string'){control.checked=draft.values[name]==='true';continue;}
    if (control && typeof draft.values?.[name] === 'string') control.value = draft.values[name];
  }
  updateExperienceCategory(form);
  ctx.ui.dirtyLibrary = true; ctx.refreshSaveStatus?.({ clearError: true });
  const status = globalThis.document?.querySelector('#library-dirty'); if (status) status.textContent = '已恢复未提交草稿，请检查后保存';
  return true;
}
export function bindLibraryDraft(ctx, form) {
  if (!form) return () => {};
  const boundIdentity = identity(ctx);
  const capture = () => {
    // A removed form can dispatch a late blur/change after navigation or restore.
    // Never attach that old form's values to the newly selected person/language.
    if (form.isConnected === false || identity(ctx) !== boundIdentity || ctx.ui.libraryRestoreBusy) return;
    ctx.ui.dirtyLibrary = true; saveLibraryDraft(ctx, libraryFormValues(form)); ctx.refreshSaveStatus?.({ clearError: true });
  };
  form.addEventListener('input', capture);
  form.addEventListener('change',capture);
  return () => {form.removeEventListener('input', capture);form.removeEventListener('change',capture);};
}
export function showLibraryDraftRecovery(ctx) {
  const drafts = listLibraryDrafts(ctx);
  if (!drafts.length) return false;
  ctx.modal('恢复未提交的资料', '上次有尚未保存到资料库的表单。可恢复继续填写；草稿不会自动覆盖已保存资料。', '<div class="library-draft-recovery">' + drafts.map((draft, index) => '<div class="attachment-row"><div><strong>' + escape(draft.label) + ' · ' + (draft.language === 'en' ? 'English' : '中文') + '</strong><p>' + escape(new Date(draft.updatedAt).toLocaleString('zh-CN', { hour12: false })) + '</p></div><div class="button-group"><button class="button secondary" data-restore-library-draft="' + index + '">恢复填写</button><button class="button quiet" data-delete-library-draft="' + index + '">丢弃草稿</button></div></div>').join('') + '<div class="modal-actions"><button class="button secondary" data-action="draft-later">稍后处理</button></div></div>', root => {
    $$('[data-restore-library-draft]', root).forEach(button => { button.onclick = () => {
      const draft = drafts[Number(button.dataset.restoreLibraryDraft)];
      if (draft.selection !== 'person' && !ctx.state.library.entries.some(entry => entry.id === draft.selection)) return ctx.notify('此草稿的原经历已不在资料库。请先恢复相应资料备份后再恢复草稿。', true);
      ctx.closeModal(); ctx.ui.screen = 'library'; ctx.ui.librarySelection = draft.selection; ctx.ui.libraryLanguage = draft.language; ctx.render(); applyLibraryDraft(ctx, draft);
    }; });
    $$('[data-delete-library-draft]', root).forEach(button => { button.onclick = () => { clearLibraryDraft(ctx, drafts[Number(button.dataset.deleteLibraryDraft)].id); ctx.closeModal(); showLibraryDraftRecovery(ctx); }; });
    $('[data-action="draft-later"]', root).onclick = () => ctx.closeModal();
  });
  return true;
}

// Comparison edits are alternatives, not saved library versions. Keep both in
// the existing local draft recovery list with one storage write.
export function preserveLibraryDraftVariants(ctx, variants, {ids}={}) {
  if (!Array.isArray(variants) || !variants.length) return true;
  const drafts=read(ctx), selection=ctx.ui.librarySelection||'person', language=ctx.ui.libraryLanguage||'zh';
  if(ids!==undefined&&(!Array.isArray(ids)||ids.length!==variants.length||ids.some(id=>typeof id!=='string'||!id.startsWith(`${selection}:${language}:preserved:`))))return false;
  for (const [index,variant] of variants.entries()) {
    const values={};
    for (const name of allowed) if (typeof variant.values?.[name]==='string') values[name]=variant.values[name];
    const id=ids?.[index]||`${selection}:${language}:preserved:${crypto.randomUUID()}`;
    drafts[id]={id,selection,language,label:String(variant.label||'对比编辑草稿').slice(0,200),updatedAt:new Date().toISOString(),values};
  }
  return write(ctx,drafts);
}
