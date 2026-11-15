import {requestAiRuleNavigation} from './ai-rule-controls.mjs';
import {experienceFieldDefinitions,getExperience,validateExperienceFields} from '../core/library-experience.mjs';
import {updateLinkLines,personWebsiteLabel,validatePersonLinks,canonicalHttpLink} from '../core/document-style.mjs';
import { clone, $, $$ } from './helpers.mjs';
import { setBlockText } from '../core/rich-text.mjs';
import { setPeriod } from '../core/entry-content.mjs';
import { updateLanguageReview, markLanguageReviewed } from '../core/bilingual-review.mjs';
import { libraryFormValues, clearLibraryDraft } from './library-drafts.mjs';
import {createBilingualSyncPlan} from '../core/bilingual-sync.mjs';
import {rememberLibraryBilingualSync,offerLibraryBilingualSync} from './bilingual-sync.mjs';

const has = (values,field) => typeof values?.has === 'function' ? values.has(field) : Object.prototype.hasOwnProperty.call(values||{},field);
const get = (values, field) => String(typeof values?.get === 'function' ? values.get(field) || '' : values?.[field] || '').trim();
export function readLibraryForm(library, { selection = 'person', language = 'zh' } = {}, values = {}) {
  if (!['zh', 'en'].includes(language)) throw new Error('资料语言无效。');
  const next = clone(library), entry = next.entries.find(item => item.id === selection);
  if (selection === 'attachments') return next;
  if (selection === 'person') {
    for (const field of ['name', 'headline', 'city']) next.person[language][field] = get(values, field);
    for (const field of ['email', 'phone', 'website']) next.person[field] = get(values, field);
    if(has(values,'websiteLabel') && get(values,'websiteLabel')!==personWebsiteLabel(next.person,language))next.person.websiteLabelByLanguage={...next.person.websiteLabelByLanguage,[language]:get(values,'websiteLabel')};
    if(has(values,'linksText'))next.person.links=updateLinkLines(get(values,'linksText'),next.person.links,language);
    validatePersonLinks(next.person);
    if(createBilingualSyncPlan(library,next,{scope:'library',selection:'person',language}).changes.length){next.person.stale||={zh:false,en:false};next.person.stale[language]=false;next.person.stale[language==='zh'?'en':'zh']=true;}
  } else {
    if (!entry) throw new Error('正在编辑的经历已不存在，请保留草稿后重新选择。');
    entry.category = get(values, 'category'); setPeriod(entry, language, get(values, 'period'));
    entry.tags = [...new Set(get(values, 'tags').split(/[,，、\n]/u).map(value => value.trim()).filter(Boolean))];
    for (const field of ['title', 'subtitle', 'body']) setBlockText(entry, language, field, get(values, field));
    const before=library.entries.find(item=>item.id===selection);
    const metadata={...getExperience(entry,language)};
    for(const def of experienceFieldDefinitions)if(has(values,def.key)){
      let value=get(values,def.key);
      // Older accepted values remain readable/editable. New destinations use
      // the same canonical full-URL rule as PDF verification links.
      if(def.key==='certificateUrl' && value && value!==getExperience(before,language).certificateUrl){
        const canonical=canonicalHttpLink(value);
        if(!canonical)throw new Error('证书核验链接需要完整的http或https地址，且不能包含控制字符。');
        value=canonical;
      }
      if(value)metadata[def.key]=value;else delete metadata[def.key];
    }
    if(has(values,'showCompanyTenure')){if(['true','on','1'].includes(get(values,'showCompanyTenure')))metadata.showCompanyTenure=true;else delete metadata.showCompanyTenure;}
    if(Object.keys(metadata).length||entry.experienceByLanguage?.[language])entry.experienceByLanguage={...entry.experienceByLanguage,[language]:metadata};
    if(has(values,'companyGroupId'))entry.companyGroupId=get(values,'companyGroupId');
    if(has(values,'attachmentIdsText')){let ids;try{ids=JSON.parse(get(values,'attachmentIdsText'));}catch{throw new Error('附件关联内容无效。');}entry.attachmentIds=ids;}
    validateExperienceFields(entry);
    updateLanguageReview(before, entry, language);
    if(JSON.stringify(getExperience(before,language))!==JSON.stringify(getExperience(entry,language))){entry.stale||={zh:false,en:false};entry.stale[language]=false;entry.stale[language==='zh'?'en':'zh']=true;}
  }
  return next;
}
export async function saveLibraryForm(ctx, { form = globalThis.document?.querySelector('#library-form'), values, offerAi = true } = {}) {
  if(ctx.ui.librarySaving)return false;
  if (!form) { if (!ctx.ui.dirtyLibrary) return true; ctx.notify?.('当前资料表单已离开，请返回资料库恢复草稿后保存。', true); return false; }
  if (form.reportValidity && !form.reportValidity()) return false;
  const selection = ctx.ui.librarySelection, language = ctx.ui.libraryLanguage;
  const draftId = `${selection || 'person'}:${language || 'zh'}`;
  const captured=values || libraryFormValues(form);
  const template=form.cloneNode?.(true) || form;
  const controls=Array.from(form.elements||[]).map(control=>[control,control.disabled]);
  const wasInert=Boolean(form.inert);form.inert=true;for(const [control]of controls)control.disabled=true;ctx.ui.librarySaving=true;
  const submit = form.querySelector?.('button[type="submit"]'); if (submit) submit.disabled = true;
  try {
    const beforeLibrary=clone(ctx.state.library);
    const next = readLibraryForm(beforeLibrary, { selection, language }, captured);
    const syncPlan=createBilingualSyncPlan(beforeLibrary,next,{scope:'library',selection,language});
    const changed=JSON.stringify(next)!==JSON.stringify(ctx.state.library);
    await ctx.saveLibrary(next); ctx.ui.dirtyLibrary = false; clearLibraryDraft(ctx, draftId); ctx.refreshSaveStatus?.({ clearError: true });
    rememberLibraryBilingualSync(ctx,syncPlan,{beforeLibrary});
    if (offerAi && changed && typeof ctx.offerLibrarySaveAi === 'function') return (await ctx.offerLibrarySaveAi({ form:template, values:captured, selection, language, savedLibrary:clone(next), beforeLibrary, syncPlan })) !== false;
    if(offerAi&&syncPlan.changes.length)return offerLibraryBilingualSync(ctx,syncPlan,{beforeLibrary});
    return true;
  } catch (error) { ctx.notify?.(error.message, true); return false; }
  finally { ctx.ui.librarySaving=false;form.inert=wasInert;for(const [control,disabled]of controls)control.disabled=disabled;if (submit?.isConnected) submit.disabled = false; }
}

