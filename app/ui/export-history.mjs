export function exportDisplayInfo(record) {
  const language = record.language || record.editable?.language || 'unknown';
  const paper = record.paper || record.editable?.paper;
  return {
    language, languageLabel: { zh: '中文', en: 'English' }[language] || '语言未记录',
    paperKey: paper?.name || 'unknown',
    paperLabel: paper ? (paper.name === 'custom' ? '自定义' : paper.name) + ' · ' + paper.width + ' × ' + paper.height + ' mm' : '纸张未记录',
    pageLabel: record.pageCount ? record.pageCount + ' 页' : '页数未记录',
  };
}
