import {requestAiRuleNavigation} from './ai-rule-controls.mjs';
import { escape } from './helpers.mjs';

const countLabels = [
  ['libraryEntries', '条资料'], ['libraryVersions', '个资料库历史版本'],
  ['projects', '份简历项目'], ['templates', '个个人模板'],
  ['attachments', '个补充文件'], ['pdfs', '份归档 PDF'], ['snapshots', '份可编辑导出快照'],
];
const sizeLabel = bytes => Number.isFinite(bytes) ? (bytes / 1024 / 1024).toFixed(2) + ' MB' : '';
export function openFullBackupCenter(ctx) {
  if(document.querySelector('#modal')?.open||ctx.ui.fullRestoring||ctx.ui.fullBackupBusy)return false;
  ctx.modal('备份与换机','保存一个文件，即可在另一台电脑恢复整份资料库。',
    '<ol class="full-backup-steps"><li>在当前电脑点击“一键打包资料库（换机）”，选择位置保存。</li><li>新电脑安装 ITS ME，打开这里并选择“从备份恢复”。</li><li>核对内容后恢复，即可继续填写和制作简历。</li></ol><div data-backup-center></div><div class="modal-actions"><button type="button" class="button quiet" data-library-history>查看最近5个资料版本</button><button type="button" class="button secondary" data-backup-center-close>关闭</button></div>',
    root=>{
      mountFullBackup(ctx,root.querySelector('[data-backup-center]'));
      root.querySelector('[data-library-history]').onclick=()=>{if(ctx.ui.fullBackupBusy||ctx.ui.fullRestoring)return;ctx.closeModal();ctx.showBackups();};
      root.querySelector('[data-backup-center-close]').onclick=()=>ctx.closeModal();
    });
  return true;
}
function describe(result) {
  return `<p class="full-backup-file"><strong>${escape(result.fileName || '本地备份')}</strong><span>${escape(sizeLabel(result.bytes))}</span></p><dl class="full-backup-counts">${countLabels.map(([key, label]) => `<div><dt>${label}</dt><dd>${Number.isSafeInteger(result.counts?.[key]) ? result.counts[key] : '—'}</dd></div>`).join('')}</dl>`;
}

