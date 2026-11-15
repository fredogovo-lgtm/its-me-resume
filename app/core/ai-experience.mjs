// AI metadata fields share the library schema; never use a field name as a dynamic path.
import { experienceFieldDefinitions } from './library-experience.mjs';
const definitions = new Map(experienceFieldDefinitions.map(item => ['experience.' + item.key, item]));
export const aiExperienceFieldLimits = Object.freeze(Object.fromEntries([...definitions].map(([field, item]) => [field, item.max])));
export const aiExperienceFieldLabels = Object.freeze(Object.fromEntries([...definitions].map(([field, item]) => [field, item.label])));
export const isExperienceAiField = field => definitions.has(field);
export function experienceAiFields(entry) {
  return [...definitions].filter(([, item]) => item.category === 'all' || item.category === entry.category).map(([field]) => field);
}
// Read-only facts for library diagnosis/selection. Never materialize these into body.
export function createExperienceAiContext(entry, language) {
  return {category: entry.category || 'other', experience: Object.fromEntries(experienceAiFields(entry).map(field => [field, readExperienceAiField(entry, language, field)]).filter(([, value]) => value.trim()))};
}
export function readExperienceAiField(entry, language, field) {
  if (!experienceAiFields(entry).includes(field)) throw new Error('职业字段不属于本次资料分类。');
  return entry.experienceByLanguage?.[language]?.[definitions.get(field).key] || '';
}
export function setExperienceAiField(entry, language, field, value) {
  readExperienceAiField(entry, language, field);
  entry.experienceByLanguage ||= {};
  entry.experienceByLanguage[language] ||= {};
  entry.experienceByLanguage[language][definitions.get(field).key] = value;
}
const identityFields = new Set(['gpa', 'expectedGraduation', 'certificateIssuer', 'certificateNumber', 'certificateValidity', 'certificateUrl', 'companyGroup', 'companyTenure'].map(key => 'experience.' + key));
export const isExperienceIdentityField = field => identityFields.has(field);
const monthNames = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec';
const monthFirst = new RegExp('^(' + monthNames + ')\\.?\\s+(?:(\\d{1,2}),?\\s+)?(\\d{4})$', 'iu');
const dayFirst = new RegExp('^(\\d{1,2})\\s+(' + monthNames + ')\\.?\\s+(\\d{4})$', 'iu');
const yearFirst = new RegExp('^(\\d{4})\\s+(' + monthNames + ')(?:\\s+(\\d{1,2}))?$', 'iu');
const numericDate = /^(\d{4})\s*(?:年|[./-])\s*(\d{1,2})(?:\s*(?:月|[./-])\s*(\d{1,2})\s*日?)?\s*月?$/u;
const dateEvents = new RegExp('\\b(?:' + monthNames + ')\\.?\\s+(?:\\d{1,2},?\\s+)?\\d{4}\\b|\\b\\d{1,2}\\s+(?:' + monthNames + ')\\.?\\s+\\d{4}\\b|\\b\\d{4}\\s+(?:' + monthNames + ')(?:\\s+\\d{1,2})?\\b|\\d{4}\\s*(?:年|[./-])\\s*\\d{1,2}(?:\\s*(?:月|[./-])\\s*\\d{1,2}\\s*日?)?\\s*月?|至今|现在|目前|\\b(?:present|current|now|ongoing)\\b', 'giu');
function dateToken(text) {
  if (/^(?:至今|现在|目前|present|current|now|ongoing)$/iu.test(text)) return 'current';
  const monthNumber = name => ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(name.slice(0, 3).toLowerCase()) + 1;
  let year, month, day, match;
  if ((match = text.match(numericDate))) [, year, month, day] = match;
  else if ((match = text.match(monthFirst))) { year = match[3]; month = monthNumber(match[1]); day = match[2]; }
  else if ((match = text.match(dayFirst))) { year = match[3]; month = monthNumber(match[2]); day = match[1]; }
  else if ((match = text.match(yearFirst))) { year = match[1]; month = monthNumber(match[2]); day = match[3]; }
  year = Number(year); month = Number(month);
  if (!Number.isInteger(year) || year < 1000 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) return 'unparsed:' + text;
  if (day !== undefined) {
    day = Number(day); const check = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isInteger(day) || day < 1 || check.getUTCMonth() !== month - 1 || check.getUTCFullYear() !== year) return 'unparsed:' + text;
  }
  return 'date:' + year + '-' + month + (day === undefined ? '' : '-' + day);
}
function numericTokens(value, dates) {
  const numbers = text => (text.replace(/−/gu, '-').match(/[+-]?\d+(?:\.\d+)?(?:\s*[%％])?/gu) || []).map(token => { const percent = /[%％]$/u.test(token); return String(Number(token.replace(/[\s%％]/gu, ''))) + (percent ? '%' : ''); });
  if (!dates) return numbers(value); // Ordered: GPA numerator and denominator are different facts.
  const chineseMonths = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
  value = value.replace(/(?:十二|十一|[一二三四五六七八九十])月/gu, match => chineseMonths[match.slice(0, -1)] + '月');
  const tokens = []; let cursor = 0;
  for (const match of value.matchAll(dateEvents)) {
    tokens.push(...numbers(value.slice(cursor, match.index)), dateToken(match[0].trim())); cursor = match.index + match[0].length;
  }
  tokens.push(...numbers(value.slice(cursor))); return tokens;
}
export function experienceTranslationErrors(field, source, value) {
  if (!isExperienceAiField(field)) return [];
  if (['experience.certificateNumber', 'experience.certificateUrl'].includes(field)) return value === source ? [] : ['证书编号和核验链接必须与源内容完全相同；仅可复制，不能改写。'];
  const dates = ['experience.expectedGraduation', 'experience.certificateValidity', 'experience.companyTenure'].includes(field);
  const before = numericTokens(source, dates), after = numericTokens(value, dates);
  return JSON.stringify(before) === JSON.stringify(after) ? [] : ['职业字段中的数字或日期与原文不一致，请保留原值再采用。'];
}