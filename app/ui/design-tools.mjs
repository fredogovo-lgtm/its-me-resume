import {createCanvasGroup,ungroupCanvasSelection,preserveCanvasOtherLayout,canvasGroupFor,canvasSelectionIds,templateDecorationSettings,setTemplateDecoration,editTemplateSidebar} from '../core/canvas-groups.mjs';
import {makeDesignMaterial,transformDesignSelection} from '../core/design-tools.mjs';
import {freezeMeasuredLayout} from './language-layout.mjs';
import {preparePhotoFile} from './photo.mjs';

import {placeNewBlockInViewport} from './material-placement.mjs';
import {escape} from './helpers.mjs';
const actions=[['align-left','左对齐'],['align-center','水平居中'],['align-right','右对齐'],['align-top','顶端对齐'],['align-middle','垂直居中'],['align-bottom','底端对齐'],['distribute-x','水平等距'],['distribute-y','垂直等距'],['bring-front','置于顶层'],['send-back','置于底层']];
export function mountDesignTools(ctx,host,{materials=false}={}) {
  if(!host||!ctx.project)return;
  const project=ctx.project,lang=project.language,visible=project.blocks.filter(block=>!block.hiddenLanguages?.includes(lang));
  const existing=new Set(visible.map(b=>b.id));ctx.ui.designSelectionIds=(ctx.ui.designSelectionIds||[]).filter(id=>existing.has(id));
  const panel=document.createElement('section');panel.className='design-tools';
  panel.innerHTML=(materials?'<div class="design-material-options"><label class="button secondary">添加图片<input data-design-image type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" hidden></label><p class="panel-help">图片仅在本机缩小保存，JPG / PNG，最多10MB。完整作品集仍可作为附件。</p><div class="design-shape-options">'+[['round','圆角色块'],['ellipse','圆形'],['diamond','菱形']].map(([key,label])=>'<button type="button" class="button quiet" data-design-shape="'+key+'">'+label+'</button>').join('')+'</div></div>':'')+'<details class="design-arrangement" '+(materials||ctx.ui.designArrangementOpen?'open':'')+'><summary>分组、对齐与图层</summary><p class="panel-help">勾选同页模块成组后，文字和装饰可一起拖动；分组仅作用于当前语言。勾选同页模块进行对齐；从模板排版对齐时，会保留当前画面进入自由摆放。每次操作可一次撤销。</p><div class="design-select-list">'+visible.map(b=>'<label><input type="checkbox" data-design-select="'+escape(b.id)+'" '+(ctx.ui.designSelectionIds.includes(b.id)?'checked':'')+' '+(b.locked?'disabled':'')+'><span>'+escape(b[lang]?.title||(b.image?'图片素材':b.kind==='line'?'装饰线':'装饰'))+'</span></label>').join('')+'</div><div class="design-selected-count" aria-live="polite"></div><p class="panel-help" data-design-group-status></p><div class="button-group"><button type="button" class="button secondary" data-design-group>组合</button><button type="button" class="button quiet" data-design-ungroup>解除分组</button></div><div class="design-align-actions">'+actions.map(([key,label])=>'<button type="button" class="button quiet" data-design-align="'+key+'">'+label+'</button>').join('')+'</div><button type="button" class="button quiet" data-design-clear>清除多选</button></details>';
  host.append(panel);
  panel.querySelector('.design-arrangement').ontoggle=event=>{if(event.target.isConnected)ctx.ui.designArrangementOpen=event.target.open;};
  const highlight=()=>{const ids=new Set(ctx.ui.designSelectionIds);document.querySelectorAll('#resume-pages [data-block-id]').forEach(el=>el.classList.toggle('design-multiselected',ids.has(el.dataset.blockId)));panel.querySelector('.design-selected-count').textContent='已选 '+ids.size+' 个模块';const count=project.canvasGroupsByLanguage?.[lang]?.length||0;panel.querySelector('[data-design-group-status]').textContent=count?'本语言已有 '+count+' 个分组；拖动任意成员可移动整组。':'未分组；可将装饰与对应文字勾选组合。';};
  panel.querySelectorAll('[data-design-select]').forEach(control=>control.onchange=()=>{ctx.ui.designSelectionIds=[...panel.querySelectorAll('[data-design-select]:checked')].map(c=>c.dataset.designSelect);highlight();});
  panel.querySelector('[data-design-group]').onclick=()=>{try{const ids=[...ctx.ui.designSelectionIds];ctx.updateProject(next=>{preserveCanvasOtherLayout(next);freezeMeasuredLayout(next,ctx.layoutResult.positions);Object.assign(next,createCanvasGroup(next,ids));});ctx.notify('已组合，拖动任意成员可移动整组；调整尺寸仍作用于选中成员。');}catch(error){ctx.notify(error.message,true);}};
  panel.querySelector('[data-design-ungroup]').onclick=()=>{const ids=[...ctx.ui.designSelectionIds];if(!ids.some(id=>canvasGroupFor(ctx.project,id)))return ctx.notify('请勾选需要解除的分组成员。');ctx.updateProject(next=>Object.assign(next,ungroupCanvasSelection(next,ids)));};
  panel.querySelector('[data-design-clear]').onclick=()=>{ctx.ui.designSelectionIds=[];panel.querySelectorAll('[data-design-select]').forEach(c=>c.checked=false);highlight();};
  panel.querySelectorAll('[data-design-align]').forEach(control=>control.onclick=()=>{
    try{const ids=[...ctx.ui.designSelectionIds],action=control.dataset.designAlign;
      if(!ids.length)throw new Error('请先勾选需要操作的模块。');
      ctx.updateProject(next=>{
        if(!['bring-front','send-back'].includes(action)&&next.mode==='flow'){
          preserveCanvasOtherLayout(next);freezeMeasuredLayout(next,ctx.layoutResult.positions);
        }
        Object.assign(next,transformDesignSelection(next,ids,action));
      });
    }catch(error){ctx.notify(error.message,true);}
  });
  const insert=block=>{if(ctx.project.id!==project.id||ctx.project.language!==lang)throw new Error('当前简历已切换，请在目标简历重新添加。');if(project.blocks.length>=500)throw new Error('当前简历模块已达上限，请先精简。');const placement=placeNewBlockInViewport(ctx,block);ctx.updateProject(next=>{preserveCanvasOtherLayout(next);freezeMeasuredLayout(next,ctx.layoutResult.positions);next.blocks.push(block);});placement.afterRender();};
  panel.querySelectorAll('[data-design-shape]').forEach(control=>control.onclick=()=>{try{insert(makeDesignMaterial({variant:control.dataset.designShape,language:lang}));}catch(error){ctx.notify(error.message,true);}});
  const file=panel.querySelector('[data-design-image]');if(file)file.onchange=async()=>{const source=file.files[0];if(!source)return;file.disabled=true;try{const image=await preparePhotoFile(source);insert(makeDesignMaterial({image,language:lang}));ctx.notify('图片已加入当前简历，可拖动边框调整尺寸');}catch(error){ctx.notify(error.message,true);}finally{file.disabled=false;file.value='';}};
  requestAnimationFrame(highlight);
}
export function mountTemplateDecorations(ctx,host){
 if(!host||!ctx.project)return;const project=ctx.project,settings=templateDecorationSettings(project),panel=document.createElement('details');panel.className='inspector-section template-decoration-controls';panel.dataset.templateDecorations='';panel.open=Boolean(ctx.ui.templateDecorationsOpen);
 panel.innerHTML='<summary>模板装饰</summary><p class="panel-help">仅调整当前语言。侧栏色带可转为普通装饰，随后在纸面选中改颜色、位置、尺寸或删除。</p><label class="check-row"><input type="checkbox" data-template-section-rules '+(settings.sectionRules?'checked':'')+'>显示章节分隔线</label><label class="check-row"><input type="checkbox" data-template-profile-rule '+(settings.profileRule?'checked':'')+'>显示姓名区分隔线</label>'+(project.template==='sidebar'?'<label class="field"><span>侧栏色带</span><select data-template-sidebar-mode><option value="auto" '+(settings.sidebarMode==='auto'?'selected':'')+'>默认色带（替换自定义色带）</option><option value="hidden" '+(settings.sidebarMode==='hidden'?'selected':'')+'>不显示（移除自定义色带）</option>'+(settings.sidebarMode==='custom'?'<option value="custom" selected>已转为可编辑装饰</option>':'')+'</select></label><button type="button" class="button quiet" data-template-edit-sidebar '+(settings.sidebarMode==='custom'?'disabled':'')+'>将色带转为可编辑装饰</button>':'');
 host.append(panel);panel.ontoggle=()=>{ctx.ui.templateDecorationsOpen=panel.open;};
 for(const [selector,key]of [['[data-template-section-rules]','sectionRules'],['[data-template-profile-rule]','profileRule']])panel.querySelector(selector).onchange=event=>{const value=event.target.checked;ctx.updateProject(next=>Object.assign(next,setTemplateDecoration(next,key,value)));};
 const mode=panel.querySelector('[data-template-sidebar-mode]');if(mode)mode.onchange=()=>{const value=mode.value;if(value==='custom')return;ctx.updateProject(next=>Object.assign(next,setTemplateDecoration(next,'sidebarMode',value)));};
 const edit=panel.querySelector('[data-template-edit-sidebar]');if(edit)edit.onclick=()=>{try{const positions=ctx.layoutResult.positions,pages=ctx.layoutResult.pages;ctx.updateProject(next=>{preserveCanvasOtherLayout(next);freezeMeasuredLayout(next,positions);Object.assign(next,editTemplateSidebar(next,pages));});ctx.ui.selectedBlockId=ctx.project.blocks.find(block=>block.templateDecoration==='sidebar'&&!block.hiddenLanguages?.includes(ctx.project.language))?.id;ctx.render();ctx.notify('侧栏色带已成为可编辑装饰。');}catch(error){ctx.notify(error.message,true);}};
}
