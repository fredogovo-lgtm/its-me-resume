import test from 'node:test';
import assert from 'node:assert/strict';
import { findProjectContentIssues, entryLanguageStatus } from '../app/core/content-check.mjs';
const text = (title = '', subtitle = '', body = '') => ({ title, subtitle, body });
const block = (id, zh = text(), en = text(), kind = 'entry') => ({ id, kind, zh, en });
const project = (blocks, extras = {}) => ({ language: 'en', blocks, ...extras });

test('reports only translated fields missing from the selected language in one issue per block', () => {
  const issues = findProjectContentIssues(project([block('experience', text('产品经理', '星河科技', '完成产品迭代'), text('Product Manager'))]));
  assert.equal(issues.length, 1);
  assert.deepEqual({ ...issues[0], message: '' }, { code: 'missing-language-content', blockId: 'experience', language: 'en', fields: ['subtitle', 'body'], message: '' });
  assert.match(issues[0].message, /英文/u); assert.match(issues[0].message, /补充说明.*正文/u);
});

test('the same comparison works from English to Chinese without mutating input', () => {
  const source = project([block('custom', text(), text('Designer', '', 'Designed a portfolio'), 'text')], { language: 'zh' });
  const copy = structuredClone(source);
  const issues = findProjectContentIssues(source);
  assert.deepEqual(issues[0].fields, ['title', 'body']); assert.equal(issues[0].language, 'zh');
  assert.deepEqual(source, copy);
});

test('a title-only entry is complete when the other language also has no body', () => {
  assert.deepEqual(findProjectContentIssues(project([block('title-only', text('技能'), text('Skills'))])), []);
});

test('an empty custom or experience frame is a soft content issue even with both languages empty', () => {
  const issues = findProjectContentIssues(project([block('empty-entry'), block('empty-text', text(), text(), 'text')]));
  assert.equal(issues.length, 2); assert.ok(issues.every(issue => issue.code === 'empty-block'));
  assert.deepEqual(issues[0].fields, ['title', 'subtitle', 'body']);
});

test('decorations and frames hidden in the current language never warn', () => {
  assert.deepEqual(findProjectContentIssues(project([
    block('line', text(), text(), 'line'), block('shape', text(), text(), 'shape'),
    { ...block('zh-only', text('中文续框')), hiddenLanguages: ['en'] }
  ])), []);
});

test('a language-hidden continuation does not count as an untranslated source in the visible language', () => {
  const entry = { ...block('en-only', text('不可见的旧中文'), text('English only')), hiddenLanguages: ['zh'] };
  assert.deepEqual(findProjectContentIssues(project([entry])), []);
  assert.deepEqual(entryLanguageStatus(entry, 'en').missingFields, []);
});

test('profile checks respect selected fields and do not require unselected identity information', () => {
  const profile = block('person', text('姓名', '求职方向', 'name@example.com'), text('', '', 'name@example.com'), 'profile');
  assert.deepEqual(findProjectContentIssues(project([profile], { personFields: ['email'] })), []);
  const issues = findProjectContentIssues(project([profile], { personFields: ['name', 'email'] }));
  assert.deepEqual(issues[0].fields, ['title']);
  assert.deepEqual(findProjectContentIssues(project([profile], { personFields: [] })), []);
});

test('selected profile contacts compare the combined body without guessing individual private fields', () => {
  const profile = block('person', text('姓名', '', '北京'), text(), 'profile');
  assert.deepEqual(findProjectContentIssues(project([profile], { personFields: ['city'] }))[0].fields, ['body']);
  profile.en.body = 'name@example.com';
  assert.deepEqual(findProjectContentIssues(project([profile], { personFields: ['city', 'email'] })), []);
});

test('legacy profile checks only actual alternate-language content and never demands fields absent in both', () => {
  const profile = block('legacy', text('', '', 'name@example.com'), text('', '', 'name@example.com'), 'profile');
  assert.deepEqual(findProjectContentIssues(project([profile])), []);
  profile.zh.title = '姓名';
  assert.deepEqual(findProjectContentIssues(project([profile]))[0].fields, ['title']);
  assert.deepEqual(findProjectContentIssues(project([block('empty-person', text(), text(), 'profile')])), []);
});

test('language status identifies a reference title explicitly and handles whitespace-only input', () => {
  const status = entryLanguageStatus(block('reference', text('中文标题', '', '中文正文'), text('  ', '', '\n')), 'en');
  assert.equal(status.language, 'en'); assert.equal(status.otherLanguage, 'zh');
  assert.equal(status.hasContent, false); assert.equal(status.hasReference, true); assert.equal(status.empty, true);
  assert.deepEqual(status.missingFields, ['title', 'body']);
});

test('local custom content counts as present even when stale flags request bilingual review', () => {
  const entry = { ...block('local', text('标题', '', '旧内容'), text('Custom title', '', 'Updated content')), stale: { en: true, zh: false } };
  assert.deepEqual(findProjectContentIssues(project([entry])), []);
});

test('safe empty project inputs and fully translated frames produce no issues', () => {
  assert.deepEqual(findProjectContentIssues(null), []);
  assert.deepEqual(findProjectContentIssues({ language: 'en' }), []);
  assert.deepEqual(findProjectContentIssues(project([block('full', text('标题', '说明', '正文'), text('Title', 'Subtitle', 'Body'))])), []);
});
