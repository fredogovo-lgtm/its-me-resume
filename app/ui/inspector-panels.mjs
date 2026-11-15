const textPanels = [
  { key: 'content', label: '文字内容' },
  { key: 'style', label: '模块样式' },
  { key: 'geometry', label: '位置与尺寸', unit: 'mm' }
];

/**
 * Organize the existing inspector after its forms and handlers are initialized.
 * Moving the actual section nodes keeps form ownership, bubbling and listeners.
 * Independent disclosure groups let content and geometry stay open together.
 */
export function organizeInspector(ctx, block) {
  const root = document.querySelector('#inspector-content');
  if (!root) return;
  const decoration = block && ['line', 'shape', 'photo'].includes(block.kind);
  const context = block?.kind==='photo'?'photo':block ? decoration ? 'decoration' : 'text' : 'page';
  const contexts = (ctx.ui.inspectorPanels ||= {});
  const preferences = (contexts[context] ||= {});
  const defaults = { content: context === 'text' || context === 'photo', style: context === 'decoration', geometry: false, page: context === 'page' };

  function wrap(section, specification) {
    if (!section || section.parentElement?.matches('details.inspector-panel')) return;
    const { key, label, unit } = specification;
    const details = document.createElement('details');
    details.className = 'inspector-panel';
    details.dataset.inspectorPanel = key;
    details.id = `inspector-panel-${key}`;
    details.open = Object.hasOwn(preferences, key) ? preferences[key] : defaults[key];
    const summary = document.createElement('summary');
    summary.className = 'inspector-panel-summary';
    const title = document.createElement('span');
    title.textContent = label;
    summary.append(title);
    if (unit) {
      const suffix = document.createElement('small');
      suffix.textContent = unit;
      summary.append(suffix);
    }
    details.append(summary);
    section.before(details);
    details.append(section);
    // The disclosure title replaces only the duplicated heading, not controls.
    const heading = Array.from(section.children).find(child => child.tagName === 'H3');
    if (heading) heading.hidden = true;
    details.addEventListener('toggle', () => { preferences[key] = details.open; });
  }

  const blockForm = root.querySelector('#block-form');
  if (blockForm && !blockForm.querySelector(':scope > details.inspector-panel')) {
    const sections = Array.from(blockForm.children).filter(child => child.classList.contains('inspector-section'));
    textPanels.forEach((panel, index) => wrap(sections[index], context==='photo'&&panel.key==='content'?{...panel,label:'照片与取景'}:panel));
  }
  const pageForm = root.querySelector('#page-form');
  const pageSection = pageForm && Array.from(pageForm.children).find(child => child.classList.contains('inspector-section'));
  wrap(pageSection, { key: 'page', label: '纸张与页面' });
}