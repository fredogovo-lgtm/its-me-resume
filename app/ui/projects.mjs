import { loadWizardDraft } from './wizard-drafts.mjs';
import { $, $$, escape, icon, button, dateLabel, field, input } from './helpers.mjs';
import {duplicateProject,renameProject,suggestProjectName,setProjectArchived,filterProjects,projectThumbnailContent} from '../core/project-versions.mjs';
function lockProjectOperation(ctx,root){
  ctx.ui.projectManagementBusy=true;
  const dialog=root?.closest('dialog'),controls=[...(root?.querySelectorAll('button,input,textarea,select')||[]),...($('#close-modal')?[$('#close-modal')]:[])].map(node=>[node,node.disabled]);
  const background=[...document.querySelectorAll('.rail,.workspace')].map(node=>[node,node.inert]);
  const cancel=event=>event.preventDefault();dialog?.addEventListener('cancel',cancel,true);
  for(const[node]of controls)node.disabled=true;for(const[node]of background)node.inert=true;
  let released=false;return()=>{if(released)return;released=true;ctx.ui.projectManagementBusy=false;dialog?.removeEventListener('cancel',cancel,true);for(const[node,disabled]of controls)if(node.isConnected)node.disabled=disabled;for(const[node,inert]of background)if(node.isConnected)node.inert=inert;};
}
function showVersionName(ctx,id,copy){
  const source=ctx.state.projects.find(project=>project.id===id);if(!source)return ctx.notify('这份简历已不存在，请刷新列表。',true);
  const suggested=copy?suggestProjectName(ctx.state.projects,source.name):source.name;
  ctx.modal(copy?'复制简历':'重命名简历',copy?'为新版本命名。文字、照片和排版会完整复制，之后可以独立修改。':'修改列表与后续导出使用的名称。已导出的历史记录保留原名称。',
    '<form id="project-version-form">'+field('简历名称',input('projectName',suggested,'maxlength="500" required autocomplete="off"'))+'<div class="modal-actions"><button type="button" class="button secondary" data-project-version-cancel>取消</button><button type="submit" class="button primary">'+(copy?'创建副本':'保存名称')+'</button></div></form>',root=>{
      const form=root.querySelector('form'),submit=form.querySelector('[type="submit"]');root.querySelector('[data-project-version-cancel]').onclick=()=>ctx.closeModal();
      form.onsubmit=async event=>{event.preventDefault();if(ctx.ui.projectManagementBusy)return;const unlock=lockProjectOperation(ctx,root);try{
        await ctx.flush();const current=ctx.state.projects.find(project=>project.id===id);if(!current)throw new Error('这份简历已不存在，请刷新列表。');
        if(copy&&ctx.state.projects.length>=500)throw new Error('简历项目已达500份，请先删除不再需要的项目；归档仍计入总数。');
        const next=copy?duplicateProject(current,form.elements.projectName.value):renameProject(current,form.elements.projectName.value);
        ctx.merge(await window.resume.saveProject(next));if(copy){ctx.ui.selectedBlockId=null;ctx.ui.projectFilters={query:'',language:'all',status:'active'};}unlock();ctx.closeModal();ctx.render();ctx.notify(copy?'已创建独立副本，可以打开继续编辑。':'简历名称已更新。');
      }catch(error){ctx.notify(error.message,true);}finally{unlock();}};
      requestAnimationFrame(()=>{form.elements.projectName.focus();form.elements.projectName.select();});
    });
}
function projectCard(project){
  const preview=projectThumbnailContent(project);
  return `<article class="project-card"><button type="button" class="project-card-open" data-open-project="${project.id}" aria-label="打开简历：${escape(project.name)}"><div class="project-thumbnail"><div class="thumbnail-paper ${project.template==='sidebar'?'thumbnail-sidebar':''}"><h3>${escape(preview.title)}</h3><span class="thumbnail-rule"></span>${preview.entries.map(title=>`<div><strong>${escape(title)}</strong><i></i><i></i></div>`).join('')}</div><span class="project-open">打开编辑 ${icon('arrow',14)}</span></div><div class="project-card-info"><strong title="${escape(project.name)}">${escape(project.name)}</strong><p>${escape(project.jobTitle||'通用简历')}<span>${project.language==='en'?'英文':'中文'} · ${escape(project.paper.name)}</span></p><small>${project.archived?'已归档 · ':''}修改于 ${dateLabel(project.updatedAt)}</small></div></button><div class="project-version-actions"><button type="button" class="button quiet" data-copy-project="${project.id}">${icon('copy',14)}复制</button><button type="button" class="button quiet" data-rename-project="${project.id}">重命名</button>${project.archived?`<button type="button" class="button quiet" data-restore-project="${project.id}">取消归档</button>`:`<button type="button" class="button quiet" data-archive-project="${project.id}">归档</button>`}<button type="button" class="button quiet danger" data-delete-project="${project.id}" aria-label="删除简历：${escape(project.name)}">删除</button></div></article>`;
}
async function changeArchive(ctx,id,archived){
  if(ctx.ui.projectManagementBusy)return;const unlock=lockProjectOperation(ctx);
  try{await ctx.flush();const project=ctx.state.projects.find(row=>row.id===id);if(!project)throw Error('这份简历已不存在，请刷新列表。');ctx.merge(await window.resume.saveProject(setProjectArchived(project,archived)));ctx.render();ctx.notify(archived?'已归档，可在“已归档”中找到并继续编辑。':'已取消归档，可在“正在使用”中找到。');}
  catch(error){ctx.notify(error.message,true);}finally{unlock();}
}
function showDeleteProject(ctx,id){
  const project=ctx.state.projects.find(row=>row.id===id);if(!project)return;
  ctx.modal('删除这份简历？','仅删除这份可编辑项目，资料库、已导出的 PDF 和导出历史均保留。项目删除后不能通过撤销恢复；仍有可编辑历史快照时可另建新项目。',
    `<p class="project-delete-name">${escape(project.name)}</p><p>如果以后还可能使用，建议先归档。</p><div class="modal-actions"><button type="button" class="button secondary" data-project-delete-cancel>取消</button><button type="button" class="button secondary" data-project-delete-archive>${project.archived?'保留归档':'改为归档'}</button><button type="button" class="button danger" data-project-delete-confirm>确认删除项目</button></div>`,root=>{
      const dialog=root.closest('dialog'),close=$('#close-modal');
      root.querySelector('[data-project-delete-cancel]').onclick=()=>ctx.closeModal();
      root.querySelector('[data-project-delete-archive]').onclick=async()=>{ctx.closeModal();if(!project.archived)await changeArchive(ctx,id,true);};
      const preventClose=event=>{if(ctx.ui.projectManagementBusy)event.preventDefault();};dialog?.addEventListener('cancel',preventClose);
      dialog?.addEventListener('close',()=>dialog.removeEventListener('cancel',preventClose),{once:true});
      root.querySelector('[data-project-delete-confirm]').onclick=async()=>{
        if(ctx.ui.projectManagementBusy)return;const unlock=lockProjectOperation(ctx,root);
        try{await ctx.flush();ctx.merge(await window.resume.deleteProject(id));ctx.forgetProject?.(id);unlock();ctx.closeModal();ctx.render();ctx.notify('简历项目已删除，资料库和历史 PDF 保留。');}
        catch(error){ctx.notify(error.message,true);}finally{unlock();}
      };
    });
}
export function renderProjects(ctx) {
  const filters=ctx.ui.projectFilters||={query:'',language:'all',status:'active'},all=ctx.state.projects;
  const archived=all.filter(project=>project.archived===true).length;
  $('#screen').innerHTML=`<div class="page-heading"><div><h1>我的简历</h1><p>同一份资料，不同的表达。每份简历都可以独立编辑。</p></div><span class="page-count">${all.length} 份简历${archived?' · '+archived+' 份已归档':''}</span></div>${all.length?`<div class="project-filters" role="search" aria-label="查找简历"><label>搜索<input type="search" maxlength="200" data-project-search placeholder="简历名称或岗位" aria-label="搜索简历名称或岗位"></label><label>语言<select data-project-language><option value="all">全部语言</option><option value="zh">中文</option><option value="en">英文</option></select></label><label>状态<select data-project-status><option value="active">正在使用</option><option value="archived">已归档</option><option value="all">全部项目</option></select></label><span data-project-result-count role="status" aria-live="polite"></span></div><div class="project-grid" data-project-results></div><div class="empty-state" data-project-no-results hidden><h2>没有符合条件的简历</h2><p>可以调整搜索、语言或状态筛选。</p><button type="button" class="button secondary" data-project-clear-filters>清除筛选</button></div>`:`<div class="empty-state"><div class="empty-paper">${icon('file',40)}</div><h2>建立第一份属于你的简历</h2><p>资料库准备好后，选择需要展示的内容和模板，进入预览制作。</p>${button('建立简历','new-project','primary')}</div>`}`;
  function paintResults(){
    const projects=filterProjects(ctx.state.projects,filters),grid=$('[data-project-results]');if(!grid)return;
    grid.innerHTML=projects.map(projectCard).join('');grid.hidden=!projects.length;$('[data-project-no-results]').hidden=Boolean(projects.length);$('[data-project-result-count]').textContent=`显示 ${projects.length} 份`;
    $$('[data-open-project]',grid).forEach(control=>control.onclick=()=>ctx.switchProject(control.dataset.openProject).catch(error=>ctx.notify(error.message,true)));
    $$('[data-copy-project]',grid).forEach(control=>control.onclick=()=>showVersionName(ctx,control.dataset.copyProject,true));
    $$('[data-rename-project]',grid).forEach(control=>control.onclick=()=>showVersionName(ctx,control.dataset.renameProject,false));
    $$('[data-archive-project]',grid).forEach(control=>control.onclick=()=>changeArchive(ctx,control.dataset.archiveProject,true));
    $$('[data-restore-project]',grid).forEach(control=>control.onclick=()=>changeArchive(ctx,control.dataset.restoreProject,false));
    $$('[data-delete-project]',grid).forEach(control=>control.onclick=()=>showDeleteProject(ctx,control.dataset.deleteProject));
  }
  if(all.length){
    const search=$('[data-project-search]'),language=$('[data-project-language]'),status=$('[data-project-status]');search.value=filters.query;language.value=filters.language;status.value=filters.status;
    search.oninput=()=>{filters.query=search.value;paintResults();};language.onchange=()=>{filters.language=language.value;paintResults();};status.onchange=()=>{filters.status=status.value;paintResults();};
    $('[data-project-clear-filters]').onclick=()=>{Object.assign(filters,{query:'',language:'all',status:'active'});search.value='';language.value='all';status.value='active';paintResults();search.focus();};paintResults();
  }
  const pending=loadWizardDraft(ctx);if(pending){const row=document.createElement('div');row.className='wizard-recommendation';const label=document.createElement('span');label.textContent='未完成的建立简历草稿：'+(pending.jobTitle||pending.projectName||'通用简历');const resume=document.createElement('button');resume.type='button';resume.className='button secondary';resume.textContent='继续填写';resume.dataset.resumeWizard='';resume.onclick=()=>ctx.resumeWizard?.().catch(error=>ctx.notify(error.message,true));row.append(label,resume);$('#screen').prepend(row);}
  $('[data-action="new-project"]')?.addEventListener('click',()=>ctx.startWizard({isNew:true}));
}
