import {escape,input,textarea,field,categories,$,$$} from './helpers.mjs';
import {experienceFieldDefinitions,getExperience,entryDisplay,entryTags,filterExperienceEntries,materializeExperience} from '../core/library-experience.mjs';
import {getPeriod} from '../core/entry-content.mjs';
export function experienceFilterHtml(entries,state={}) {
  return '<div class="experience-filters"><label class="experience-search">搜索资料<input type="search" data-experience-filter="query" maxlength="300" value="'+escape(state.query||'')+'" placeholder="标题、正文、公司、标签"></label><label>分类<select data-experience-filter="category"><option value="">全部分类</option>'+Object.entries(categories).map(([key,label])=>'<option value="'+key+'" '+(state.category===key?'selected':'')+'>'+label+'</option>').join('')+'</select></label><label>标签<select data-experience-filter="tag"><option value="">全部标签</option>'+entryTags(entries).map(tag=>'<option value="'+escape(tag)+'" '+(state.tag===tag?'selected':'')+'>'+escape(tag)+'</option>').join('')+'</select></label><label>时间排序<select data-experience-filter="sort">'+[['default','原有顺序'],['newest','最近在前'],['oldest','较早在前']].map(([key,label])=>'<option value="'+key+'" '+((state.sort||'default')===key?'selected':'')+'>'+label+'</option>').join('')+'</select></label><p class="experience-filter-status" aria-live="polite" data-experience-count></p></div>';
}
// Hiding and moving existing nodes preserves checked controls and the open editor.
export function bindExperienceFilters(root,entries,state,language,{onUpdate}={}) {
  const apply=()=>{
    const rows=filterExperienceEntries(entries,state,language),ids=new Set(rows.map(row=>row.id)),container=$('[data-experience-list]',root);
    const nodes=new Map($$('[data-experience-id]',root).map(node=>[node.dataset.experienceId,node]));
    for(const [id,node] of nodes) node.hidden=!ids.has(id);
    for(const row of rows) if(nodes.has(row.id)) container.append(nodes.get(row.id));
    const count=$('[data-experience-count]',root);if(count)count.textContent='显示 '+rows.length+' / '+entries.length+' 段经历；筛选不会取消勾选或修改右侧资料。';
    const empty=$('[data-experience-empty]',root);if(empty)empty.hidden=rows.length>0;
    onUpdate?.(rows);return rows;
  };
  for(const control of $$('[data-experience-filter]',root)) {
    const update=event=>{event.stopPropagation();state[control.dataset.experienceFilter]=control.value;apply();};
    control.addEventListener('input',update);control.addEventListener('change',update);
    control.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();}});
  }
  apply();return apply;
}
export function libraryExperienceRows(entries,selected,language) {
  return entries.map(entry=>{const display=entryDisplay(entry,language);return '<button class="library-row experience-item '+(selected===entry.id?'selected':'')+'" data-entry="'+escape(entry.id)+'" data-experience-id="'+escape(entry.id)+'"><span class="item-symbol">◇</span><span><strong>'+escape(display.title)+'</strong><small>'+escape([categories[entry.category]||categories.other,entry[language]?.subtitle,getPeriod(entry,language)].filter(Boolean).join(' · '))+'</small>'+(display.missingFields.length?'<small class="experience-source-note">待补'+(language==='en'?'英文':'中文')+'：'+display.missingFields.map(key=>({title:'标题',subtitle:'补充说明',body:'正文'})[key]).join('、')+'</small>':'')+'</span></button>';}).join('');
}
function currentPreviewParts(entry, project, language) {
  const visible = block => !block.hiddenLanguages?.includes(language);
  if (!project || !entry.sourceId) return visible(entry) ? [entry] : [];
  const parts = project.blocks.filter(block => block.kind === 'entry' && block.sourceId === entry.sourceId && visible(block));
  const layout = project.language === language ? null : project.layoutByLanguage?.[language];
  if ((layout?.mode || project.mode) !== 'free') return parts;
  const frame = block => layout?.positions?.[block.id] || block;
  // On a free canvas the printed reading order follows paper, then top/left.
  return parts.map((block, index) => ({block, index})).sort((a,b) => {
    const left = frame(a.block), right = frame(b.block);
    return left.page-right.page || left.y-right.y || left.x-right.x || a.index-b.index;
  }).map(item => item.block);
}
export function experiencePreviewHtml(entry,language,{savedOnly=false,project=null}={}) {
  const parts = savedOnly ? currentPreviewParts(entry,project,language) : [materializeExperience(entry)];
  const other=language==='zh'?'en':'zh',status=entryDisplay(entry,language);
  const actual=parts.map((part,index)=>{
    const current=part[language]||{},text=[current.title,current.subtitle,getPeriod(part,language),current.body].filter(Boolean).join('\n');
    const label=parts.length>1?'<strong class="experience-preview-part">第'+(index+1)+'/'+parts.length+'段</strong>':'';
    return label+'<pre>'+escape(text||'当前语言尚未填写正文。')+'</pre>';
  }).join('') || '<pre>当前语言尚未填写正文。</pre>';
  const source=status.missingFields.length && !entry.hiddenLanguages?.includes(other) ? [entry[other]?.title,entry[other]?.subtitle,entry[other]?.body].filter(Boolean).join('\n'):'';
  return '<details class="experience-preview"><summary>展开'+(savedOnly?'当前简历副本（共'+parts.length+'段）':'资料原文')+'</summary>'+actual+(source?'<strong>'+(other==='zh'?'中文':'英文')+'来源参考（不会代替当前语言导出）</strong><pre>'+escape(source)+'</pre>':'')+'</details>';
}