/** Main owns file paths; renderer receives an opaque, single-use inspection token. */
export function mountFullBackup(ctx, host) {
  if (!host) return;
  host.innerHTML = `<div class="full-backup"><h3>资料库备份与换机</h3><p>将资料库（含个人照片）、简历项目、个人模板、被引用的补充文件、全部归档 PDF 保存为一个 .itsme-backup 文件。新电脑安装软件后，在这里点击“从备份恢复”。</p><p class="muted">保留库内最近 5 个资料版本、全部 PDF、最新 3 次可编辑导出快照。不包含 AI Key、AI 规则和未提交草稿。换电脑后恢复资料即可继续使用。备份未加密，请勿公开分享。</p><div class="button-group full-backup-actions"><button type="button" class="button primary" data-backup="create">一键打包资料库（换机）</button><button type="button" class="button secondary" data-backup="inspect">从备份恢复</button></div><p class="full-backup-status" role="status" aria-live="polite"></p><div class="full-backup-review" hidden></div><p class="full-backup-limit muted">单个补充文件或 PDF 最多 100 MB，资料文件最多 32 MB，内容合计最多 256 MB。超过上限会停止并保留原资料。</p></div>`;
  const controls = [...host.querySelectorAll('[data-backup]')];
  const status = host.querySelector('.full-backup-status');
  const review = host.querySelector('.full-backup-review');
  let busy = false, inspected = null;
  const modal=host.closest?.('dialog'), cancel=event=>{if(busy)event.preventDefault();};
  if(modal){modal.addEventListener('cancel',cancel);modal.addEventListener('close',()=>modal.removeEventListener('cancel',cancel),{once:true});}
  const setStatus = (message, error = false) => { status.textContent = message; status.classList.toggle('is-error', error); };
  const lock = (value,{background=true}={}) => {
    busy = value;
    if(background)ctx.setFullBackupBusy?.(value);
    for (const control of controls) control.disabled = value;
    review.querySelectorAll('button,input').forEach(control => { control.disabled = value || (control.dataset.backupConfirm !== undefined && (!review.querySelector('input')?.checked||(Boolean(review.querySelector('[data-backup-unsaved-confirm]'))&&!review.querySelector('[data-backup-unsaved-confirm]').checked))); });
    host.setAttribute('aria-busy', String(value));
  };
  const clearReview = () => { inspected = null; review.hidden = true; review.replaceChildren(); };
  const fail = error => { const message = error?.message || '操作未完成，请重试。'; setStatus(message, true); ctx.notify?.(message, true); };
  const prepare = async () => {if(typeof ctx.prepareFullBackup==='function')return await ctx.prepareFullBackup();if(typeof ctx.flush==='function')await ctx.flush();return{unsavedProjects:0};};
  const unsavedWarning=count=>count?'<p data-backup-unsaved-warning class="full-backup-warning" role="note">当前有 '+count+' 份简历尚未保存。备份只包含已保存内容；未保存修改仍留在当前窗口。恢复会放弃这些修改。如需保留，请先保存修改，再进行备份或恢复。</p>':'';
  controls.find(control => control.dataset.backup === 'create').onclick = async () => {
    if (busy) return;
    lock(true); clearReview(); setStatus('正在保存完整备份…');
    try {
      const prepared=await prepare();
      const result = await window.resume.createFullBackup();
      if (!result || result.canceled) { setStatus('已取消保存。'); return; }
      review.innerHTML = describe(result)+unsavedWarning(prepared.unsavedProjects); review.hidden = false;
      setStatus('完整备份已保存。'+(prepared.unsavedProjects?'备份仅含已保存内容；未保存修改仍在本窗口，保存后请重新备份。':'建议另存一份到其他磁盘或U盘；请勿公开分享。'));
      ctx.notify?.('完整备份已保存');
    } catch (error) { fail(error); }
    finally { lock(false); }
  };
  controls.find(control => control.dataset.backup === 'inspect').onclick = async () => {
    if (busy) return;
    lock(true); clearReview(); setStatus('正在检查备份；预检不会替换本机资料…');
    try {
      const prepared=await prepare();
      const result = await window.resume.inspectFullBackup();
      if (!result || result.canceled) { setStatus('已取消选择。'); return; }
      if (typeof result.token !== 'string' || !result.token) throw new Error('预检没有返回有效确认凭据，请重试。');
      inspected = result;
      review.innerHTML = `<h4>预检通过</h4>${describe(result)}${unsavedWarning(prepared.unsavedProjects)}<p>确认恢复后，当前资料库、项目、模板、补充文件、PDF 将由这份备份替换。恢复前会在数据目录保留完整救援备份与原受管文件；两者不会自动删除。</p><label class="full-backup-confirm"><input type="checkbox"><span>我已核对备份内容，确认替换本机资料。</span></label>${prepared.unsavedProjects?'<label class="full-backup-confirm"><input type="checkbox" data-backup-unsaved-confirm><span>同时放弃这 '+prepared.unsavedProjects+' 份简历的未保存修改，使用备份版本。</span></label>':''}<div class="button-group"><button type="button" class="button primary" data-backup-confirm disabled>确认恢复</button><button type="button" class="button quiet" data-backup-cancel>取消</button></div>`;
      review.hidden = false;
      const checkbox = review.querySelector('input'), confirm = review.querySelector('[data-backup-confirm]');
      const unsaved=review.querySelector('[data-backup-unsaved-confirm]');
      const acknowledged=()=>checkbox.checked&&(!unsaved||unsaved.checked);
      checkbox.onchange = () => { confirm.disabled = busy || !acknowledged(); };
      if(unsaved)unsaved.onchange=checkbox.onchange;
      review.querySelector('[data-backup-cancel]').onclick = () => { if (!busy) { clearReview(); setStatus('已取消恢复，本机资料保持原样。'); } };
      confirm.onclick = async () => {
        if (busy || !acknowledged() || !inspected) return;
        const token = inspected.token;
        lock(true,{background:false});
        let restored = false, restoreScopeLocked = false;
        try {
          if (!await requestAiRuleNavigation(ctx)) {setStatus('恢复尚未开始，请先处理规则修改。');return;}
          lock(true); setStatus('正在保存救援备份并恢复资料，请等待完成…');
          const current=await prepare();
          if(current.unsavedProjects&&(!unsaved?.checked||current.unsavedProjects>prepared.unsavedProjects))throw Error('未保存简历已变化，请重新预检并核对是否放弃修改；当前稿仍保留。');
          restoreScopeLocked = true;
          ctx.setFullRestoreBusy?.(true);
          const result = await window.resume.restoreFullBackup({ token });
          if (!result?.state) throw new Error('没有收到恢复结果，请重新打开软件检查。');
          restored = true;
          clearReview();
          review.innerHTML = `<p>恢复完成。恢复前资料已保留为 <strong>${escape(result.rescueFileName || '本机救援备份')}</strong>，可在数据目录找到。</p>`;
          review.hidden = false;
          setStatus('完整备份已恢复。');
          if (typeof ctx.afterFullRestore === 'function') await ctx.afterFullRestore(result.state);
          else ctx.merge?.(result.state);
          ctx.notify?.('资料已恢复，恢复前救援备份已保留');
        } catch (error) {
          inspected = null;
          if (restored) fail(new Error('资料已恢复，但页面刷新未完成，请重新打开软件。'));
          else { clearReview(); fail(error); }
        } finally {
          try { if (restoreScopeLocked) ctx.setFullRestoreBusy?.(false); }
          finally { lock(false); }
        }
      };
      setStatus('已完成只读预检。请核对内容，再勾选并确认恢复。');
    } catch (error) { clearReview(); fail(error); }
    finally { lock(false); }
  };
}