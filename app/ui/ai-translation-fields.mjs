import { aiExperienceFieldLabels } from '../core/ai-experience.mjs';
export const aiFieldLabels = Object.freeze({ title: '标题', subtitle: '补充说明', body: '正文', period: '时间', name: '姓名', headline: '职业方向', city: '城市', tags: '标签', ...aiExperienceFieldLabels });
export function translationFieldChoices(task) {
  const counts = new Map();
  for (const target of task.targets) for (const field of Object.keys(target.fields)) counts.set(field, (counts.get(field) || 0) + 1);
  return [...counts].map(([field, count]) => ({ field, label: aiFieldLabels[field] || field, count }));
}
export function renderTranslationFields(host, task, selected, onChange) {
  host.replaceChildren();
  const heading = document.createElement('strong'); heading.textContent = '选择本次发送的字段';
  const note = document.createElement('p'); note.className = 'ai-muted'; note.textContent = '只列出有源内容且允许处理的字段。已有译名参考仍会出现在发送预览中；候选需生成后逐项核对、编辑和勾选采用。';
  const list = document.createElement('div'); list.className = 'ai-translation-field-list';
  for (const { field, label, count } of translationFieldChoices(task)) {
    const row = document.createElement('label'); row.className = 'ai-checkbox';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.aiTranslationField = field; checkbox.checked = selected === null || selected.has(field);
    const name = document.createElement('span'); name.textContent = label + (count > 1 ? '（' + count + ' 个模块）' : '');
    checkbox.onchange = () => onChange(new Set([...list.querySelectorAll('[data-ai-translation-field]')].filter(input => input.checked).map(input => input.dataset.aiTranslationField)));
    row.append(checkbox, name); list.append(row);
  }
  host.append(heading, note, list);
}