import {openFullBackupCenter} from './full-backup.mjs';
import {runStateTransaction,stateTransactionBusy} from './state-transactions.mjs';
import {openHelpCenter,clearHelpCenter} from './help-center.mjs';
import {pruneReadingOrder} from '../core/submission.mjs';
import {pruneCanvasGroups} from '../core/canvas-groups.mjs';
import {captureProjectSyncChanges,mountProjectSyncNotice,refreshProjectSyncNotice} from './bilingual-sync.mjs';
import {openResumeImport,hasResumeImportDraft} from './resume-import.mjs';
import {saveGlobalAiRules} from './ai-rule-controls.mjs';
import { $, $$, icon, clone, escape } from './helpers.mjs';
import { sampleLibrary } from './sample.mjs';
import { renderLibrary, showBackups } from './library.mjs';
import { renderEditor } from './editor.mjs';
import { startWizard, renderWizard } from './wizard.mjs';
import { renderProjects } from './projects.mjs';
import { renderHistory, renderSettings } from './history.mjs';
import { requestLibraryNavigation, saveLibraryForm } from './library-navigation.mjs';
import { showLibraryDraftRecovery } from './library-drafts.mjs';
import { userMessage } from './user-message.mjs';
import { saveWizardDraft, loadWizardDraft, restoreWizardDraft, enterAiSettings, returnFromAiSettings } from './wizard-drafts.mjs';
import {openLibraryAi,openProjectAi,openWizardAi} from './ai-context.mjs';
import {offerLibrarySaveAi} from './library-save-ai.mjs';

