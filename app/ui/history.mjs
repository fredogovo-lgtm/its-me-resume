import {mountDataLocation} from './data-location.mjs';
import {runStateTransaction} from './state-transactions.mjs';
import {mountHelpSettings} from './help-center.mjs';
import {mountSoftwareUpdate} from './software-update.mjs';
import { $, $$, escape, button, icon, dateLabel } from './helpers.mjs';
import { exportDisplayInfo } from './export-history.mjs';
import {renderAiSettings} from './ai-assistant.mjs';
import {mountFullBackup} from './full-backup.mjs';
export function renderHistory(ctx) {
  const records = [...ctx.state.exports].sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const filters = (ctx.ui.historyFilters ||= { query: '', language: '', paper: '' });
  const papers = [...new Set(records.map(record => exportDisplayInfo(record).paperKey))].sort();
  const paperName = key => key === 'custom' ? '自定义' : key === 'unknown' ? '纸张未记录' : key;
  $('#screen').innerHTML = `<div class="page-heading"><div><h1>导出历史</h1><p>每次投递都有记录。最近 3 次导出可以从当时的状态继续编辑。</p></div><span class="page-count">${records.length} 次导出</span></div>${records.length ? `<form class="history-filters" role="search"><label>查找<input id="history-query" type="search" placeholder="简历名称、岗位或岗位要求" value="${escape(filters.query)}"></label><label>语言<select id="history-language"><option value="">全部语言</option>${[['zh','中文'],['en','English'],['unknown','语言未记录']].map(([key,label]) => `<option value="${key}" ${filters.language === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>纸张<select id="history-paper"><option value="">全部纸张</option>${papers.map(key => `<option value="${escape(key)}" ${filters.paper === key ? 'selected' : ''}>${paperName(key)}</option>`).join('')}</select></label><button type="button" class="button quiet" id="history-clear">清除筛选</button><span id="history-visible-count" aria-live="polite"></span></form><div class="history-table"><div class="history-head"><span>简历与目标岗位</span><span>导出时间</span><span>操作</span></div>${records.map(record => {
    const info = exportDisplayInfo(record);
    return `<article class="history-row" data-export-id="${record.id}"><div class="history-name"><span class="pdf-symbol">PDF</span><div><strong>${escape(record.projectName)}</strong><p>${escape(record.jobTitle || '通用简历')}</p><div class="history-badges"><span>${info.languageLabel}</span><span>${escape(info.paperLabel)}</span><span>${info.pageLabel}</span></div>${record.jobDescription ? `<details><summary>岗位要求</summary><p class="jd-detail">${escape(record.jobDescription)}</p></details>` : ''}${record.attachments?.length ? `<details class="history-attachments"><summary>补充文件（${record.attachments.length}）</summary>${record.attachments.map(file => `<button type="button" data-open-attachment="${file.id}">${icon('file',13)}${escape(file.name)}</button>`).join('')}</details>` : ''}</div></div><div class="history-time">${dateLabel(record.createdAt)}<small>${record.editable ? '可继续编辑' : '已归档 PDF'}</small></div><div class="button-group">${button('打开 PDF','open-pdf','secondary',`data-id="${record.id}"`)}${record.editable ? button('继续编辑','reopen','primary',`data-id="${record.id}"`) : '<span class="history-archive-note">编辑状态已轮换</span>'}</div></article>`;
  }).join('')}</div><div class="empty-compact" id="history-no-results" hidden>没有符合筛选条件的导出。可以更换关键词或清除筛选。</div>` : `<div class="empty-state"><div class="empty-paper">${icon('history',40)}</div><h2>留下第一份投递记录</h2><p>导出简历后，PDF、岗位说明和所选补充文件会保存在这里。</p>${button('建立简历','new-project','primary')}</div>`}`;
  if (records.length) {
    const form = $('.history-filters'); form.onsubmit = event => event.preventDefault();
    const apply = () => {
      filters.query = $('#history-query').value; filters.language = $('#history-language').value; filters.paper = $('#history-paper').value;
      const query = filters.query.trim().toLocaleLowerCase(); let count = 0;
      for (const record of records) {
        const info = exportDisplayInfo(record), row = $('[data-export-id="' + record.id + '"]');
        const matches = (!filters.language || filters.language === info.language) && (!filters.paper || filters.paper === info.paperKey) && (!query || [record.projectName,record.jobTitle,record.jobDescription].join(' ').toLocaleLowerCase().includes(query));
        row.hidden = !matches; if (matches) count++;
      }
      $('#history-visible-count').textContent = '显示 ' + count + ' / ' + records.length + ' 次'; $('#history-no-results').hidden = count > 0;
    };
    form.oninput = apply; form.onchange = apply;
    $('#history-clear').onclick = () => { $('#history-query').value = ''; $('#history-language').value = ''; $('#history-paper').value = ''; apply(); $('#history-query').focus(); };
    apply();
  }
  $('[data-action="new-project"]')?.addEventListener('click',() => ctx.startWizard({isNew:true}));
  $$('[data-action="open-pdf"]').forEach(control => control.onclick = async () => { try { await window.resume.openPDF(control.dataset.id); } catch (error) { ctx.notify(error.message,true); } });
  $$('[data-open-attachment]').forEach(control => control.onclick = () => ctx.openAttachment(control.dataset.openAttachment));
  $$('[data-action="reopen"]').forEach(control => control.onclick = async () => { try { await runStateTransaction(ctx,'正在从历史建立简历',async()=>{await ctx.flush();ctx.merge(await window.resume.reopenExport(control.dataset.id));ctx.ui.selectedBlockId=null;});await ctx.navigate('editor');ctx.notify('已从导出状态新建简历'); } catch (error) { ctx.notify(error.message,true); } });
}
export function renderSettings(ctx) {
  $('#screen').innerHTML=`<div class="page-heading"><div><h1>设置</h1><p>整理自己的经历，保留自己的节奏。</p></div></div><div class="settings-layout"><section class="settings-section"><h2>本地资料</h2><p>换电脑时先打包，再在新电脑恢复同一资料库。</p><div id="full-backup-host"></div><h3>资料保存位置</h3>${button('打开数据目录','data-folder')}<div id="data-location-host"></div><dl class="settings-facts"><div><dt>资料库历史版本</dt><dd>最近 5 个完整版本</dd></div><div><dt>导出 PDF 与补充文件</dt><dd>保留全部成功导出的记录</dd></div><div><dt>可继续编辑的导出</dt><dd>最近 3 次，打开时新建项目</dd></div></dl></section><section class="settings-section"><h2>AI 辅助</h2><div id="ai-settings-host"></div></section><section class="settings-section"><h2>ITS ME</h2><p>版本 ${escape(ctx.version || '未读取')} · 免费版 · Windows 离线简历编辑器</p><p>你的经历，你的表达。</p><div id="software-update-host"></div><div id="help-settings-host"></div></section></div>`;
  mountDataLocation(ctx,$('#data-location-host'));
  mountFullBackup(ctx,document.querySelector("#full-backup-host"));
  mountSoftwareUpdate(ctx,$('#software-update-host'));
  mountHelpSettings(ctx,$('#help-settings-host'));
  renderAiSettings(ctx,$('#ai-settings-host'));
  $('[data-action="data-folder"]').onclick=async()=>{try{await window.resume.openDataFolder();}catch(error){ctx.notify(error.message,true);}};
}
