import {reviewAiJobResult} from '../core/ai-job-review.mjs';
import {prepareAiReviewSelection} from './ai-review-apply.mjs';
import {loadAiReviewDraft,saveAiReviewDraft,clearAiReviewDraft,aiReviewIdentity,aiReviewOriginMatches,findAiReviewDraft} from './ai-review-drafts.mjs';
import {installAiDraftDialog,prepareAiDraftDialog} from './ai-draft-dialog.mjs';
import { aiFieldLabels, renderTranslationFields } from './ai-translation-fields.mjs';
import {loadAiRulePreferences,renderGlobalAiRules,readGlobalAiRuleDraft,createAiRuleEditor} from './ai-rule-controls.mjs';
import { createAiTask, buildAiMessages, assessAiCandidate, getAiRules, getAiErrorMessage } from '../core/ai-tasks.mjs';

const ACTIONS = {
  polish: '优化表达', shorten: '精简文字', proofread: '检查用词与错别字', expand: '补充资料',
  translate: '翻译另一语言', review: '检查简历内容', role: '分析岗位要求', select: '推荐相关经历',
  layout: '提供版式建议', tags: '整理技能与标签', organize: '梳理经历内容', questions: '建议补充的问题',
};
const READONLY = new Set(['expand', 'review', 'role', 'select', 'layout', 'questions']);
const FIELD_NAMES = aiFieldLabels;
const SESSIONS = new WeakMap();
const defaults = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', keyPresent: false, rememberKey: false, canPersist: false };
const languageName = language => language === 'en' ? 'English' : '中文';
const errorText = (error, secret = '') => {
  let message = typeof error?.message === 'string' ? error.message : '操作未完成，请重试。';
  const code = error?.code || message.match(/\bAI_[A-Z_]+\b/u)?.[0];
  if (code) message = getAiErrorMessage(code);
  else if (/Error invoking remote method|remote method|IPC|service response/iu.test(message)) message = 'AI 服务未能完成本次任务。请检查设置或稍后手动重试；输入已保留。';
  else message = message.replace(/^(?:Error:\s*)+/u, '');
  if (secret) message = message.split(secret).join('[已隐藏]');
  return message.slice(0, 1600);
};
function node(tag, text, className) {
  const value = document.createElement(tag); if (text !== undefined) value.textContent = String(text); if (className) value.className = className; return value;
}
function updateStatus(ctx, value) { const status = { ...defaults, ...value }; ctx.aiStatus = status; return status; }
function messageAt(host, message, error = false) {
  let value = host.querySelector('[data-ai-error]');
  if (!value) { value = node('p', '', 'ai-feedback'); value.dataset.aiError = ''; value.setAttribute('role', 'status'); host.append(value); }
  value.textContent = message; value.classList.toggle('error', error); value.hidden = !message;
}
function displayList(host, label, values) {
  if (!Array.isArray(values) || !values.length) return;
  const section = node('section', undefined, 'ai-result-section'); section.append(node('h3', label));
  const list = node('ul'); for (const value of values) list.append(node('li', value)); section.append(list); host.append(section);
}

/** Local settings only: saving a provider/key never sends an AI request. */
export async function renderAiSettings(ctx, host, {ruleDraft} = {}) {
  if (!host) return null;
  const token = Symbol('ai-settings'); host.aiSettingsToken = token; host.classList.add('ai-settings');
  host.replaceChildren(node('p', '正在读取本机 AI 设置…', 'ai-muted'));
  let status;
  try { status = updateStatus(ctx, await window.resume.aiStatus()); }
  catch (error) { if (host.aiSettingsToken === token && host.isConnected) messageAt(host, errorText(error), true); return null; }
  if (host.aiSettingsToken !== token || !host.isConnected) return status;
  host.innerHTML = '<div class="ai-settings-heading"><h3>自带 API Key</h3><span class="tag neutral" data-ai-key-status></span></div><p class="ai-muted">AI 是可选功能。未配置时，资料管理、排版与 PDF 导出仍可离线使用。只有主动发送任务时才联网，API 费用由你的服务账号承担。</p><form class="ai-settings-form"><label class="field"><span>服务</span><select name="aiProvider"><option value="deepseek">DeepSeek</option><option value="custom">自定义 OpenAI 兼容服务</option></select></label><label class="field"><span>服务地址</span><input name="aiBaseUrl" type="url" maxlength="1000" required spellcheck="false" autocomplete="off"></label><label class="field"><span>模型名称</span><input name="aiModel" maxlength="180" required autocomplete="off" spellcheck="false"></label><label class="field"><span>API Key</span><input name="aiKey" type="password" maxlength="4096" autocomplete="new-password" spellcheck="false" placeholder="留空保留已配置的 Key"></label><label class="ai-checkbox"><input name="aiRememberKey" type="checkbox"><span>在本机加密保存 Key</span></label><p class="ai-muted" data-ai-key-storage></p><p class="ai-muted">Key 不会显示或加入资料库、简历与备份。自定义服务会收到你主动发送的内容，请确认服务地址。</p><div class="ai-settings-actions"><button class="button primary" type="submit" data-ai-save-settings>保存 AI 设置</button><button class="button quiet danger" type="button" data-ai-clear-key>删除已配置 Key</button></div></form>';
  const form = host.querySelector('form'), controls = form.elements;
  const provider = controls.aiProvider, baseUrl = controls.aiBaseUrl, model = controls.aiModel, key = controls.aiKey, remember = controls.aiRememberKey;
  provider.value = status.provider; baseUrl.value = status.baseUrl; model.value = status.model;
  remember.checked = Boolean(status.canPersist && (status.rememberKey || !status.keyPresent)); remember.disabled = !status.canPersist;
  const keyStatus = host.querySelector('[data-ai-key-status]'); keyStatus.textContent = status.keyPresent ? '已配置 Key' : '尚未配置';
  host.querySelector('[data-ai-key-storage]').textContent = !status.canPersist ? '本机加密不可用，Key 仅在此次会话中使用；退出软件后需重新填写。' : status.rememberKey && status.keyPresent ? 'Key 由系统在本机加密保存。取消勾选后保存，可改为仅此次会话使用。' : '未勾选时，Key 仅在此次会话中使用；退出软件后不会保留。';
  const clear = host.querySelector('[data-ai-clear-key]'); clear.disabled = !status.keyPresent;
  const syncProvider = (reset = false) => {
    const deepseek = provider.value === 'deepseek'; baseUrl.readOnly = deepseek;
    if (deepseek && reset) { baseUrl.value = defaults.baseUrl; model.value = defaults.model; }
  };
  syncProvider(); provider.onchange = () => syncProvider(true);
  let busy = false;
  const save = async clearKey => {
    if (busy || host.aiSettingsBusy || (!clearKey && !form.reportValidity())) return;
    busy = true;host.aiSettingsBusy=true; const previousDisabled = Array.from(host.querySelectorAll('form input,form textarea,form select,form button'), control => [control, control.disabled]);
    for (const [control] of previousDisabled) control.disabled = true;
    const pendingRuleDraft=readGlobalAiRuleDraft(host);
    const secret = clearKey ? '' : key.value.trim();
    const config = clearKey ? { provider: status.provider, baseUrl: status.baseUrl, model: status.model, rememberKey: status.rememberKey, clearKey: true }
      : { provider: provider.value, baseUrl: baseUrl.value.trim(), model: model.value.trim(), rememberKey: Boolean(status.canPersist && remember.checked), ...(secret ? { key: secret } : {}) };
    key.value = '';
    try {
      status = updateStatus(ctx, await window.resume.aiConfigure(config));
      if (host.aiSettingsToken === token && host.isConnected) { await renderAiSettings(ctx, host, {ruleDraft:pendingRuleDraft}); messageAt(host, clearKey ? 'Key 已删除。离线功能可继续使用。' : 'AI 设置已保存在本机。尚未发送任何 AI 请求。'); }
    } catch (error) { if (host.aiSettingsToken === token && host.isConnected) messageAt(host, errorText(error, secret), true); }
    finally { busy = false;host.aiSettingsBusy=false; for (const [control, disabled] of previousDisabled) if (control.isConnected) control.disabled = disabled; }
  };
  form.onsubmit = event => { event.preventDefault(); save(false); }; clear.onclick = () => save(true);
  await renderGlobalAiRules(host,{draft:ruleDraft,ctx});
  return status;
}