export async function markLibraryLanguageReviewed(ctx) {
  if (ctx.ui.librarySaving) { ctx.notify?.('正在保存资料，请稍候。'); return false; }
  if (ctx.ui.dirtyLibrary) { ctx.notify?.('请先保存或放弃表单修改，再标记已核对。'); return false; }
  const next = clone(ctx.state.library), entry = ctx.ui.librarySelection==='person'?next.person:next.entries.find(item => item.id === ctx.ui.librarySelection);
  if (!entry) { ctx.notify?.('正在核对的经历已不存在，请重新选择。', true); return false; }
  try {
    if (!markLanguageReviewed(entry, ctx.ui.libraryLanguage)) return true;
    ctx.ui.librarySaving = true;
    await ctx.saveLibrary(next);
    ctx.notify?.('当前语言已核对，另一版状态保持不变。');
    return true;
  } catch (error) { ctx.notify?.(error.message, true); return false; }
  finally { ctx.ui.librarySaving = false; }
}

export function chooseLibraryNavigation(ctx) {
  if (ctx.chooseLibraryNavigation) return ctx.chooseLibraryNavigation();
  return new Promise(resolve => {
    let settled = false;
    const dialog = globalThis.document?.querySelector('#modal');
    const finish = choice => { if (settled) return; settled = true; dialog?.removeEventListener('close', cancel); dialog?.removeEventListener('cancel', cancel); resolve(choice); };
    const cancel = () => finish('cancel');
    ctx.modal('保存资料后继续？', '当前表单有未保存修改。保存后继续，也可以放弃本次表单修改或返回继续填写。', '<div class="modal-actions"><button class="button secondary" data-library-leave="cancel">返回填写</button><button class="button quiet danger" data-library-leave="discard">放弃修改并继续</button><button class="button primary" data-library-leave="save">保存并继续</button></div>', root => {
      $$('[data-library-leave]', root).forEach(button => { button.onclick = () => { finish(button.dataset.libraryLeave); ctx.closeModal(); }; });
    });
    dialog?.addEventListener('close', cancel, { once: true }); dialog?.addEventListener('cancel', cancel, { once: true });
  });
}
export async function requestLibraryNavigation(ctx, continuation, options = {}) {
  if(ctx.ui.librarySaving){ctx.notify?.('正在保存资料，请稍候。');return false;}
  if (ctx.ui.libraryNavigationPending) return false;
  ctx.ui.libraryNavigationPending = true;
  try {
    if (!await requestAiRuleNavigation(ctx)) return false;
    if (ctx.ui.dirtyLibrary) {
      const choice = await chooseLibraryNavigation(ctx);
      if (choice === 'save') { if (!await saveLibraryForm(ctx, {offerAi:false,...options})) return false; }
      else if (choice === 'discard') { clearLibraryDraft(ctx); ctx.ui.dirtyLibrary = false; ctx.refreshSaveStatus?.({ clearError: true }); if (ctx.ui.screen === 'library') ctx.render?.(); }
      else return false;
    }
    // The decision is settled before running the destination. A destination
    // such as sample loading may itself call the shared navigation helper.
    ctx.ui.libraryNavigationPending = false;
    await continuation?.(); return true;
  } finally { ctx.ui.libraryNavigationPending = false; }
}
