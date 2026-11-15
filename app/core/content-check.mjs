const textFields = ['title', 'subtitle', 'body'];
const fieldLabels = { title: '标题', subtitle: '补充说明', body: '正文' };
const languageLabels = { zh: '中文', en: '英文' };
const content = value => typeof value === 'string' ? value.trim() : '';
const hiddenIn = (entry, language) => Array.isArray(entry?.hiddenLanguages) && entry.hiddenLanguages.includes(language);

/** Describe only actual text in the requested language; no fallback translation. */
export function entryLanguageStatus(entry, language = 'zh', { fields = textFields } = {}) {
  language = language === 'en' ? 'en' : 'zh';
  const otherLanguage = language === 'zh' ? 'en' : 'zh';
  const hidden = hiddenIn(entry, language);
  const referenceVisible = !hiddenIn(entry, otherLanguage);
  const hasContent = !hidden && fields.some(field => content(entry?.[language]?.[field]));
  const hasReference = referenceVisible && fields.some(field => content(entry?.[otherLanguage]?.[field]));
  const missingFields = hidden || !referenceVisible ? [] : fields.filter(field => !content(entry?.[language]?.[field]) && content(entry?.[otherLanguage]?.[field]));
  return { language, otherLanguage, hidden, hasContent, hasReference, empty: !hasContent, missingFields };
}

function profileFields(project) {
  if (!Array.isArray(project.personFields)) return textFields;
  const chosen = new Set(project.personFields);
  return textFields.filter(field => field === 'title' ? chosen.has('name') : field === 'subtitle' ? chosen.has('headline') : ['city', 'phone', 'email', 'website'].some(key => chosen.has(key)));
}

/**
 * Soft completeness hints only. Deliberately omitted personal information is
 * not required. A combined profile body is never parsed to infer private data.
 */
export function findProjectContentIssues(project) {
  if (!project || !Array.isArray(project.blocks)) return [];
  const language = project.language === 'en' ? 'en' : 'zh';
  const issues = [];
  for (const block of project.blocks) {
    if (!block || !['profile', 'entry', 'text'].includes(block.kind) || hiddenIn(block, language)) continue;
    const fields = block.kind === 'profile' ? profileFields(project) : textFields;
    if (!fields.length) continue;
    const status = entryLanguageStatus(block, language, { fields });
    const label = content(block[language]?.title) || (status.hasReference && content(block[status.otherLanguage]?.title)) || (block.kind === 'profile' ? '基本信息' : '文字模块');
    if (status.missingFields.length) {
      issues.push({ code: 'missing-language-content', blockId: block.id, language, fields: status.missingFields, message: `“${label.slice(0, 100)}”尚未填写${languageLabels[language]}${status.missingFields.map(field => fieldLabels[field]).join('、')}。` });
    } else if (block.kind !== 'profile' && status.empty) {
      issues.push({ code: 'empty-block', blockId: block.id, language, fields: [...textFields], message: `“${label.slice(0, 100)}”在${languageLabels[language]}版中还是空白文本框。` });
    }
  }
  return issues;
}
