// Shared text helpers keep new bilingual values separate from legacy JSON fields.
const LANGUAGES = ['zh', 'en'];
const forbiddenControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u;
function fail(path, message) { throw new Error(`${path}: ${message}`); }
function text(value, path, maximum) {
  if (typeof value !== 'string' || value.length > maximum || forbiddenControls.test(value)) fail(path, '文本类型、长度或控制字符无效');
}
function language(value) {
  if (!LANGUAGES.includes(value)) fail('language', '不支持的语言');
}
function plainObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, '必须为普通对象');
}

export function validatePeriodByLanguage(entry, path = 'entry') {
  plainObject(entry, path);
  if (entry.periodByLanguage === undefined) return true;
  const name = `${path}.periodByLanguage`, periods = entry.periodByLanguage;
  plainObject(periods, name);
  if (Object.getOwnPropertySymbols(periods).length) fail(name, '时间字段无效');
  for (const [key, value] of Object.entries(periods)) {
    if (!LANGUAGES.includes(key)) fail(name, '只支持中文和英文时间');
    text(value, `${name}.${key}`, 500);
  }
  return true;
}

export function getPeriod(entry, targetLanguage) {
  language(targetLanguage);
  validatePeriodByLanguage(entry);
  text(entry.period, 'entry.period', 500);
  return entry.periodByLanguage?.[targetLanguage] ?? entry.period;
}

export function setPeriod(entry, targetLanguage, value) {
  language(targetLanguage);
  text(value, 'period', 500);
  validatePeriodByLanguage(entry);
  text(entry.period, 'entry.period', 500);
  // Initialize missing versions from the old shared value before replacing one.
  // Keep entry.period intact so old backups and earlier app versions retain it.
  entry.periodByLanguage = { zh: entry.period, en: entry.period, ...entry.periodByLanguage, [targetLanguage]: value };
}

export function createEntry({ title = '', category = 'other', language: targetLanguage = 'zh' } = {}) {
  language(targetLanguage);
  text(title, 'entry.title', 2000);
  text(category, 'entry.category', 100);
  const entry = {
    id: globalThis.crypto.randomUUID(), category, period: '', tags: [],
    zh: { title: '', subtitle: '', body: '' },
    en: { title: '', subtitle: '', body: '' },
    stale: { zh: false, en: false },
  };
  entry[targetLanguage].title = title;
  return entry;
}
