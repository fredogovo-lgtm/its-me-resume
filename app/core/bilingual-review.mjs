import { getPeriod } from './entry-content.mjs';

const fields = ['title', 'subtitle', 'body'];
function checkLanguage(language) {
  if (!['zh', 'en'].includes(language)) throw new Error('资料语言无效。');
}

// Compare effective localized text, including the legacy shared time fallback.
// Shared category/tags and typography do not require a translation review.
export function hasLocalizedContentChanges(before, after, language) {
  checkLanguage(language);
  return fields.some(field => (before[language]?.[field] || '') !== (after[language]?.[field] || ''))
    || getPeriod(before, language) !== getPeriod(after, language);
}

export function updateLanguageReview(before, after, language) {
  if (!hasLocalizedContentChanges(before, after, language)) return false;
  after.stale ||= { zh: false, en: false };
  after.stale[language] = false;
  after.stale[language === 'zh' ? 'en' : 'zh'] = true;
  return true;
}

// Acknowledgment is deliberately separate from saving unchanged content.
// Mutates only the selected flag so callers retain their normal undo/save path.
export function markLanguageReviewed(entry, language) {
  checkLanguage(language);
  if (!entry.stale?.[language]) return false;
  entry.stale[language] = false;
  return true;
}
