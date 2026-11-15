import {getTextRuns, applyTextStyle} from '../core/rich-text.mjs';
import {appendRichText, readEditableText, captureTextSelection, restoreTextSelection} from './rich-text-view.mjs';
const mounted = new WeakMap();
const fieldNames = {title:'标题', subtitle:'补充说明', body:'正文'};
const fonts = ['Microsoft YaHei', 'SimSun', 'DengXian', 'Arial', 'Calibri', 'Georgia'];
const create = (tag, text, className) => { const element=document.createElement(tag); if(text !== undefined) element.textContent=text; if(className) element.className=className; return element; };
function fieldForNode(node) { return (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('#resume-pages .resume-text[data-field]'); }
function fieldElement(selection) {
  return [...document.querySelectorAll('#resume-pages .resume-text[data-field]')].find(element => element.dataset.field === selection.field && element.closest('[data-block-id]')?.dataset.blockId === selection.blockId);
}
export function validRichSelection(ctx, value = ctx.ui.richSelection) {
  if (!value || ctx.ui.screen !== 'editor' || value.projectId !== ctx.project?.id || value.language !== ctx.project.language || value.blockId !== ctx.ui.selectedBlockId) return null;
  const block = ctx.project.blocks.find(block => block.id === value.blockId);
  if (!block || block.locked || !fieldNames[value.field] || block[value.language]?.[value.field] !== value.textSnapshot || !Number.isInteger(value.start) || !Number.isInteger(value.end) || value.start < 0 || value.end <= value.start || value.end > value.textSnapshot.length) return null;
  return {block, selection:value};
}
function effectiveProperty(block, selection, property, fallback) {
  const runs=getTextRuns(block,selection.language,selection.field), values=[];
  let cursor=selection.start;
  for(const run of runs){ if(run.end<=selection.start || run.start>=selection.end) continue; if(run.start>cursor) values.push(fallback); values.push(run.style[property] ?? fallback); cursor=Math.max(cursor,run.end); }
  if(cursor<selection.end) values.push(fallback);
  return values;
}
export function clearSelectedFontFamily(value, runs, start, end) {
  // Validate with the same rules as every other local-style action.
  applyTextStyle(value, runs, start, end, null);
  if (start === end) return applyTextStyle(value, runs, start, end, null);
  const edges = new Set([0, value.length]);
  for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)) edges.add(part.index);
  while (!edges.has(start)) start--;
  while (!edges.has(end)) end++;
  const output = [];
  for (const run of runs) {
    const points = [...new Set([run.start, run.end, Math.max(run.start, Math.min(start, run.end)), Math.max(run.start, Math.min(end, run.end))])].sort((a,b)=>a-b);
    for (let index=0;index+1<points.length;index++) {
      const from=points[index], to=points[index+1], style={...run.style};
      if (from>=start && to<=end) delete style.fontFamily;
      if (from<to && Object.keys(style).length) output.push({start:from,end:to,style});
    }
  }
  return applyTextStyle(value, output, 0, 0, null);
}
export function mountRichTextToolbar(ctx, container) {
  mounted.get(ctx)?.();
  const events=new AbortController(), {signal}=events;
  let restoring=false;
  container.classList.add('rich-selection-toolbar');
  container.replaceChildren();
  const heading=create('div',undefined,'rich-toolbar-heading'); heading.append(create('h3','局部文字样式'),create('span','仅选中文字','tag')); container.append(heading);
  const status=create('p','双击纸面文字，选中需要设置的部分。','rich-selection-status'); status.setAttribute('aria-live','polite'); container.append(status);
  const group=create('div',undefined,'rich-format-buttons'); group.setAttribute('role','group'); group.setAttribute('aria-label','选中文字的样式');
  const makeButton=(label,key,help)=>{const button=create('button',label);button.type='button';button.dataset.richAction=key;button.title=help;button.setAttribute('aria-label',help);group.append(button);return button;};
  const bold=makeButton('B','bold','选中文字加粗'), italic=makeButton('I','italic','选中文字斜体'), underline=makeButton('U','underline','选中文字下划线'), clear=makeButton('清除','clear','清除选中文字的局部样式');
  bold.style.fontWeight='700'; italic.style.fontStyle='italic'; underline.style.textDecoration='underline'; clear.className='rich-clear'; container.append(group);
  const details=create('div',undefined,'rich-format-details');
  const addControl=(title,control)=>{const label=create('label');label.append(create('span',title),control);details.append(label);return control;};
  const font=create('select');font.dataset.richControl='fontFamily';font.setAttribute('aria-label','选中文字字体');font.append(new Option('跟随模块（仅重置字体）',''));const mixedFont=new Option('混合字体（请选择）','__mixed__');mixedFont.disabled=true;font.append(mixedFont);for(const value of [...new Set([...fonts,ctx.project?.fontFamily])].filter(Boolean))font.append(new Option(value,value));addControl('字体',font);
  const size=create('input');size.type='number';size.min='4';size.max='144';size.step='.5';size.placeholder='跟随 / 混合';size.dataset.richControl='fontSize';size.setAttribute('aria-label','选中文字字号');addControl('字号 / pt',size);
  const color=create('input');color.type='color';color.dataset.richControl='color';color.value='#26343f';color.setAttribute('aria-label','选中文字颜色');addControl('颜色',color);container.append(details);
  const ai=nodeAiButton();
  function nodeAiButton(){const b=create('button','AI 改写选区','button quiet');b.type='button';b.dataset.richAi='';container.append(b);b.addEventListener('pointerdown',event=>{capture();event.preventDefault();},{signal});b.onclick=()=>{const valid=validRichSelection(ctx);if(valid)ctx.openProjectAi?.({selection:{...valid.selection}});};return b;}
  const controls=[bold,italic,underline,clear,font,size,color,ai];
  function refresh() {
    if(!container.isConnected) { dispose(); return; }
    const value=validRichSelection(ctx);
    const currentBlock=ctx.project?.blocks.find(block=>block.id===ctx.ui.selectedBlockId);
    container.hidden=!currentBlock || ['shape','line','photo'].includes(currentBlock.kind);
    container.classList.toggle('has-rich-selection',Boolean(value));
    group.hidden=!value; details.hidden=!value; ai.hidden=!value;
    controls.forEach(control=>control.disabled=!value);
    if(!value){ status.textContent='双击纸面文字，选中需要设置的部分。';[bold,italic,underline].forEach(button=>button.setAttribute('aria-pressed','false'));return; }
    const {block,selection}=value, element=fieldElement(selection), computed=element ? getComputedStyle(element) : null;
    const length=Array.from(selection.textSnapshot.slice(selection.start,selection.end)).length;
    status.textContent=`已选${fieldNames[selection.field]}中的 ${length} 个字符`;
    const base={fontWeight:Number(computed?.fontWeight || block.fontWeight || 400),fontStyle:computed?.fontStyle || block.fontStyle || 'normal',textDecoration:block.textDecoration || computed?.textDecorationLine || 'none',fontSize:parseFloat(computed?.fontSize || '')*.75,fontFamily:block.fontFamily || ctx.project.fontFamily,color:computed?.color || block.color || '#26343f'};
    const uniform=(property,expected)=>effectiveProperty(block,selection,property,base[property]).every(value=>typeof expected==='function'?expected(value):value===expected);
    bold.setAttribute('aria-pressed',String(uniform('fontWeight',value=>Number(value)>=600)));italic.setAttribute('aria-pressed',String(uniform('fontStyle','italic')));underline.setAttribute('aria-pressed',String(uniform('textDecoration',value=>String(value).includes('underline'))));
    if(document.activeElement!==size){const values=effectiveProperty(block,selection,'fontSize',base.fontSize);size.value=values.every(value=>value===values[0])&&Number.isFinite(values[0])?String(Math.round(values[0]*10)/10):'';}
    if(document.activeElement!==font){const values=effectiveProperty(block,selection,'fontFamily','');const value=values.every(value=>value===values[0])?values[0]:'__mixed__';if(value && value!=='__mixed__' && ![...font.options].some(option=>option.value===value))font.append(new Option(value,value));font.value=value;}
    if(document.activeElement!==color){const values=effectiveProperty(block,selection,'color',base.color);if(values.every(value=>value===values[0])){
      const probe=document.createElement('span');probe.style.color=values[0];document.body.append(probe);const components=getComputedStyle(probe).color.match(/[\d.]+/g);probe.remove();
      if(components?.length>=3)color.value='#'+components.slice(0,3).map(value=>Math.round(Number(value)).toString(16).padStart(2,'0')).join('');
    }}
  }
  function capture() {
    if(restoring || !container.isConnected)return;
    const selection=window.getSelection();
    if(!selection?.rangeCount){if(!container.contains(document.activeElement)){ctx.ui.richSelection=null;refresh();}return;}
    const from=fieldForNode(selection.anchorNode),to=fieldForNode(selection.focusNode);
    if(from && from===to){const range=captureTextSelection(from,selection),blockId=from.closest('[data-block-id]')?.dataset.blockId;if(range && range.end>range.start){ctx.ui.richSelection={...range,projectId:ctx.project?.id,blockId,language:ctx.project?.language,field:from.dataset.field};refresh();return;}}
    // Moving focus to a format control may clear the DOM range; retain only the
    // identity/text-checked snapshot until another paper or external selection.
    if(container.contains(document.activeElement)) { refresh(); return; }
    ctx.ui.richSelection=null;refresh();
  }
  function apply(patch, {resetFont=false} = {}) {
    const valid=validRichSelection(ctx);
    if(!valid){ctx.ui.richSelection=null;refresh();ctx.notify('文字已变化，请重新选中需要设置的部分。');return;}
    const saved={...valid.selection};
    const currentField=fieldElement(saved);
    if(currentField && readEditableText(currentField)!==saved.textSnapshot){ctx.ui.richSelection=null;refresh();ctx.notify('文字已变化，请重新选中需要设置的部分。');return;}
    const wasEditing=Boolean(currentField?.hasAttribute('contenteditable'));
    let applied=false;
    try {
      ctx.updateProject(project=>{
        if(project.id!==saved.projectId || project.language!==saved.language)return;
        const block=project.blocks.find(block=>block.id===saved.blockId);
        if(!block || block.locked || block[saved.language]?.[saved.field]!==saved.textSnapshot)return;
        const runs=(resetFont ? clearSelectedFontFamily : applyTextStyle)(saved.textSnapshot,getTextRuns(block,saved.language,saved.field),saved.start,saved.end,patch);
        block.richText ??={};block.richText[saved.language] ??={};
        if(runs.length)block.richText[saved.language][saved.field]=runs;else delete block.richText[saved.language][saved.field];
        if(!Object.keys(block.richText[saved.language]).length)delete block.richText[saved.language];
        if(!Object.keys(block.richText).length)delete block.richText;
        applied=true;
      },{render:true,history:true});
    } catch(error) {
      // updateProject mutates a clone; validation failures leave the saved
      // project and its undo stack untouched. Keep the useful core message.
      ctx.notify(error?.message || String(error),true);
      refresh();
      return;
    }
    if(!applied)return;
    ctx.ui.richSelection=saved;
    const nextField=fieldElement(saved);
    if(nextField){
      // ctx.render is optional for isolated consumers; render only the changed
      // field as a fallback, never as a response to selectionchange.
      const block=ctx.project.blocks.find(block=>block.id===saved.blockId);appendRichText(nextField,saved.textSnapshot,getTextRuns(block,saved.language,saved.field));
      if(wasEditing){nextField.contentEditable='plaintext-only';nextField.spellcheck=false;}
      restoring=true;restoreTextSelection(nextField,saved.start,saved.end,{backward:saved.backward,focus:wasEditing});restoring=false;
    }
    refresh();
  }
  group.addEventListener('pointerdown',event=>{if(event.target.closest('button')){capture();event.preventDefault();}}, {signal});
  group.addEventListener('click',event=>{const button=event.target.closest('[data-rich-action]');if(!button || button.disabled)return;const active=button.getAttribute('aria-pressed')==='true';const patches={bold:{fontWeight:active?400:700},italic:{fontStyle:active?'normal':'italic'},underline:{textDecoration:active?'none':'underline'},clear:null};apply(patches[button.dataset.richAction]);},{signal});
  [font,size,color].forEach(control=>control.addEventListener('pointerdown',()=>{capture();},{signal}));
  font.addEventListener('change',()=>{if(font.value==='__mixed__')return;if(font.value)apply({fontFamily:font.value});else apply(null,{resetFont:true});},{signal});
  size.addEventListener('change',()=>{const value=Number(size.value);if(!Number.isFinite(value)||value<4||value>144){ctx.notify('字号需在 4–144 pt 之间。');return;}apply({fontSize:value});},{signal});
  color.addEventListener('change',()=>apply({color:color.value}),{signal});
  document.addEventListener('selectionchange',capture,{signal});
  document.addEventListener('focusin',event=>{if(!container.contains(event.target)&&!fieldForNode(event.target))capture();},{signal});
  function dispose(){events.abort();if(mounted.get(ctx)===dispose)mounted.delete(ctx);}
  mounted.set(ctx,dispose);refresh();
  return dispose;
}