const api = window.resume;
let state, timer, flushing, toastTimer;
const drafts = new Map(), undos = new Map(), redos = new Map();
const titles = { library: '资料库', projects: '我的简历', history: '导出历史', settings: '设置' };
const ctx = {
  get state() { return state; },
  draftScope: 'default',
  async prepareFullBackup(){
    clearTimeout(timer);
    if(flushing)try{await flushing;}catch{}
    await ctx.flush();return{unsavedProjects:0};
  },
  openBackupCenter(){
    if(stateTransactionBusy(ctx)||ctx.ui.fullBackupBusy||ctx.ui.fullRestoring)return false;
    return requestLibraryNavigation(ctx,()=>openFullBackupCenter(ctx));
  },
  setFullBackupBusy(value){ctx.ui.fullBackupBusy=Boolean(value);ctx.setFullRestoreBusy(ctx.ui.fullRestoring);},
  offerLibrarySaveAi(packet) { return offerLibrarySaveAi(ctx,packet); },
  persistWizardDraft() { return saveWizardDraft(ctx); },
  openAiSettings(options) { return enterAiSettings(ctx, options); },
  returnFromAiSettings() { return returnFromAiSettings(ctx).catch(error => ctx.notify(error.message, true)); },
  async resumeWizard() {
    const draft = loadWizardDraft(ctx); if (!draft) return false;
    if(stateTransactionBusy(ctx))return false;
    if (!draft.isNew && state.projects.some(project => project.id === draft.projectId) && state.activeProjectId !== draft.projectId) await runStateTransaction(ctx,'正在恢复简历选择',async()=>{await ctx.flush();ctx.merge(await api.setActiveProject(draft.projectId));});
    return restoreWizardDraft(ctx);
  },
  openLibraryAi(action){return openLibraryAi(ctx,action);},
  openProjectAi(options){return openProjectAi(ctx,options);},
  openWizardAi(action){return openWizardAi(ctx,action);},
  setLibraryRestoreBusy(value) {
    ctx.ui.libraryRestoreBusy=Boolean(value);
    const busy=Boolean(stateTransactionBusy(ctx)||value||ctx.ui.fullRestoring||ctx.ui.softwareUpdating||ctx.ui.fullBackupBusy);
    for(const element of document.querySelectorAll('.rail,.workspace')){element.inert=busy;element.setAttribute('aria-busy',String(busy));}
  },
  forgetProject(id) { drafts.delete(id); undos.delete(id); redos.delete(id); ctx.ui.selectedBlockId=null; },
  setFullRestoreBusy(value) {
    ctx.ui.fullRestoring=Boolean(value); for(const element of document.querySelectorAll(".rail,.workspace")) {element.inert=Boolean(stateTransactionBusy(ctx)||value||ctx.ui.libraryRestoreBusy||ctx.ui.softwareUpdating||ctx.ui.fullBackupBusy);element.setAttribute("aria-busy",String(element.inert));}
  },
  setSoftwareUpdateBusy(value) {
    ctx.ui.softwareUpdating=Boolean(value);for(const element of document.querySelectorAll('.rail,.workspace')){element.inert=stateTransactionBusy(ctx)||Boolean(value)||Boolean(ctx.ui.fullRestoring)||Boolean(ctx.ui.libraryRestoreBusy)||Boolean(ctx.ui.fullBackupBusy);element.setAttribute('aria-busy',String(stateTransactionBusy(ctx)||Boolean(value)||Boolean(ctx.ui.fullRestoring)||Boolean(ctx.ui.libraryRestoreBusy)||Boolean(ctx.ui.fullBackupBusy)));}
  },
  async afterFullRestore(next) {
    clearTimeout(timer); drafts.clear(); undos.clear(); redos.clear(); state=next;
    try { for (const key of Object.keys(localStorage)) if (key === 'its-me:wizard-draft:v1:'+ctx.draftScope || key === 'its-me:library-drafts:v1:'+ctx.draftScope || key === 'its-me:resume-import-draft:v1:'+ctx.draftScope || key.startsWith('its-me:completion-draft:v1:'+ctx.draftScope+':') || key.startsWith('its-me:ai-review-draft:v1:'+ctx.draftScope+':')) localStorage.removeItem(key); } catch {}
    location.reload();
  },
  openHelpCenter(topic='start') { if(stateTransactionBusy(ctx))return false;return openHelpCenter(ctx,{topic}); },
  version: '',
  ui: { screen: 'library', librarySelection: 'person', libraryLanguage: 'zh', selectedBlockId: null, editorTab: 'content', zoom: .75, zoomMode: 'fit', snap: true, dirtyLibrary: false, wizard: null },
  get project() { return state?.projects.find(project => project.id === state.activeProjectId); },
  refreshSaveStatus({ clearError = false } = {}) {
    const status = $('#save-status'), rulesDirty = ctx.ui.screen === 'settings' && ctx.ui.dirtyAiRules, dirty = ctx.ui.dirtyLibrary || rulesDirty;
    $('#save-library-action').hidden = !(rulesDirty || (dirty && ctx.ui.screen === 'library'));
    $('#save-library-action').textContent = rulesDirty ? '保存规则' : '保存资料';
    status.classList.toggle('save-dirty', dirty);
    if (clearError) status.classList.remove('save-error');
    if (!status.classList.contains('save-error')) status.textContent = rulesDirty ? 'AI 规则尚未保存' : dirty ? '资料库尚未保存' : drafts.size ? '正在保存…' : '已保存到本机';
  },
  notify(message, error = false) {
    clearTimeout(toastTimer);
    const toast = $('#toast'); toast.textContent = userMessage(message); toast.classList.toggle('error', error); toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 6500 : 3200);
  },
  modal(title, description, html, setup) {
    clearHelpCenter($('#modal'));
    $('#modal-title').textContent = title; $('#modal-description').textContent = description; $('#modal-content').innerHTML = html;
    $('#modal').showModal(); setup?.($('#modal-content'));
  },
  closeModal() { if(stateTransactionBusy(ctx)||ctx.ui.libraryRestoreBusy||ctx.ui.fullRestoring||ctx.ui.fullBackupBusy||(ctx.ui.projectManagementBusy||ctx.ui.projectCommitBusy))return; $('#modal').close(); },
  merge(next) {
    state = next;
    for (const [id, project] of drafts) {
      const index = state.projects.findIndex(item => item.id === id);
      if (index < 0) state.projects.push(clone(project)); else state.projects[index] = clone(project);
    }
  },
  async flush() {
    clearTimeout(timer);
    if (flushing) { await flushing; if (drafts.size) return ctx.flush(); return; }
    flushing = (async () => {
      while (drafts.size) {
        const [id, project] = drafts.entries().next().value;
        const snapshot = clone(project), next = await api.saveProject(snapshot);
        if (JSON.stringify(drafts.get(id)) === JSON.stringify(snapshot)) drafts.delete(id);
        ctx.merge(next);
      }
      ctx.refreshSaveStatus({ clearError: true });
      refreshProjectSyncNotice(ctx);
    })();
    try { await flushing; }
    catch (error) { $('#save-status').textContent = '保存失败，点击重试'; $('#save-status').classList.add('save-error'); ctx.notify(`本地保存失败：${error.message}`, true); throw error; }
    finally { flushing = null; }
  },
  // AI adoption is published only after its durable write succeeds. Normal
  // canvas edits keep their existing debounced draft/undo behavior.
  async commitProject(mutator, { history = true, trackBilingual = true, assertCurrent } = {}) {
    if (stateTransactionBusy(ctx)||ctx.ui.projectCommitBusy) throw Error('正在保存本次修改，请稍候。');
    const id = ctx.project?.id;
    if (!id) throw Error('当前简历已变化，请重新选择。');
    const requireCurrent = () => {
      if (ctx.project?.id !== id) throw Error('当前简历已变化，请重新选择。');
      assertCurrent?.();
    };
    ctx.ui.projectCommitBusy = true;
    try {
      await ctx.flush();
      requireCurrent();
      const previous = clone(ctx.project), project = clone(previous);
      mutator(project);
      pruneCanvasGroups(project); pruneReadingOrder(project);
      const validIds = new Set(project.blocks.map(block => block.id));
      for (const layouts of [project.layoutByLanguage, project.freeLayoutByLanguage]) for (const layout of Object.values(layouts || {})) for (const id of Object.keys(layout.positions)) if (!validIds.has(id)) delete layout.positions[id];
      if (JSON.stringify(previous) === JSON.stringify(project)) return false;
      project.updatedAt = new Date().toISOString();
      let next;
      try { next = await api.saveProject(clone(project)); }
      catch (error) { throw Error('本地保存失败，候选稿仍保留，请重试：' + userMessage(error)); }
      requireCurrent();
      if (history) { const stack = undos.get(id) || []; stack.push(previous); if (stack.length > 60) stack.shift(); undos.set(id, stack); redos.set(id, []); }
      ctx.merge(next);
      if (trackBilingual) captureProjectSyncChanges(ctx, previous, ctx.project);
      ctx.refreshSaveStatus({ clearError: true }); ctx.render();
      return true;
    } finally { ctx.ui.projectCommitBusy = false; }
  },
  updateProject(mutator, { render = true, history = true, trackBilingual = true } = {}) {
    if (stateTransactionBusy(ctx)||ctx.ui.projectCommitBusy) return false;
    if (!ctx.project) return;
    const previous = clone(ctx.project), project = clone(previous);
    mutator(project);
    pruneCanvasGroups(project);
    pruneReadingOrder(project);
    const validIds = new Set(project.blocks.map(block => block.id));
    for (const layouts of [project.layoutByLanguage, project.freeLayoutByLanguage]) for (const layout of Object.values(layouts || {})) for (const id of Object.keys(layout.positions)) if (!validIds.has(id)) delete layout.positions[id];
    if (JSON.stringify(previous) === JSON.stringify(project)) return;
    if (history) { const stack = undos.get(project.id) || []; stack.push(previous); if (stack.length > 60) stack.shift(); undos.set(project.id, stack); redos.set(project.id, []); }
    project.updatedAt = new Date().toISOString();
    state.projects[state.projects.findIndex(item => item.id === project.id)] = project;
    // The sync notice reads ctx.project, so publish the new draft before
    // collecting its text changes; otherwise it can erase its own pending delta.
    if(trackBilingual)captureProjectSyncChanges(ctx,previous,project);
    drafts.set(project.id, clone(project)); ctx.refreshSaveStatus({ clearError: true });
    clearTimeout(timer); timer = setTimeout(() => ctx.flush().catch(() => {}), 450);
    if (render) ctx.render(); else ctx.refreshUndoActions();
  },
  async addProject(project) {
    await runStateTransaction(ctx,'正在建立简历',async()=>{await ctx.flush();ctx.merge(await api.saveProject(project));
    if(state.activeProjectId!==project.id)ctx.merge(await api.setActiveProject(project.id));});
    ctx.ui.selectedBlockId = null;
    if (ctx.ui.screen === 'editor') ctx.render();
    else await ctx.navigate('editor');
  },
  async saveLibrary(library) {
    const detail=$('#library-detail'),wasInert=Boolean(detail?.inert),wasSaving=ctx.ui.librarySaving;
    if(detail)detail.inert=true;ctx.ui.librarySaving=true;
    try {
      await runStateTransaction(ctx,'正在保存资料',async()=>{await ctx.flush();ctx.merge(await api.saveLibrary(library));ctx.ui.dirtyLibrary=false;
      ctx.refreshSaveStatus({clearError:true});ctx.notify('资料库已保存');ctx.render();},{allowSoftwareUpdate:true});
    } finally {if(detail)detail.inert=wasInert;ctx.ui.librarySaving=wasSaving;}
  },
  async useSample() {
    return requestLibraryNavigation(ctx, async () => {
      if (state.library.entries.length || state.library.person.zh.name || state.library.person.en.name) return ctx.notify('已有资料，示例不会覆盖你的资料库。');
      const sample = sampleLibrary(); sample.attachments = clone(state.library.attachments || []);
      if (state.library.person.photo) sample.person.photo = clone(state.library.person.photo);
      await ctx.saveLibrary(sample); ctx.ui.librarySelection = 'person'; await ctx.navigate('library');
      ctx.notify('示例资料已就绪，可以点击“建立简历”开始');
    });
  },
  async importAttachments() {
    return requestLibraryNavigation(ctx, async () => {
      try { await runStateTransaction(ctx,'正在添加补充文件',async()=>{await ctx.flush();const result=await api.importAttachments();if(!result.cancelled){ctx.merge(result.state);ctx.render();ctx.notify('补充文件已保存到资料库');}}); }
      catch (error) { ctx.notify(`文件未能添加：${error.message}`, true); }
    });
  },
  async removeAttachment(id) {
    try { await runStateTransaction(ctx,'正在移除补充文件',async()=>{await ctx.flush();ctx.merge(await api.removeAttachment(id));ctx.render();ctx.notify('已从资料库移除，已有简历的附件仍保留');}); }
    catch (error) { ctx.notify(error.message, true); }
  },
  async openAttachment(id) { try { await api.openAttachment(id); } catch (error) { ctx.notify(error.message, true); } },
  async switchProject(id) {
    if (stateTransactionBusy(ctx)||ctx.ui.projectCommitBusy) return false;
    return requestLibraryNavigation(ctx, async () => {
      await runStateTransaction(ctx,'正在打开简历',async()=>{await ctx.flush();ctx.merge(await api.setActiveProject(id));ctx.ui.selectedBlockId=null;ctx.ui.screen='editor';ctx.render();});
    });
  },
  async exportPDF() {
    if (!ctx.project||stateTransactionBusy(ctx)) return;
    try { return await runStateTransaction(ctx,'正在导出简历',async()=>{
    document.activeElement?.blur();
    const primary = $('#primary-action'); primary.disabled = true; primary.textContent = '正在生成 PDF…';
    try {
      await ctx.flush(); const result = await api.exportPDF(clone(ctx.project));
      if (!result.cancelled) { ctx.merge(result.state); ctx.notify(result.attachmentDirectory ? 'PDF 和所选补充文件已导出' : 'PDF 已导出，并保存到导出历史'); }
    } catch (error) { ctx.notify(`导出未完成：${error.message}`, true); }
    finally { primary.disabled = false; ctx.render(); }
    }); }catch(error){ctx.notify(error.message,true);}
  },
  undo(direction = 'undo') {
    if (stateTransactionBusy(ctx)||ctx.ui.projectCommitBusy) return;
    const project = ctx.project; if (!project) return;
    const source = direction === 'undo' ? undos : redos, target = direction === 'undo' ? redos : undos;
    const stack = source.get(project.id) || []; if (!stack.length) return;
    const next = stack.pop(), reverse = target.get(project.id) || []; reverse.push(clone(project)); target.set(project.id, reverse);
    ctx.updateProject(project => { Object.keys(project).forEach(key => delete project[key]); Object.assign(project, next); }, { history: false });
    ctx.refreshUndoActions();
  },
  canUndo(direction) { return Boolean((direction === 'redo' ? redos : undos).get(ctx.project?.id)?.length); },
  refreshUndoActions() {
    for (const direction of ['undo', 'redo']) {
      const control = $('#' + direction);
      if (control) control.disabled = !ctx.canUndo(direction);
    }
  },
  startWizard(options) {
    if(stateTransactionBusy(ctx)||(ctx.ui.projectManagementBusy||ctx.ui.projectCommitBusy)||ctx.ui.libraryRestoreBusy)return Promise.resolve(false);
    return requestLibraryNavigation(ctx, () => { document.activeElement?.blur(); startWizard(ctx, options); }).catch(error => ctx.notify(error.message, true));
  },
  showJobDialog(options) { ctx.startWizard(options); },
  showBackups() { if(stateTransactionBusy(ctx))return false;return showBackups(ctx); },
  navigate(screen) {
    if(stateTransactionBusy(ctx)||(ctx.ui.projectManagementBusy||ctx.ui.projectCommitBusy)||ctx.ui.libraryRestoreBusy)return Promise.resolve(false);
    if (screen === ctx.ui.screen) return Promise.resolve(true);
    if (ctx.ui.screen === 'wizard' && ctx.ui.wizard) saveWizardDraft(ctx);
    return requestLibraryNavigation(ctx, () => { ctx.ui.screen = screen; ctx.render(); }).catch(error => ctx.notify(error.message, true));
  },
  render() {
    ctx.workspacePanelsDispose?.(); ctx.workspacePanelsDispose = null; ctx.canvasResizeObserver?.disconnect();
    const oldScroll = $('.canvas-scroll')?.scrollTop || 0;
    $('#screen-title').textContent = ctx.ui.screen === 'editor' ? '预览制作' : ctx.ui.screen === 'wizard' ? '建立简历' : titles[ctx.ui.screen];
    const navScreen = ['editor','wizard'].includes(ctx.ui.screen) ? 'projects' : ctx.ui.screen;
    $('#navigation').innerHTML = Object.entries(titles).map(([key,label]) => `<button class="nav-item ${navScreen === key ? 'active' : ''}" data-screen="${key}">${icon(key === 'projects' ? 'file' : key,19)}<span>${label}</span>${key === 'projects' && state.projects.length ? `<small>${state.projects.length}</small>` : ''}</button>`).join('');
    $$('.nav-item').forEach(button => button.onclick = () => ctx.navigate(button.dataset.screen));
    const primary = $('#primary-action'), editor = ctx.ui.screen === 'editor' && ctx.project;
    const selecting = ctx.ui.screen === 'wizard' && ctx.ui.wizard?.step === 2;
    primary.hidden = !editor && !selecting && !['library','projects'].includes(ctx.ui.screen);
    primary.innerHTML = editor ? `${icon('download',17)}导出 PDF` : selecting ? `进入预览 ${icon('arrow',15)}` : `${icon('plus',17)}建立简历`;
    primary.onclick = editor ? () => ctx.exportPDF() : selecting ? () => $('#wizard-selection-form')?.requestSubmit() : () => ctx.startWizard({isNew:true});
    if (ctx.ui.screen === 'library') {renderLibrary(ctx);const importButton=document.createElement('button');importButton.type='button';importButton.className='button secondary';importButton.dataset.action='import-resume';importButton.textContent=hasResumeImportDraft(ctx)?'继续导入草稿':'导入已有简历';importButton.onclick=()=>openResumeImport(ctx,{onImportAi:async(_ctx,{entryIds,language})=>{ctx.ui.librarySelection=entryIds[0]||'person';ctx.ui.libraryLanguage=language;ctx.render();return ctx.openLibraryAi('review');}});document.querySelector('.page-heading .button-group')?.prepend(importButton);}
    if (ctx.ui.screen === 'projects') renderProjects(ctx);
    if (ctx.ui.screen === 'wizard') renderWizard(ctx);
    if (ctx.ui.screen === 'editor') {renderEditor(ctx);const syncHost=document.createElement('div');syncHost.dataset.projectSyncHost='';document.querySelector('.editor-workspace')?.insertBefore(syncHost,document.querySelector('.editor-columns'));mountProjectSyncNotice(ctx,syncHost);}
    if (ctx.ui.screen === 'history') renderHistory(ctx);
    if (ctx.ui.screen === 'settings') {
      renderSettings(ctx);
      if (ctx.ui.aiReturn) { const row=document.createElement('div'); row.className='wizard-recommendation'; const label=document.createElement('span'); label.textContent='配置完成后返回原任务，再主动点击生成。'; const back=document.createElement('button'); back.type='button'; back.className='button secondary'; back.dataset.returnAi=''; back.textContent=ctx.ui.aiReturn.label; back.onclick=()=>ctx.returnFromAiSettings(); row.append(label,back); $('#screen').prepend(row); }
    }
    if ($('.canvas-scroll')) $('.canvas-scroll').scrollTop = oldScroll;
    ctx.refreshSaveStatus();
  },
};