export function experienceFieldsHtml(entry,library,language) {
  const values=getExperience(entry,language),selected=new Set(entry.attachmentIds||[]),groups=new Map();
  for(const item of library.entries.filter(item=>item.category==='work')) {const id=item.companyGroupId||item.id;if(!groups.has(id)){const company=getExperience(item,language).companyGroup||item[language]?.subtitle||'',title=entryDisplay(item,language).title,count=library.entries.filter(row=>row.category==='work'&&(row.companyGroupId||row.id)===id).length;groups.set(id,[company,title].filter(Boolean).join(' · ')+(count>1?'（'+count+'个阶段）':''));}}
  if(entry.companyGroupId && !groups.has(entry.companyGroupId))groups.set(entry.companyGroupId,'已保存的公司关联');
  const groupSelect='<div class="experience-field-group span-2" data-experience-category="work">'+field('与同一公司的任职阶段关联（可选）','<select name="companyGroupId"><option value="">不关联公司</option>'+[...groups].map(([id,label])=>'<option value="'+escape(id)+'" '+(entry.companyGroupId===id?'selected':'')+'>'+escape(label)+'</option>').join('')+'</select>')+'<p class="panel-help">同一公司的不同岗位可选同一个关联项；各阶段仍分别勾选，不自动加入其他岗位。</p></div>';
  const fields=experienceFieldDefinitions.map(def=>'<div class="experience-field-group '+(['careerBreak','courses'].includes(def.key)?'span-2':'')+'" data-experience-category="'+def.category+'">'+field(def.label,['careerBreak','courses'].includes(def.key)?textarea(def.key,values[def.key]||'',3,'maxlength="'+def.max+'" placeholder="'+escape(def.placeholder)+'"'):input(def.key,values[def.key]||'','maxlength="'+def.max+'" placeholder="'+escape(def.placeholder)+'"'))+'</div>').join('');
  const files=(library.attachments||[]).map(file=>'<label><input type="checkbox" name="linkedAttachment" value="'+escape(file.id)+'" '+(selected.has(file.id)?'checked':'')+'> '+escape(file.name)+'</label>').join('');
  const missing=[...selected].filter(id=>!(library.attachments||[]).some(file=>file.id===id)).map(id=>'<label><input type="checkbox" name="linkedAttachment" value="'+escape(id)+'" checked> 已不在当前资料库的附件（保留关联）</label>').join('');
  return '<details class="experience-fields"><summary>按分类补充资料（全部可选）</summary><p class="panel-help">仅当前语言保存与生成；切换分类会保留已填字段，生成时只使用当前分类字段。</p><div class="form-grid">'+groupSelect+fields+'<label class="experience-checkbox experience-field-group span-2" data-experience-category="work"><input type="checkbox" name="showCompanyTenure" '+(values.showCompanyTenure?'checked':'')+'>在此任职阶段展示手填的公司总任期</label><div class="experience-field-group span-2" data-experience-category="project"><strong>关联补充文件（可选）</strong><p class="panel-help">关联只用于选材提醒，不会自动勾选、删除或强制携带文件。</p><div class="experience-attachment-links">'+(files+missing||'尚无补充文件，可在左侧添加。')+'</div></div></div></details>';
}
export function updateExperienceCategory(form) {
  if(!form?.querySelectorAll||!form?.querySelector)return;
  const category=form.elements.category?.value;
  for(const group of $$('[data-experience-category]',form))group.hidden=group.dataset.experienceCategory!=='all'&&group.dataset.experienceCategory!==category;
  const subtitle=$('[name="subtitle"]',form),period=$('[name="period"]',form);
  if(subtitle)subtitle.placeholder=({work:'公司名称',project:'项目角色 / 所属机构',education:'学校 / 学位 / 专业',certificate:'证书类别 / 补充说明',skills:'技能方向',other:'可选补充说明'})[category]||'可选补充说明';
  if(period)period.placeholder=({certificate:'取得时间（有效期可在下方单独填写）',education:'入学—毕业；预计毕业可在下方填写'})[category]||'例如：2022.07 — 至今';
}