function taskFor(options, action, instruction, taskOptions = {}) {
  const { constraints = {}, translationMode = 'fill-empty', translationDirection = 'auto' } = taskOptions;
  let raw;
  if (typeof options.createTask === 'function') raw = options.createTask(action, instruction, taskOptions);
  else {
    let sourceLanguage = options.sourceLanguage || 'zh';
    if (action === 'translate' && translationDirection !== 'auto') sourceLanguage = translationDirection === 'en-zh' ? 'en' : 'zh';
    const targetLanguage = action === 'translate' ? (sourceLanguage === 'zh' ? 'en' : 'zh') : sourceLanguage;
    let targets = (options.targets || []).map(target => ({ id: target.id, fields: { ...target.fields }, before: { ...(targetLanguage === sourceLanguage ? target.fields : target.before) } }));
    if (action === 'translate' && translationMode === 'fill-empty') targets = targets.map(target => {
      const fields = Object.fromEntries(Object.entries(target.fields).filter(([field]) => !String(target.before[field] ?? '').trim()));
      return { ...target, fields, before: Object.fromEntries(Object.keys(fields).map(field => [field, target.before[field] ?? ''])) };
    }).filter(target => Object.keys(target.fields).length);
    raw = { action, sourceLanguage, targetLanguage, targets, entries: options.entries || [], jobTitle: options.jobTitle || '', jobDescription: options.jobDescription || '', instruction,
      references: options.references || [], ...(options.layoutContext ? { layoutContext: options.layoutContext } : {}) };
  }
  if (action === 'translate' && Array.isArray(taskOptions.translationFields)) {
    const selected = new Set(taskOptions.translationFields);
    raw = { ...raw, targets: raw.targets.map(target => { const fields = Object.fromEntries(Object.entries(target.fields).filter(([field]) => selected.has(field))); return { ...target, fields, before: Object.fromEntries(Object.keys(fields).map(field => [field, target.before?.[field] ?? ''])) }; }).filter(target => Object.keys(target.fields).length) };
  }
  return createAiTask({ ...raw, protocolVersion: 2, constraints: { ...raw.constraints, ...constraints }, ruleOverrides:taskOptions.ruleOverrides, translationMode: translationMode === 'update' ? 'update-existing' : translationMode });
}
function allowedActions(options) {
  const requested = Array.isArray(options.actions) ? options.actions.filter(action => Object.hasOwn(ACTIONS, action)) : Object.keys(ACTIONS);
  if (options.createTask) return requested;
  const source = options.sourceLanguage || 'zh';
  const target = options.targetLanguage || (options.action === 'translate' ? (source === 'zh' ? 'en' : 'zh') : source);
  return requested.filter(action => READONLY.has(action) || (action === 'translate' ? target !== source : target === source));
}
function targetHeading(task, target, field, labels = {}) {
  const title = [typeof labels?.[target?.id] === 'string' ? labels[target.id] : '', target?.fields?.title, target?.fields?.name, target?.before?.title, target?.before?.name].find(value => typeof value === 'string' && value.trim());
  return (title?.trim() || '文字模块 ' + (task.targets.indexOf(target) + 1)) + ' · ' + (FIELD_NAMES[field] || field);
}
function sendPreview(host, task, status, translationScopeNote = '', rulePreferences) {
  const address = host.querySelector('[data-ai-address]'); address.textContent = status.baseUrl + ' · ' + status.model;
  const preview = host.querySelector('[data-ai-payload-text]');
  const messages=buildAiMessages(task,{rulePreferences});
  const payload = JSON.parse(messages.find(message => message.role === 'user').content);
  preview.textContent = JSON.stringify(payload, null, 2);
  const policy=host.querySelector('[data-ai-effective-rules]');if(policy){let rulePreview=host.querySelector('[data-ai-rule-send-preview]');if(!rulePreview){rulePreview=node('pre');rulePreview.dataset.aiRuleSendPreview='';preview.after(rulePreview);}rulePreview.textContent='本次生效的表达规则：\n'+policy.textContent;}
  const extras = [payload.jobTitle?.trim() || payload.jobDescription?.trim() ? '岗位方向与要求' : '', payload.instruction?.trim() ? '额外要求' : ''].filter(Boolean);
  const scope = host.querySelector('[data-ai-send-scope]');
  if (task.action === 'layout' && payload.layoutContext) {
    const count = (payload.targets || []).length;
    scope.textContent = '本次发送本机版面测量摘要（纸张、模块尺寸、字体和检测结果）' + (count ? '及本次选择的 ' + count + ' 个模块编号' : '') + (extras.length ? '，以及' + extras.join('、') : '') + '。不发送照片或附件；具体文字以发送预览为准。';
  } else if (['role', 'select'].includes(task.action)) {
    scope.textContent = payload.entries.length
      ? '本次将发送当前语言（' + languageName(task.sourceLanguage) + '）的 ' + payload.entries.length + ' 条经历用于比较' + (extras.length ? '，以及' + extras.join('、') : '') + '。不发送联系方式、照片或附件。'
      : '本次仅发送' + (extras.join('、') || '本次填写的岗位文字') + '，不发送经历、联系方式、照片或附件。';
  } else {
    const fields = (payload.targets || []).reduce((total, target) => total + Object.keys(target.fields).length, 0);
    scope.textContent = '本次仅发送当前选择的 ' + (payload.targets || []).length + ' 个文字模块、' + fields + ' 个字段（' + languageName(task.sourceLanguage) + '）' + (extras.length ? '，以及' + extras.join('、') : '') + '。不发送照片或附件。';
  }
  const contextFields = [...(payload.targets || []), ...(payload.entries || [])].flatMap(item => Object.keys(item.context?.experience || {}));
  if (contextFields.length) scope.textContent += ' 另含 ' + contextFields.length + ' 项职业补充资料（' + [...new Set(contextFields)].slice(0, 4).map(field => FIELD_NAMES[field] || field).join('、') + '）作为只读判断依据，不会直接改写。';
  if (task.action === 'translate' && translationScopeNote) scope.textContent += ' ' + translationScopeNote;
  host.querySelector('[data-ai-language]').textContent = task.action === 'translate' ? languageName(task.sourceLanguage) + ' → ' + languageName(task.targetLanguage) : languageName(task.sourceLanguage);
}