$('#help-action').onclick = () => ctx.openHelpCenter();
$('#close-modal').onclick = () => ctx.closeModal();
$('#modal').addEventListener('click',event => { if (event.target === $('#modal')) ctx.closeModal(); });
const saveCurrentChanges = async () => {
  if(stateTransactionBusy(ctx))return false;
  if (ctx.ui.screen === 'settings') return saveGlobalAiRules(ctx);
  const form = $('#library-form');
  if (ctx.ui.screen === 'library' && form && ctx.ui.dirtyLibrary) return saveLibraryForm(ctx, { form });
  try { await ctx.flush(); return true; } catch { return false; }
};
$('#save-status').onclick = saveCurrentChanges;
$('#save-library-action').onclick = saveCurrentChanges;
document.addEventListener('keydown',event => {
  if(stateTransactionBusy(ctx)||ctx.ui.fullRestoring||ctx.ui.libraryRestoreBusy||ctx.ui.fullBackupBusy||(ctx.ui.projectManagementBusy||ctx.ui.projectCommitBusy)){event.preventDefault();return;}
  if(ctx.ui.softwareUpdating){if(!document.querySelector('dialog[open]')||event.ctrlKey||event.metaKey)event.preventDefault();return;}
  if(event.key==='F1'){event.preventDefault();ctx.openHelpCenter();return;}
  const editing = event.target.matches('input,textarea,[contenteditable="true"],[contenteditable="plaintext-only"]');
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if(ctx.ui.librarySaveReviewPending){ctx.notify('请在对比窗口选择要保存的版本。');return;}
    document.activeElement?.blur();
    const libraryForm = $('#library-form');
    if (ctx.ui.screen === 'settings') saveGlobalAiRules(ctx);
    else if (ctx.ui.screen === 'library' && libraryForm) saveLibraryForm(ctx, { form: libraryForm });
    else ctx.flush().then(()=>ctx.notify('已保存到本机')).catch(()=>{});
  }
  if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (ctx.ui.screen === 'editor' && !document.querySelector('dialog[open]')) ctx.undo(event.shiftKey ? 'redo' : 'undo');
  }
});
window.setResumeUpdateBusy=value=>ctx.setSoftwareUpdateBusy(value);
window.flushResumeChanges = async () => {
  if(stateTransactionBusy(ctx)||ctx.ui.fullRestoring||ctx.ui.libraryRestoreBusy||ctx.ui.fullBackupBusy||(ctx.ui.projectManagementBusy||ctx.ui.projectCommitBusy))return false;
  const aiDraftSession=ctx.ui.aiDraftSession;
  if(aiDraftSession){
    if(aiDraftSession.busy||aiDraftSession.isSaving){ctx.notify('正在处理 AI 草稿，请稍候再退出或更新。');return false;}
    if(await aiDraftSession.persist?.()===false)return false;
  }if(ctx.ui.bilingualSyncOpen||ctx.ui.bilingualSyncOpening){ctx.notify('请先保存或关闭双语对照，再退出或更新。');return false;}if(ctx.ui.resumeImportSession?.persist&&!ctx.ui.resumeImportSession.saving&&!ctx.ui.resumeImportSession.persist())return false;if(ctx.ui.bilingualSyncSaving||ctx.ui.resumeImportSession?.saving){ctx.notify('正在保存修改，请稍候再退出或更新。');return false;} document.activeElement?.blur(); if(ctx.ui.wizard)saveWizardDraft(ctx);const adding=$('#add-entry-form');if(adding?.closest('dialog')?.open&&adding.elements.title.value.trim()){ctx.notify('请先添加这段经历，或关闭添加窗口后再退出。');return false;} return requestLibraryNavigation(ctx, async () => { await ctx.flush(); }); };
try {
  if (!api) throw new Error('请使用桌面启动程序打开软件。');
  const info = await api.appInfo(); ctx.version = info.version; ctx.draftScope = info.draftScope || 'default'; $('#app-version').textContent = 'ITS ME ' + ctx.version;
  state = await api.load(); ctx.ui.screen = 'library'; $('#save-status').textContent = '已保存到本机'; const recovered=restoreWizardDraft(ctx,{render:false}); ctx.render(); if(recovered)ctx.notify('已恢复未完成的向导草稿；AI 任务需要主动生成。');else showLibraryDraftRecovery(ctx);
} catch (error) {
  $('#save-status').textContent = '无法读取本地资料';
  $('#screen').innerHTML = `<div class="fatal"><h1>资料未能打开</h1><p>${escape(userMessage(error))}</p><p>已有资料文件已保留，请保留数据目录并反馈错误。</p></div>`;
}
