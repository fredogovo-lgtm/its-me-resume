import {captureTextSelection, restoreTextSelection} from './rich-text-view.mjs';
const classNames=['workspace-left-hidden','workspace-right-hidden','workspace-focus'];
function selectedField(){const selection=window.getSelection(),node=selection?.anchorNode;return(node?.nodeType===1?node:node?.parentElement)?.closest?.('#resume-pages .resume-text');}
function panelGlyph(side){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('width','17');svg.setAttribute('height','17');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.4');svg.setAttribute('aria-hidden','true');
  const box=document.createElementNS(svg.namespaceURI,'rect');for(const [key,value]of Object.entries({x:'2',y:'3',width:'16',height:'14',rx:'2'}))box.setAttribute(key,value);
  const line=document.createElementNS(svg.namespaceURI,'path');line.setAttribute('d',side==='left'?'M7 3v14':'M13 3v14');svg.append(box,line);return svg;
}
export function mountWorkspacePanels(ctx){
  const host=document.querySelector('#workspace-panels');
  const preferences=(ctx.ui.workspacePanels ||= {leftHidden:false,rightHidden:false,focus:false});
  const events=new AbortController(),{signal}=events;
  if(!host || ctx.ui.screen!=='editor')return()=>{};
  host.classList.add('workspace-panel-controls');host.replaceChildren();host.setAttribute('role','group');host.setAttribute('aria-label','编辑工作区显示设置');
  const left=document.createElement('button'),right=document.createElement('button'),focus=document.createElement('button');
  for(const [control,key,side]of [[left,'left','left'],[right,'right','right']]){control.type='button';control.dataset.workspacePanel=key;control.className='workspace-panel-toggle';control.append(panelGlyph(side));host.append(control);}
  focus.type='button';focus.dataset.workspacePanel='focus';focus.className='workspace-focus-toggle';host.append(focus);
  function apply(){
    document.body.classList.toggle('workspace-left-hidden',preferences.focus||preferences.leftHidden);
    document.body.classList.toggle('workspace-right-hidden',preferences.focus||preferences.rightHidden);
    document.body.classList.toggle('workspace-focus',preferences.focus);
    for(const [control,key,label]of [[left,'leftHidden','资料栏'],[right,'rightHidden','设置栏']]){const action=preferences[key]?'显示':'收起';control.disabled=preferences.focus;control.title=preferences.focus?'退出专注编辑后，可调整侧栏':`${action}${label}`;control.setAttribute('aria-label',`${action}${label}`);control.setAttribute('aria-pressed',String(preferences[key]));}
    focus.textContent=preferences.focus?'退出专注':'专注';focus.title=preferences.focus?'退出专注编辑并恢复之前的侧栏':'专注编辑：收起侧栏和主导航';focus.setAttribute('aria-label',focus.title);focus.setAttribute('aria-pressed',String(preferences.focus));
  }
  host.addEventListener('pointerdown',event=>{if(event.target.closest('button'))event.preventDefault();},{signal});
  host.addEventListener('click',event=>{
    const control=event.target.closest('[data-workspace-panel]');if(!control||control.disabled)return;
    const field=selectedField(),selection=field&&captureTextSelection(field),active=document.activeElement;
    if(control.dataset.workspacePanel==='focus')preferences.focus=!preferences.focus;
    else{const key=control.dataset.workspacePanel==='left'?'leftHidden':'rightHidden';preferences[key]=!preferences[key];}
    apply();
    if(field?.isConnected&&selection)restoreTextSelection(field,selection.start,selection.end,{backward:selection.backward,focus:active===field});
    // CSS changes are observed by the editor's existing ResizeObserver. No
    // render or zoom assignment is needed; manual 100% remains manual 100%.
  },{signal});
  apply();
  return()=>{events.abort();classNames.forEach(name=>document.body.classList.remove(name));};
}