function appendSources(host, sources, task, {title = '查看原文依据', note = '引用存在不等于事实已核实'} = {}) {
  const section = node('details', undefined, 'ai-source-evidence'); section.dataset.aiSources = '';
  section.append(node('summary', title), node('small', note));
  if (!sources?.length) section.append(node('p', '未提供原文依据。'));
  for (const source of sources || []) {
    const original = task.sources?.find(item => item.sourceId === source.sourceId);
    const label = original?.kind === 'job' ? '岗位原句' : original?.entryId ? '经历原句' : '原文';
    section.append(node('p', label + '：“' + (source.quote || '') + '”'));
  }
  host.append(section);
}
function scopeLabels(task, ids, labels = {}) {
  return (ids || []).map(id => {
    const target = task.targets.find(item => item.id === id);
    if (target) return targetHeading(task, target, Object.keys(target.fields)[0], labels);
    const block = task.layoutContext?.blocks?.find(item => item.id === id);
    return (typeof labels?.[id] === 'string' && labels[id].trim()) || block?.title || block?.label || id;
  }).join('、') || '本次选择的范围';
}

/** No request is sent until the user explicitly presses “发送并生成”. */
export async function openAiAssistant(ctx, options = {}) {
  if(!prepareAiDraftDialog(ctx))return false;
  SESSIONS.get(ctx)?.dispose();
  const session = { closed: false, request: null, dispose: null }; SESSIONS.set(ctx, session);
  let root, dialog, status, ruleStatus, ruleEditor, busy = false, currentTask,guard,review=null,reviewIdentity='',regenerateConfirmed=false,resultLocks=null;
  const reviewKey=change=>JSON.stringify([change.targetId,change.field]);
  const persistReview=()=>!review||saveAiReviewDraft(ctx,reviewIdentity,review);
  const live = () => !session.closed && SESSIONS.get(ctx) === session && root?.isConnected && dialog?.open;
  const cancelRequest = () => { const id = session.request; session.request = null; if (id) Promise.resolve().then(() => window.resume.aiCancel(id)).catch(() => {}); };
  const dispose = () => {
    if (session.closed) return; session.closed = true; cancelRequest();guard?.dispose();
    dialog?.removeEventListener('close', onClosed); dialog?.removeEventListener('cancel', dispose);
    if (SESSIONS.get(ctx) === session) SESSIONS.delete(ctx);
  };
  const onClosed = () => { if (!dialog?.open) {if(guard&&!guard.persist()){dialog.showModal();return;}dispose();} };
  session.dispose = dispose;
  ctx.modal('AI 辅助', '先预览发送范围，再选择是否采用建议。原有内容会保留，直到你明确接受。', '<div class="ai-assistant" data-ai-assistant><p class="ai-muted">正在读取本机 AI 设置…</p></div>', host => {
    root = host.querySelector('[data-ai-assistant]'); dialog = root.closest('dialog');
    dialog?.addEventListener('close', onClosed); dialog?.addEventListener('cancel', dispose);
  });
  try { status = updateStatus(ctx, await window.resume.aiStatus()); ruleStatus=await loadAiRulePreferences(); }
  catch (error) { if (live()) messageAt(root, errorText(error), true); return; }
  if (!live()) return;
  const available = allowedActions(options), initialState = options.initialState || {};
  const initial = available.includes(initialState.action || options.action) ? initialState.action || options.action : available[0];
  root.innerHTML = '<form class="ai-task-form"><div class="ai-task-heading"><label class="field"><span>本次任务</span><select name="aiAction"></select></label><span class="tag neutral" data-ai-language></span></div><details class="ai-rules" data-ai-rules><summary>事实与范围保护 · 始终生效</summary><div data-ai-rule-list></div><p class="ai-muted">额外要求只调整写法，不能关闭事实、来源与范围保护。</p></details><div data-ai-rule-editor-host></div><div class="ai-task-controls" data-ai-task-controls><label class="field" data-ai-constraint="maxCharacters"><span>每段最多字数 <small>按字素计数</small></span><input name="aiMaxCharacters" type="number" min="1" max="30000" placeholder="不限制"></label><label class="field" data-ai-constraint="maxBullets"><span>每段最多要点</span><input name="aiMaxBullets" type="number" min="1" max="100" placeholder="不限制"></label><label class="field" data-ai-constraint="maxTags"><span>最多标签</span><input name="aiMaxTags" type="number" min="1" max="100" value="6"></label><label class="field" data-ai-constraint="maxFindings"><span>最多检查项</span><input name="aiMaxFindings" type="number" min="1" max="50" value="4"></label><label class="field" data-ai-constraint="maxQuestions"><span>最多补充问题</span><input name="aiMaxQuestions" type="number" min="1" max="50" value="3"></label><label class="field" data-ai-translation><span>翻译方向</span><select name="aiTranslationDirection"><option value="auto">按当前内容判断</option><option value="zh-en">中文 → English</option><option value="en-zh">English → 中文</option></select></label><label class="field" data-ai-translation><span>翻译范围</span><select name="aiTranslationMode"><option value="fill-empty">仅补空白字段</option><option value="update">更新已有译文</option></select></label></div><section data-ai-translation-fields hidden></section><label class="ai-checkbox ai-details-toggle" data-ai-details-toggle><input name="aiIncludeDetails" type="checkbox"><span>同时处理标题和补充说明</span></label><label class="field"><span>额外要求 <small>可选</small></span><textarea name="aiInstruction" rows="3" maxlength="8000" placeholder="例如：简洁清楚，保留原有事实与数字。"></textarea></label><div class="ai-send-notice"><strong data-ai-address></strong><p>只有点击“发送并生成”后，才会把预览中的文字发送给此服务。联网请求按你填写的 API 账号计费。</p><p data-ai-send-scope></p></div><details class="ai-payload" data-ai-payload><summary>查看将发送的本次文字</summary><pre data-ai-payload-text></pre></details><p class="ai-muted" data-ai-no-key hidden>尚未配置 API Key，请到设置填写。任务与额外要求会保留；离线编辑与导出仍可继续。</p><div class="ai-request-actions"><button type="button" class="button quiet" data-ai-open-settings>AI 设置</button><button type="button" class="button secondary" data-ai-cancel-request hidden>取消生成</button><button type="submit" class="button primary" data-ai-send>发送并生成</button></div><p class="ai-request-state" role="status" data-ai-progress hidden>正在生成，可以取消。服务可能已开始计费。</p></form><div data-ai-result hidden></div><div class="ai-dialog-footer"><button type="button" class="button secondary" data-ai-discard>关闭，保留原内容</button></div>';
  const form = root.querySelector('form'), controls = form.elements, actionControl = controls.aiAction, instruction = controls.aiInstruction;
  for (const action of available) { const option = node('option', ACTIONS[action]); option.value = action; actionControl.append(option); }
  actionControl.value = initial || ''; instruction.value = initialState.instruction ?? options.instruction ?? '';
  ruleEditor=createAiRuleEditor(root.querySelector('[data-ai-rule-editor-host]'),{preferences:ruleStatus.preferences,action:actionControl.value,state:initialState.ruleState,onChange:()=>changed()});
  controls.aiTranslationMode.value = (initialState.translationMode || options.translationMode) === 'update-existing' ? 'update' : initialState.translationMode || options.translationMode || 'fill-empty';
  controls.aiTranslationDirection.value = initialState.translationDirection || options.translationDirection || 'auto';
  controls.aiIncludeDetails.checked = Boolean(initialState.includeDetails ?? options.includeDetails);
  const constraintControls = { maxCharacters: controls.aiMaxCharacters, maxBullets: controls.aiMaxBullets, maxTags: controls.aiMaxTags, maxFindings: controls.aiMaxFindings, maxQuestions: controls.aiMaxQuestions };
  const initialConstraints = { ...options.constraints, ...initialState.constraints };
  for (const [name, control] of Object.entries(constraintControls)) if (initialConstraints[name] !== undefined) control.value = initialConstraints[name];
  const send = root.querySelector('[data-ai-send]'), cancel = root.querySelector('[data-ai-cancel-request]'), progress = root.querySelector('[data-ai-progress]'), resultHost = root.querySelector('[data-ai-result]');
  root.querySelector('[data-ai-no-key]').hidden = status.keyPresent&&!ruleStatus.notice;if(ruleStatus.notice)root.querySelector('[data-ai-no-key]').textContent=ruleStatus.notice+' 请到 AI 设置重新保存规则后再发送。';
  let translationFieldSelection = Array.isArray(initialState.translationFields) ? new Set(initialState.translationFields) : null;
  const selectedOptions = () => {
    const constraints = initialConstraints.preserveTerms ? { preserveTerms: initialConstraints.preserveTerms } : {};
    for (const [name, control] of Object.entries(constraintControls)) if (!control.closest('[data-ai-constraint]').hidden && control.value !== '') constraints[name] = Number(control.value);
    return { constraints, ruleOverrides:ruleEditor.getOverrides(), translationMode: controls.aiTranslationMode.value, translationDirection: controls.aiTranslationDirection.value, includeDetails: controls.aiIncludeDetails.checked, ...(actionControl.value === 'translate' && translationFieldSelection !== null ? { translationFields: [...translationFieldSelection] } : {}) };
  };
  const savedState = () => ({ action: actionControl.value, instruction: instruction.value, ...selectedOptions(),ruleState:ruleEditor.getState() });
  const settings = root.querySelector('[data-ai-open-settings]');
  settings.onclick = () => {
    if (busy||!guard.persist()) return; const state = savedState(); dispose(); ctx.closeModal();
    Promise.resolve().then(() => typeof options.onSettings === 'function' ? options.onSettings(state) : ctx.navigate?.('settings')).catch(error => ctx.notify?.(errorText(error), true));
  };
  root.querySelector('[data-ai-discard]').onclick = () => guard.close();
  guard=installAiDraftDialog(ctx,dialog,{persist:persistReview,busy:()=>busy&&!session.request,onError:m=>messageAt(root,m,true),onClose:dispose});
  const discardReview=node('button','放弃候选并关闭','button quiet danger');discardReview.type='button';discardReview.dataset.aiDiscardReview='';discardReview.hidden=true;root.querySelector('.ai-dialog-footer').append(discardReview);discardReview.onclick=()=>{if(busy)return;if(review&&!clearAiReviewDraft(ctx,reviewIdentity))return messageAt(root,'候选草稿未能清理，请重试或先复制文字。',true);review=null;guard.close({discard:true});};
  const setBusy = value => {
    busy = value;ruleEditor?.setDisabled(value);
    if(value){if(!resultLocks)resultLocks=Array.from(resultHost.querySelectorAll('button,input,textarea'),item=>[item,item.disabled]);for(const [item]of resultLocks)item.disabled=true;}else if(resultLocks){for(const [item,disabled]of resultLocks)if(item.isConnected)item.disabled=disabled;resultLocks=null;}
    for (const control of form.querySelectorAll('input,select,textarea')) control.disabled = value;
    settings.disabled = value; send.disabled = value || !status.keyPresent || Boolean(ruleStatus.notice) || !available.length || !currentTask;
    cancel.hidden = !value; progress.hidden = !value;
  };
  const syncTaskControls = () => {
    const action = actionControl.value, writing = !READONLY.has(action) && action !== 'tags';ruleEditor?.setAction(action);
    const active = { maxCharacters: writing, maxBullets: writing, maxTags: action === 'tags', maxFindings: ['review','layout'].includes(action), maxQuestions: ['expand','questions'].includes(action) };
    for (const [name, control] of Object.entries(constraintControls)) control.closest('[data-ai-constraint]').hidden = !active[name];
    for (const item of root.querySelectorAll('[data-ai-translation]')) item.hidden = action !== 'translate';
    root.querySelector('[data-ai-details-toggle]').hidden = !writing || action === 'translate' || typeof options.createTask !== 'function';
    root.querySelector('[data-ai-translation-fields]').hidden = action !== 'translate';
    const rules = root.querySelector('[data-ai-rule-list]'); rules.replaceChildren();
    for (const rule of getAiRules(action)) { const entry = node('p'); entry.append(node('strong', rule.title + '：'), document.createTextNode(rule.text)); rules.append(entry); }
  };
  const preview = () => {
    syncTaskControls();
    try {
      if (actionControl.value === 'translate') {
        const fieldHost = root.querySelector('[data-ai-translation-fields]'); fieldHost.replaceChildren();
        const fullTask = taskFor(options, actionControl.value, instruction.value, { ...selectedOptions(), translationFields: undefined });
        renderTranslationFields(fieldHost, fullTask, translationFieldSelection, selection => { translationFieldSelection = selection; changed(); });
        if (translationFieldSelection !== null && !fullTask.targets.some(target => Object.keys(target.fields).some(field => translationFieldSelection.has(field)))) throw new Error('请选择本次要翻译的字段；切换方向或范围会重新列出可选字段。');
      }
      currentTask = taskFor(options, actionControl.value, instruction.value, selectedOptions());
      if (actionControl.value === 'translate' && controls.aiTranslationDirection.value === 'auto') controls.aiTranslationDirection.value = currentTask.sourceLanguage + '-' + currentTask.targetLanguage;
      sendPreview(root, currentTask, status, options.translationScopeNote,ruleStatus.preferences); messageAt(root, ''); setBusy(false);
    } catch (error) { currentTask = null; root.querySelector('[data-ai-payload-text]').textContent = ''; root.querySelector('[data-ai-send-scope]').textContent = '当前没有可发送的字段，请核对方向、范围及源内容。'; setBusy(false); messageAt(root, errorText(error), true); }
  };
  const finishWith = async (operation,after) => {
    if (busy) return;
    setBusy(true); progress.textContent = '正在保存选中修改…'; cancel.hidden = true;
    try { const outcome=await operation(); if (live()) {const close=after?after(outcome):true;if(close!==false){dispose();ctx.closeModal();}else{setBusy(false);progress.textContent='正在生成，可以取消。服务可能已开始计费。';}} }
    catch (error) { if (live()) { messageAt(root, errorText(error), true); setBusy(false); progress.textContent = '正在生成，可以取消。服务可能已开始计费。'; } }
  };
  const handoff = async operation => {
    if (busy) return;
    if(!guard.persist())return;dispose(); ctx.closeModal();
    try { await operation(); } catch (error) { ctx.notify?.(errorText(error), true); }
  };
  const showResult = (value, task,appliedKeys=[],candidateTasks={},identity=aiReviewIdentity(ctx,task,options.reviewRange)) => {
    const replacedIdentity=review?reviewIdentity:'';
    review={task:structuredClone(task),result:structuredClone(value),appliedKeys:[...appliedKeys],candidateTasks};reviewIdentity=identity;discardReview.hidden=false;root.querySelector('[data-ai-discard]').textContent='关闭并保留候选';
    resultHost.replaceChildren(); resultHost.hidden = false; resultHost.append(node('h3', '建议结果'), node('p', 'AI 可能误解原文，请核对事实后再采用。', 'ai-muted'));
    const returnedChanges=(value.changes||[]).filter(c=>c.value!==task.targets.find(t=>t.id===c.targetId)?.before?.[c.field]);
    if(!READONLY.has(task.action)){const fields=[...new Set(returnedChanges.map(c=>FIELD_NAMES[c.field]||c.field))];resultHost.append(node('p',fields.length?'本次候选实际修改 '+returnedChanges.length+' 个字段：'+fields.join('、')+'。':'本次没有文字改动，原文可以保留。','ai-result-actual'));}
    if (value.summary) {const explanation=node('details',undefined,'ai-model-explanation');explanation.append(node('summary','AI 的优化说明'),node('p',value.summary,'ai-result-summary'));resultHost.append(explanation);}
    if(['expand','questions'].includes(task.action)&&!value.questions?.length)resultHost.append(node('p','本次没有需要补充的问题。你仍可指定希望补充的方向，调整额外要求或本次规则后再次生成。','ai-result-actual'));
    displayList(resultHost, '注意与补充', value.notes);
    // This local view is recomputed for fresh and restored candidates. Never
    // trust a provider/draft-supplied jobReview as a source or classification.
    const jobReview = reviewAiJobResult(task, value);
    if (jobReview?.notices?.length) displayList(resultHost, '本机岗位核对', jobReview.notices);
    const requirements = jobReview?.requirements || value.requirements || [];
    if (requirements.length) {
      const folded = task.action === 'select', section = node(folded ? 'details' : 'section', undefined, 'ai-result-section'); section.dataset.aiRequirements = '';
      section.append(node(folded ? 'summary' : 'h3', '岗位职责与任职条件 · AI 解读' + (folded ? '（' + requirements.length + ' 项）' : '')));
      const levels = { required: '必需', preferred: '优先', optional: '非必需', verify: '待核对' };
      for (const item of requirements) {
        const row = node('article', undefined, 'ai-finding');
        if (typeof item === 'string') row.append(node('p', item));
        else {
          row.append(node('strong', item.reviewStatus === 'uncertain' ? '待核对' : levels[item.level] || '待核对'), node('p', item.text));
          if (item.quote) row.append(node('blockquote', '岗位原句：“' + item.quote + '”'));
          if (item.reviewStatus === 'uncertain' && item.reviewNote) row.append(node('p', item.reviewNote, 'ai-muted'));
        }
        section.append(row);
      } resultHost.append(section);
    }
    if (jobReview?.writingGuidance?.length) {
      const section = node('section', undefined, 'ai-result-section ai-writing-guidance'); section.dataset.aiWritingGuidance = '';
      section.append(node('h3', '简历书写提醒'), node('p', '以下约束针对简历表述，不作为任职资格，也不免除其它岗位条件。', 'ai-muted'));
      const originalLevels = new Map([['required','必需'],['preferred','优先'],['optional','非必需'],['verify','待核对']]);
      for (const item of jobReview.writingGuidance) {
        const row = node('article', undefined, 'ai-finding');
        row.append(node('p', 'AI 原分级：' + (originalLevels.get(item.originalLevel) || '待核对') + '；本机已单列为书写提醒。', 'ai-muted'), node('p', item.text));
        if (item.quote) row.append(node('blockquote', '原句：“' + item.quote + '”'));
        if (item.reviewNote) row.append(node('p', item.reviewNote, 'ai-muted'));
        section.append(row);
      }
      resultHost.append(section);
    }
    const typedSections = [['findings', '检查结果', task.constraints?.maxFindings], ['questions', '建议补充的问题', task.constraints?.maxQuestions]];
    for (const [key, label, limit] of typedSections) if (value[key]?.length) {
      const section = node('section', undefined, 'ai-result-section'); section.dataset[key === 'findings' ? 'aiFindings' : 'aiQuestions'] = ''; section.append(node('h3', label));
      if (limit && value[key].length > limit) section.append(node('p', '本次返回 ' + value[key].length + ' 项，超过设定的 ' + limit + ' 项；全部保留供查看。', 'ai-feedback'));
      for (const item of value[key]) {
        const row = node('article', undefined, 'ai-finding');
        row.append(node('small', scopeLabels(task, item.targetIds, options.targetLabels)));
        if (key === 'findings') row.append(node('strong', item.category), node('p', item.message), node('p', item.suggestion));
        else row.append(node('p', item.question));
        if (item.sources?.length) appendSources(row, item.sources, task); section.append(row);
      }
      if (key === 'questions' && typeof options.onQuestions === 'function') {
        const answer = node('button', '回答问题', 'button primary'); answer.type = 'button'; answer.dataset.aiAnswerQuestions = '';
        answer.onclick = () => handoff(() => options.onQuestions(value.questions, task)); section.append(answer);
      }
      if (key === 'findings' && task.action === 'layout' && typeof options.onLayout === 'function') {
        const layout = node('button', '查看本机版式检查', 'button secondary'); layout.type = 'button'; layout.dataset.aiOpenLayout = '';
        layout.onclick = () => handoff(() => options.onLayout(value.findings, task)); section.append(layout);
      }
      resultHost.append(section);
    }
    if (value.recommendations?.length) {
      const titles = new Map(task.entries.map(entry => [entry.id, entry.title || '未命名经历'])), canAdopt = typeof options.applyRecommendations === 'function' && ['role','select'].includes(task.action);
      const list = node('div', undefined, 'ai-recommendations'), statuses = { priority: 'AI 建议优先展示', optional: '可作补充', weak: '关联较弱' };
      resultHost.append(node('p', '以下是选材建议，不等于具备全部岗位能力。默认不勾选，采用时只选择已有资料原文。', 'ai-muted'));
      for (const [index, item] of value.recommendations.entries()) {
        const row = node('article', undefined, 'ai-recommendation'), label = node('label', undefined, 'ai-recommendation-select'), checkbox = node('input');
        checkbox.type = 'checkbox'; checkbox.dataset.aiRecommendation = String(index); checkbox.checked = false; checkbox.disabled = !canAdopt;
        label.append(checkbox, node('strong', titles.get(item.entryId) || item.entryId)); row.append(label, node('span', statuses[item.status] || '待核对', 'tag neutral'));
        if (item.reason) { const reason = node('details', undefined, 'ai-model-explanation'); reason.append(node('summary', 'AI 选材理由（仍需核对）'), node('p', item.reason)); row.append(reason); }
        const local = jobReview?.recommendations.find(value => value.entryId === item.entryId);
        if (local) {
          const details = node('details', undefined, 'ai-job-conditions'); details.dataset.aiJobConditions = '';
          details.append(node('summary', '逐条岗位对照（' + local.conditions.length + ' 项，仍需核对）'));
          details.append(node('p', '关系为 AI 判断或本机保守提醒，原句存在不代表岗位条件已获证实。', 'ai-muted'));
          const labels = {aligned:'原文可对照（仍需核对）',background:'相关背景',unknown:'未核实',contradiction:'有相反或限制信息'};
          for (const condition of local.conditions) {
            const card = node('article', undefined, 'ai-job-condition'); card.dataset.aiJobCondition = condition.requirementId;
            const status = node('strong', labels[condition.status] || '未核实'); status.dataset.aiJobConditionStatus = condition.status;
            card.append(node('h4', condition.requirementText), status);
            if (condition.requirementQuote) card.append(node('blockquote', '岗位原句：“' + condition.requirementQuote + '”'));
            if (condition.explanation) card.append(node('p', condition.explanation));
            if (condition.sources?.length) appendSources(card, condition.sources, task, {title:'查看本条件的经历引文',note:'仅供本条件对照，不证明已经具备或满足岗位要求。'});
            details.append(card);
          }
          if (!local.conditions.length) details.append(node('p', '本次没有可逐条对照的任职条件，可按已有原文自行选择。'));
          row.append(details);
          if (local.warnings?.length) displayList(row, '对照提醒', local.warnings);
        } else if (!jobReview) {
          // Legacy responses remain readable without upgrading their shared
          // recommendation sources into evidence for each requirement.
          row.append(node('p', '旧结果未提供逐条岗位对照，以下仅作选材背景。', 'ai-muted'));
        }
        if (item.sources?.length) appendSources(row, item.sources, task, {title:'查看选材背景原文（非逐条件证明）',note:'这些原句仅说明选材背景，不为每条岗位条件分别背书。'});
        list.append(row);
      } resultHost.append(list);
      if (canAdopt) {
        const adopt = node('button', '采用勾选资料原文', 'button primary'); adopt.type = 'button'; adopt.dataset.aiAdoptRecommendations = '';
        const selected = () => Array.from(list.querySelectorAll('[data-ai-recommendation]:checked'), input => value.recommendations[Number(input.dataset.aiRecommendation)]);
        const sync = () => { adopt.disabled = !selected().length; }; list.onchange = sync; sync();
        adopt.onclick = () => { const recommendations = selected(); if (!busy && recommendations.length) finishWith(() => options.applyRecommendations({ ...value, recommendations }, task)); }; resultHost.append(adopt);
      }
    }
    const changes = Array.isArray(value.changes) ? value.changes.map(change => ({ ...change, sources: change.sources?.map(source => ({ ...source })) })) : [];review.result.changes=changes;
    if (!options.readonly && !READONLY.has(task.action) && changes.length) {
      const comparison = node('div', undefined, 'ai-changes'), apply = node('button', '接受选中修改', 'button primary'); apply.type = 'button'; apply.dataset.aiApply = ''; apply.disabled = true;
      const syncApply = () => { apply.disabled = !comparison.querySelector('[data-ai-change]:checked:not(:disabled)'); };
      for (const [index, change] of changes.entries()) {
        const candidateTask=review.candidateTasks[reviewKey(change)]||task,target = candidateTask.targets.find(target => target.id === change.targetId), item = node('article', undefined, 'ai-change'), heading = node('label', undefined, 'ai-change-select'), checkbox = node('input');
        checkbox.type = 'checkbox'; checkbox.dataset.aiChange = String(index); checkbox.checked = false; heading.append(checkbox, node('span', targetHeading(task, target, change.field, options.targetLabels))); item.append(heading);
        const translation = task.action === 'translate', columns = node('div', undefined, 'ai-comparison' + (translation ? ' ai-comparison-translation' : ''));
        const versions = translation ? [['源语言原文（' + languageName(task.sourceLanguage) + '）', target?.fields?.[change.field] ?? ''], ['目标当前版本（' + languageName(task.targetLanguage) + '）', target?.before?.[change.field] ?? '']] : [['当前版本', target?.before?.[change.field] ?? target?.fields?.[change.field] ?? '']];
        for (const [label, text] of versions) { const column = node('div'); column.append(node('small', label), node('pre', text)); columns.append(column); }
        const suggestion = node('div', undefined, 'ai-comparison-suggestion'), editor = node('textarea'); editor.dataset.aiEdit = String(index); editor.rows = 5; editor.value = change.value; editor.setAttribute('aria-label', '编辑建议：' + targetHeading(task, target, change.field, options.targetLabels)); suggestion.append(node('small', 'AI 建议 · 可直接编辑'), editor); columns.append(suggestion); item.append(columns);
        if (change.reason) item.append(node('p', change.reason, 'ai-muted'));
        const count = node('p', undefined, 'ai-candidate-count'); count.dataset.aiCount = ''; const validation = node('div', undefined, 'ai-candidate-validation'); validation.setAttribute('aria-live', 'polite'); const risk = node('div', undefined, 'ai-candidate-risk'); risk.dataset.aiRisk = ''; item.append(count, validation, risk); appendSources(item, change.sources, candidateTask);
        const assess = () => {
          let assessment;
          try { assessment = assessAiCandidate(candidateTask, change);if(!review.appliedKeys.includes(reviewKey(change)))try{options.assertCurrent?.(candidateTask);}catch(error){assessment={...assessment,allowed:false,errors:[...assessment.errors,{message:errorText(error)}]};} } catch { assessment = { allowed: false, errors: [{ message: '候选格式无效，不能采用。' }], warnings: [], characters: 0, tags: 0, bullets: 0 }; }
          count.textContent = change.field === 'tags' ? '标签 ' + assessment.tags + ' / ' + (task.constraints?.maxTags ?? 6) : '字数 ' + assessment.characters + (task.constraints?.maxCharacters ? ' / ' + task.constraints.maxCharacters : '') + ' · 要点 ' + (assessment.bullets ?? 0) + (task.constraints?.maxBullets ? ' / ' + task.constraints.maxBullets : '');
          checkbox.disabled = !assessment.allowed; if (checkbox.disabled) checkbox.checked = false; item.classList.toggle('ai-change-blocked', checkbox.disabled);
          validation.replaceChildren(); for (const error of assessment.errors || []) validation.append(node('p', error.message, 'ai-feedback error'));
          risk.replaceChildren(); for (const warning of assessment.warnings || []) risk.append(node('p', warning.message, 'ai-risk-note'));
          if (!assessment.warnings?.length) risk.append(node('p', '本机未检出已知差异风险；仍需核对事实。', 'ai-muted'));
          syncApply();
        };
        editor.oninput = () => { if (busy) return; change.value = editor.value; change.userEdited = true; checkbox.checked = false; assess();if(!persistReview())messageAt(root,'候选手稿暂未能写入本机，请保留此窗口。',true); };
        checkbox.onchange = syncApply; comparison.append(item); assess();
        if(review.appliedKeys.includes(reviewKey(change))){item.dataset.aiApplied='';checkbox.checked=false;for(const control of item.querySelectorAll('input,textarea'))control.disabled=true;const saved=node('p','此字段已采用；其它候选仍保留。','ai-muted');item.prepend(saved);}
      }
      apply.onclick = () => {
        if (busy) return;
        const selected = Array.from(comparison.querySelectorAll('[data-ai-change]:checked:not(:disabled)'), input => changes[Number(input.dataset.aiChange)]);
        if (!selected.length || typeof options.apply !== 'function') return;
        let packet;try{packet=prepareAiReviewSelection(review,selected,{allowedTask:currentTask||task,assertCurrent:options.assertCurrent});}catch(error){messageAt(root,errorText(error),true);return;}
        finishWith(() => options.apply(packet.changes, { ...value, changes,appliedKeys:review.appliedKeys,candidateTasks:review.candidateTasks }, packet.task),outcome=>{
          for(const change of selected){const key=reviewKey(change);if(!review.appliedKeys.includes(key))review.appliedKeys.push(key);}
          if(review.appliedKeys.length===changes.length){if(!clearAiReviewDraft(ctx,reviewIdentity)){persistReview();messageAt(root,'修改已采用，但候选草稿未能清理。请重试关闭，已采用字段不会再次写入。',true);return false;}review=null;return true;}
          const saved=showResult({...value,changes:outcome?.changes||changes},outcome?.task||task,review.appliedKeys,{...review.candidateTasks,...outcome?.candidateTasks},reviewIdentity);if(!saved){messageAt(root,'选中字段已保存；其余候选手稿暂未能写入本机，请保留窗口，重试关闭或先复制文字。',true);return false;}messageAt(root,outcome?.warning||'选中字段已采用，其余候选与手稿仍保留。若原文依据已变化会拒绝旧稿采用，可先保留文字再重新生成。');return false;
        });
      }; resultHost.append(comparison, apply);
    } else if (!value.summary && !value.notes?.length && !value.requirements?.length && !value.recommendations?.length && !value.findings?.length && !value.questions?.length) resultHost.append(node('p', '本次没有返回可采用的修改。可调整要求后重试。', 'ai-muted'));
    resultHost.scrollIntoView({ block: 'nearest' });if(!persistReview()){messageAt(root,'候选暂未能写入本机，请保留此窗口。',true);return false;}if(replacedIdentity&&replacedIdentity!==reviewIdentity&&!clearAiReviewDraft(ctx,replacedIdentity)){messageAt(root,'新候选已保留，旧候选草稿未能清理；可稍后重试。',true);return false;}return true;
  };
  const restoreReview=()=>{if(!currentTask)return;const identity=aiReviewIdentity(ctx,currentTask,options.reviewRange),saved=findAiReviewDraft(ctx,identity,currentTask,options.reviewRange);if(saved.review&&aiReviewOriginMatches(ctx,saved.review.task,currentTask)){if(showResult(saved.review.result,saved.review.task,saved.review.appliedKeys,saved.review.candidateTasks,saved.identity))messageAt(root,'已恢复本机候选手稿。采用前仍按生成时的原文快照校验；资料变化时请先保留文字再重新生成。');}else if(saved.notice){messageAt(root,saved.notice,true);discardReview.hidden=false;reviewIdentity=saved.identity;discardReview.onclick=()=>{if(clearAiReviewDraft(ctx,reviewIdentity))guard.close({discard:true});else messageAt(root,'草稿未能清理，请重试。',true);};}};
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || !status.keyPresent || ruleStatus.notice || !form.reportValidity()) return;
    let task; try { task = taskFor(options, actionControl.value, instruction.value, selectedOptions()); } catch (error) { messageAt(root, errorText(error), true); return; }
    if(review?.result.changes?.some(change=>change.userEdited)&&!regenerateConfirmed){let confirm=root.querySelector('[data-ai-regenerate-confirmation]');if(!confirm){confirm=node('div',undefined,'ai-feedback');confirm.dataset.aiRegenerateConfirmation='';confirm.append(node('p','当前有手工修改的候选。新结果成功生成后将替换本轮候选；失败或取消会保留。'));const yes=node('button','确认生成新候选','button secondary');yes.type='button';yes.dataset.aiConfirmRegenerate='';yes.onclick=()=>{regenerateConfirmed=true;confirm.remove();form.requestSubmit();};const no=node('button','继续编辑旧候选','button quiet');no.type='button';no.onclick=()=>confirm.remove();confirm.append(yes,no);resultHost.before(confirm);}return;}
    regenerateConfirmed=false;if(!persistReview())return messageAt(root,'旧候选暂未能保存，请先保留当前文字后再重新生成。',true);
    const id = crypto.randomUUID(); session.request = id; messageAt(root, ''); setBusy(true);
    try { const response = await window.resume.aiGenerate({ id, task }); if (!live() || session.request !== id) return; showResult(response, task); }
    catch (error) { if (live() && session.request === id) messageAt(root, errorText(error), true); }
    finally { if (live() && session.request === id) { session.request = null; setBusy(false); } }
  };
  cancel.onclick = () => { cancelRequest(); setBusy(false); messageAt(root, '已取消本次生成。可以调整后再次发送。'); };
  const changed = () => { if (busy) return;preview();if(review){let note=root.querySelector('[data-ai-review-context]');if(!note){note=node('p',undefined,'ai-risk-note');note.dataset.aiReviewContext='';resultHost.before(note);}note.textContent='下方保留的是上一轮任务依据生成的候选。本次要求已修改；只有成功生成新结果才会替换，原文过期检查继续生效。';if(!persistReview())messageAt(root,'候选手稿暂未能写入本机，请保留此窗口。',true);} }; 
  const changeContext=()=>{if(busy)return;if(!persistReview()){if(review)actionControl.value=review.task.action;return messageAt(root,'候选手稿未能保存，请先保留当前文字后再切换任务或范围。',true);}review=null;resultHost.replaceChildren();resultHost.hidden=true;discardReview.hidden=true;root.querySelector('[data-ai-review-context]')?.remove();root.querySelector('[data-ai-regenerate-confirmation]')?.remove();preview();restoreReview();};
  actionControl.onchange = () => {if(!busy&&actionControl.value==='layout'&&typeof options.onLocalLayout==='function')return handoff(()=>options.onLocalLayout(savedState()));changeContext();}; instruction.oninput = changed;
  for (const control of Object.values(constraintControls)) control.oninput = changed;
  const resetTranslationFields = () => { translationFieldSelection = null; changeContext(); };
  controls.aiTranslationMode.onchange = resetTranslationFields; controls.aiTranslationDirection.onchange = resetTranslationFields; controls.aiIncludeDetails.onchange = changeContext;
  preview();restoreReview();
}
