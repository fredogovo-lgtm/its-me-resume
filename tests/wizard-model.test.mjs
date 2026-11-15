import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validateProject } from '../app/core/model.mjs';
import { createWizardDraft, initializeSelection, recommendSelection, createWizardProject, updateWizardProject, personFields } from '../app/ui/wizard-model.mjs';

const text = (title, body = '') => ({ title, subtitle: '', body });
const entry = (id, category, title, tags = []) => ({ id, category, period: '2024—2026', tags, zh: text(title), en: text(title), stale: { zh: false, en: false } });
function library() {
  return { person: { zh: { name: '姓名', headline: '我的简介', city: '北京' }, en: { name: 'Name', headline: 'My headline', city: 'Beijing' }, email: 'name@example.invalid', phone: '100000', website: 'https://example.invalid' }, entries: [entry('data', 'work', '数据分析', ['SQL']), entry('art', 'project', '绘画作品', ['绘画']), entry('school', 'education', '大学')], attachments: [{ id: 'portfolio', name: '作品集.pdf', storedFile: '11111111-1111-4111-8111-111111111111.pdf', size: 10, addedAt: '2026-11-06T00:00:00.000Z', mime: 'application/pdf' }, { id: 'other-file', name: '其他.pdf', storedFile: '22222222-2222-4222-8222-222222222222.pdf', size: 20, addedAt: '2026-11-06T00:00:00.000Z', mime: 'application/pdf' }] };
}

test('skipping role defaults to all available library information and preserves later manual choices', () => {
  const source = library();
  const draft = initializeSelection(source, createWizardDraft(source));
  assert.deepEqual(draft.entryIds, ['data', 'art', 'school']);
  assert.deepEqual(draft.personFields, personFields);
  assert.deepEqual(draft.attachmentIds, []);
  assert.equal(draft.projectName, '我的简历');
  draft.entryIds = ['art'];
  draft.personFields = ['name'];
  draft.jobTitle = '数据分析师';
  assert.deepEqual(initializeSelection(source, draft).entryIds, ['art']);
  assert.deepEqual(initializeSelection(source, draft).personFields, ['name']);
});

test('local role recommendations expand presets and expose actual keyword reasons', () => {
  const source = library();
  const preset = recommendSelection(source, { jobPreset: 'data', jobTitle: '数据分析师', jobDescription: '' });
  assert.deepEqual(preset.entryIds, ['data']);
  assert.ok(preset.ranking[0].reasons.some(reason => /SQL|数据/iu.test(reason)));
  const freeform = recommendSelection(source, { jobTitle: '美术', jobDescription: '绘画' });
  assert.deepEqual(freeform.entryIds, ['art']);
  assert.deepEqual(recommendSelection(source, { jobTitle: '护士', jobDescription: '临床护理' }).entryIds, []);
  const draft = createWizardDraft(source);
  draft.jobTitle = '美术'; draft.jobDescription = '绘画';
  const initialized = initializeSelection(source, draft);
  assert.deepEqual(initialized.entryIds, ['art']);
  assert.equal(initialized.projectName, '美术简历');
});

test('only checked personal fields, entries and attachments enter either language of a new project', () => {
  const source = library();
  const draft = { ...initializeSelection(source, createWizardDraft(source)), entryIds: ['art'], personFields: ['name', 'email'], attachmentIds: ['portfolio'], template: 'sidebar', language: 'en' };
  const project = createWizardProject(source, draft);
  assert.deepEqual(project.blocks.filter(block => block.kind === 'entry').map(block => block.sourceId), ['art']);
  assert.deepEqual(project.personFields, ['name', 'email']);
  const profile = project.blocks.find(block => block.kind === 'profile');
  assert.equal(profile.zh.title, '姓名'); assert.equal(profile.en.title, 'Name');
  assert.equal(profile.zh.subtitle, ''); assert.equal(profile.en.subtitle, '');
  assert.equal(profile.zh.body, source.person.email); assert.equal(profile.en.body, source.person.email);
  assert.deepEqual(project.attachments.map(item => item.id), ['portfolio']);
  project.attachments[0].name = '局部附件名.pdf';
  assert.equal(source.attachments[0].name, '作品集.pdf');
  assert.equal(project.template, 'sidebar'); assert.equal(project.language, 'en');
  assert.equal(validateProject(project), true);
});

test('clearing all basic field choices omits the profile entirely, including blank template', () => {
  const source = library();
  const project = createWizardProject(source, { ...createWizardDraft(source), personFields: [], entryIds: [], attachmentIds: [], template: 'blank' });
  assert.deepEqual(project.personFields, []); assert.deepEqual(project.blocks, []); assert.deepEqual(project.attachments, []);
  assert.equal(validateProject(project), true);
});

test('editing restores selections and preserves customized selected blocks, layout and profile', () => {
  const source = library();
  const original = createWizardProject(source, { ...initializeSelection(source, createWizardDraft(source)), personFields: ['name', 'email'], entryIds: ['data', 'art'], attachmentIds: ['portfolio'] });
  original.blocks[0].zh.title = '自定义姓名';
  const data = original.blocks.find(block => block.sourceId === 'data');
  data.zh.body = '当前简历独有文字'; data.width = 111; data.fontSize = 17; data.color = '#112233';
  const draft = createWizardDraft(source, { project: original });
  assert.deepEqual(draft.personFields, ['name', 'email']); assert.deepEqual(draft.attachmentIds, ['portfolio']);
  draft.entryIds = ['data', 'school']; draft.attachmentIds = []; draft.template = 'sidebar'; draft.language = 'en';
  const updated = updateWizardProject(original, source, draft);
  assert.equal(updated.id, original.id); assert.equal(updated.blocks[0].zh.title, '自定义姓名');
  assert.deepEqual(updated.blocks.filter(block => block.kind === 'entry' && !block.hiddenLanguages?.includes('en')).map(block => block.sourceId), ['data', 'school']);
  assert.deepEqual(updated.blocks.find(block => block.sourceId === 'data'), data);
  assert.deepEqual(updated.attachments, []); assert.equal(updated.template, 'sidebar'); assert.equal(updated.language, 'en');
  updated.blocks.find(block => block.sourceId === 'school').zh.title = '局部新文字';
  assert.equal(source.entries[2].zh.title, '大学');
  assert.equal(original.blocks.find(block => block.sourceId === 'art').zh.title, '绘画作品');
  assert.equal(validateProject(updated), true);
});

test('changing basic choices rebuilds only selected fields and keeps profile style identity', () => {
  const source = library();
  const original = createWizardProject(source, { ...initializeSelection(source, createWizardDraft(source)), entryIds: [] });
  const profile = original.blocks[0]; profile.color = '#123456'; profile.x = 42;
  const draft = createWizardDraft(source, { project: original }); draft.personFields = ['email'];
  const updated = updateWizardProject(original, source, draft);
  assert.equal(updated.blocks.find(block=>!block.hiddenLanguages?.includes('en')).id,profile.id);assert.notEqual(updated.blocks[0].id,profile.id); assert.equal(updated.blocks[0].x, 42); assert.equal(updated.blocks[0].color, '#123456');
  assert.equal(updated.blocks[0].zh.title, ''); assert.equal(updated.blocks[0].zh.subtitle, ''); assert.equal(updated.blocks[0].zh.body, source.person.email);
  draft.personFields = [];
  const cleared=updateWizardProject(updated,source,draft);assert.equal(cleared.blocks.filter(block=>!block.hiddenLanguages?.includes('zh')).length,0);assert.equal(cleared.blocks.filter(block=>!block.hiddenLanguages?.includes('en')).length,1);
});

test('editing keeps checked snapshots that were removed from the library and removes unchecked snapshots', () => {
  const source = library();
  const original = createWizardProject(source, { ...initializeSelection(source, createWizardDraft(source)), entryIds: ['data'], attachmentIds: ['portfolio'] });
  const reduced = { ...source, entries: [], attachments: [] };
  const draft = createWizardDraft(reduced, { project: original });
  assert.deepEqual(draft.entryIds, ['data']); assert.deepEqual(draft.attachmentIds, ['portfolio']);
  const kept = updateWizardProject(original, reduced, draft);
  assert.equal(kept.blocks.find(block => block.sourceId === 'data').zh.title, '数据分析');
  assert.equal(kept.attachments[0].id, 'portfolio');
  draft.entryIds = []; draft.attachmentIds = [];
  const removed = updateWizardProject(original, reduced, draft);
  assert.equal(removed.blocks.filter(block => block.kind === 'entry' && !block.hiddenLanguages?.includes(removed.language)).length, 0); assert.deepEqual(removed.attachments, []);
});

test('legacy project restores all known profile fields without rewriting custom text', () => {
  const source = library();
  const original = createProject(source); original.blocks[0].zh.body = '旧版自定义正文';
  const draft = createWizardDraft(source, { project: original });
  assert.deepEqual(draft.personFields, personFields);
  assert.equal(updateWizardProject(original, source, draft).blocks[0].zh.body, '旧版自定义正文');
});

test('changing contact choices preserves still-selected custom name and headline in both languages', () => {
  const source = library();
  const original = createWizardProject(source, initializeSelection(source, createWizardDraft(source)));
  original.blocks[0].zh.title = '定制姓名'; original.blocks[0].zh.subtitle = '定制求职简介';
  original.blocks[0].en.title = 'Custom Name'; original.blocks[0].en.subtitle = 'Custom headline';
  const draft = createWizardDraft(source, { project: original }); draft.personFields = draft.personFields.filter(key => key !== 'website');
  const updated = updateWizardProject(original, source, draft);
  assert.equal(updated.blocks[0].zh.title, '定制姓名'); assert.equal(updated.blocks[0].zh.subtitle, '定制求职简介');
  assert.equal(updated.blocks[0].en.title, 'Custom Name'); assert.equal(updated.blocks[0].en.subtitle, 'Custom headline');
  assert.ok(!updated.blocks[0].zh.body.includes(source.person.website));
  draft.personFields = draft.personFields.filter(key => key !== 'name');
  const noName = updateWizardProject(updated, source, draft);
  assert.equal(noName.blocks[0].zh.title, ''); assert.equal(noName.blocks[0].zh.subtitle, '定制求职简介');
  draft.personFields.push('name');
  assert.equal(updateWizardProject(noName, source, draft).blocks[0].zh.title, source.person.zh.name);
});

test('unchanged contact selection preserves custom contact text when another field is unchecked', () => {
  const source = library();
  const original = createWizardProject(source, initializeSelection(source, createWizardDraft(source)));
  original.blocks[0].zh.body = '我的自定义联络方式';
  const draft = createWizardDraft(source, { project: original }); draft.personFields = draft.personFields.filter(key => key !== 'name');
  const updated = updateWizardProject(original, source, draft);
  assert.equal(updated.blocks[0].zh.body, '我的自定义联络方式');
  assert.equal(updated.blocks[0].zh.title, '');
});

test('custom contact text requires explicit comparison confirmation before changing contact choices', () => {
  const source = library();
  const original = createWizardProject(source, initializeSelection(source, createWizardDraft(source)));
  original.blocks[0].zh.title = '定制姓名';
  original.blocks[0].zh.body = '定制联系正文，网址 ' + source.person.website;
  const draft = createWizardDraft(source, { project: original }); draft.personFields = draft.personFields.filter(key => key !== 'website');
  assert.throws(() => updateWizardProject(original, source, draft), error => {
    assert.equal(error.code, 'PROFILE_SELECTION_CONFLICT'); assert.equal(error.conflicts.length, 1);
    assert.equal(error.conflicts[0].language, 'zh'); assert.equal(error.conflicts[0].currentBody, original.blocks[0].zh.body);
    assert.ok(!error.conflicts[0].nextBody.includes(source.person.website)); return true;
  });
  assert.ok(original.blocks[0].zh.body.includes(source.person.website));
  const updated = updateWizardProject(original, source, draft, { profileBodyResolution: { [original.blocks[0].id + ':zh']: 'replace' } });
  assert.equal(updated.blocks[0].zh.title, '定制姓名'); assert.ok(!updated.blocks[0].zh.body.includes(source.person.website));
  assert.equal(updated.profileSource.zh.body, updated.blocks[0].zh.body);
});

test('legacy profile contact edits also require confirmation while unchanged generated body can be rebuilt', () => {
  const source = library(); const original = createProject(source);
  const draft = createWizardDraft(source, { project: original }); draft.personFields = ['name', 'email'];
  assert.equal(updateWizardProject(original, source, draft).blocks[0].zh.body, source.person.email);
  original.blocks[0].en.body = 'Legacy custom contact text';
  const isolated=updateWizardProject(original,source,draft);assert.equal(isolated.blocks.find(block=>!block.hiddenLanguages?.includes('en')).en.body,'Legacy custom contact text');
});

test('wizard language changes save the current layout and restore the target before template change', () => {
  const source = library(); const original = createWizardProject(source, initializeSelection(source, createWizardDraft(source)));
  original.mode = 'free'; const block = original.blocks[0]; block.x = 22; block.width = 123; block.fixedHeight = true;
  const enPosition = { x: 55, y: 66, width: 133, height: 44, page: 1, fontSize: 14, fixedHeight: false };
  original.layoutByLanguage = { en: { mode: 'free', positions: { [block.id]: enPosition } } };
  const draft = createWizardDraft(source, { project: original }); draft.language = 'en'; draft.template = 'sidebar';
  const updated = updateWizardProject(original, source, draft);
  assert.equal(updated.language, 'en'); assert.equal(updated.mode, 'flow');
  assert.equal(updated.blocks[0].x, 55); assert.equal(updated.blocks[0].fixedHeight, false);
  assert.equal(updated.layoutByLanguage.zh.positions[block.id].x, 22); assert.equal(updated.layoutByLanguage.zh.positions[block.id].width, 123);
  assert.equal(updated.layoutByLanguage.zh.positions[block.id].fixedHeight, true); assert.equal(updated.layoutByLanguage.zh.mode, 'free');
  assert.equal(original.blocks[0].x, 22);
});

test('shared language helper roundtrips fixed frames and treats older missing fixedHeight as false', async () => {
  const { applyLanguageLayout } = await import('../app/ui/language-layout.mjs');
  const project = createProject(library()); project.mode = 'free'; const block = project.blocks[0]; block.x = 23; block.fixedHeight = true;
  project.layoutByLanguage = { en: { mode: 'flow', positions: { [block.id]: { x: 70, y: 40, width: 120, height: 30, page: 0, fontSize: 12 } } } };
  assert.equal(applyLanguageLayout(project, 'en'), project); assert.equal(project.language, 'en'); assert.equal(project.mode, 'flow'); assert.equal(block.x, 70); assert.equal(block.fixedHeight, false);
  applyLanguageLayout(project, 'zh'); assert.equal(project.mode, 'free'); assert.equal(block.x, 23); assert.equal(block.fixedHeight, true);
  const serialized = JSON.stringify(project); applyLanguageLayout(project, 'zh'); assert.equal(JSON.stringify(project), serialized);
});

test('unchanged unchecked name and headline do not erase directly authored profile text', () => {
  const source = library();
  const original = createWizardProject(source, { ...initializeSelection(source, createWizardDraft(source)), personFields: ['email'] });
  original.blocks[0].zh.title = '联络方式'; original.blocks[0].zh.subtitle = '本次申请专用';
  const draft = createWizardDraft(source, { project: original }); draft.projectName = '仅重命名';
  const updated = updateWizardProject(original, source, draft);
  assert.equal(updated.blocks[0].zh.title, '联络方式'); assert.equal(updated.blocks[0].zh.subtitle, '本次申请专用');
  assert.deepEqual(updated.personFields, ['email']);
});

test('all copied profile blocks follow field selection while retaining their local selected text and style', () => {
  const source = library();
  const original = createWizardProject(source, { ...initializeSelection(source, createWizardDraft(source)), personFields: ['name', 'headline', 'phone', 'email'] });
  const copied = structuredClone(original.blocks[0]); copied.id = 'copied-profile'; copied.zh.title = '副本定制姓名'; copied.en.subtitle = 'Copied custom headline'; copied.color = '#445566';
  original.blocks.push(copied);
  const draft = createWizardDraft(source, { project: original }); draft.personFields = ['name', 'headline'];
  const updated = updateWizardProject(original, source, draft);
  const profiles = updated.blocks.filter(block => block.kind === 'profile' && !block.hiddenLanguages?.includes('zh'));
  assert.equal(profiles.length, 2); assert.ok(profiles.every(profile => profile.zh.body === ''));assert.ok(updated.blocks.filter(block=>block.kind==='profile'&&!block.hiddenLanguages?.includes('en')).every(profile=>profile.en.body===original.blocks[0].en.body));
  assert.equal(profiles[1].zh.title, '副本定制姓名'); assert.equal(profiles[1].en.subtitle, 'Copied custom headline'); assert.equal(profiles[1].color, '#445566');
});

test('custom contact conflict is attached to its specific copied profile and needs that exact approval', () => {
  const source = library();
  const original = createWizardProject(source, { ...initializeSelection(source, createWizardDraft(source)), personFields: ['name', 'phone', 'email'] });
  const copied = structuredClone(original.blocks[0]); copied.id = 'copied-profile'; copied.zh.title = '副本标题'; copied.zh.body = '副本自定义联系 ' + source.person.phone;
  original.blocks.push(copied);
  const draft = createWizardDraft(source, { project: original }); draft.personFields = ['name'];
  assert.throws(() => updateWizardProject(original, source, draft), error => { assert.equal(error.code, 'PROFILE_SELECTION_CONFLICT'); assert.equal(error.conflicts.length, 1); assert.equal(error.conflicts[0].blockId, copied.id); assert.equal(error.conflicts[0].currentBody, copied.zh.body); return true; });
  assert.throws(() => updateWizardProject(original, source, draft, { profileBodyResolution: { [original.blocks[0].id + ':zh']: 'replace' } }), error => error.code === 'PROFILE_SELECTION_CONFLICT');
  const updated = updateWizardProject(original, source, draft, { profileBodyResolution: { [copied.id + ':zh']: 'replace' } });
  assert.ok(updated.blocks.filter(block => block.kind === 'profile'&&!block.hiddenLanguages?.includes('zh')).every(profile => profile.zh.body === ''));
  assert.equal(updated.blocks.find(block => block.id === copied.id).zh.title, '副本标题');
});

for (const language of ['en', 'zh']) test(`wizard restores an explicitly reselected deleted ${language} frame without replacing the other language continuation`, async () => {
  const { splitBlock } = await import('../app/core/split-block.mjs');
  const source = library();
  source.entries[0].zh.body = '中文首段中文续稿'; source.entries[0].en.body = 'English first English continuation';
  source.entries[0].richText = { zh: { body: [{ start: 0, end: 3, style: { fontWeight: 700 } }] }, en: { body: [{ start: 0, end: 7, style: { color: '#ff0000' } }] } };
  const other = language === 'en' ? 'zh' : 'en';
  const original = createWizardProject(source, { ...initializeSelection(source, createWizardDraft(source)), entryIds: ['data'] });
  const entryBlock = original.blocks.find(block => block.sourceId === 'data');
  const pieces = splitBlock(entryBlock, other, [{ start: 0, end: 3 }, { start: 3, end: entryBlock[other].body.length }], { idFactory: () => `only-${other}-continuation` });
  const continuation = pieces[1]; continuation[other].body += ' local';
  original.blocks = [...original.blocks.filter(block => block.id !== entryBlock.id), continuation]; original.language = language;
  const before = structuredClone(original), libraryBefore = structuredClone(source);
  const draft = createWizardDraft(source, { project: original });
  assert.equal(draft.entryIds.includes('data'),false);draft.entryIds.push('data');
  const updated = updateWizardProject(original, source, draft);
  const restored = updated.blocks.filter(block => block.sourceId === 'data' && !block.hiddenLanguages?.includes(language));
  assert.equal(restored.length, 1);
  assert.equal(restored[0][language].body, source.entries[0][language].body);
  assert.deepEqual(restored[0][other], { title: '', subtitle: '', body: '' });
  assert.deepEqual(restored[0].hiddenLanguages, [other]);
  assert.equal(restored[0].richText[other], undefined);
  assert.deepEqual(restored[0].richText[language], source.entries[0].richText[language]);
  assert.deepEqual(updated.blocks.find(block => block.id === continuation.id), continuation);
  assert.deepEqual(original, before); assert.deepEqual(source, libraryBefore);
  assert.equal(validateProject(updated), true);
  const again = updateWizardProject(updated, source, createWizardDraft(source, { project: updated }));
  assert.deepEqual(again.blocks, updated.blocks);
});

test('wizard explicitly rejects restoring a current language whose library source and original frame were removed', async () => {
  const { splitBlock } = await import('../app/core/split-block.mjs');
  const source = library(); source.entries[0].zh.body = '中文首段中文续稿'; source.entries[0].en.body = 'English complete';
  const original = createWizardProject(source, { ...initializeSelection(source, createWizardDraft(source)), entryIds: ['data'] });
  const entryBlock = original.blocks.find(block => block.sourceId === 'data');
  const pieces = splitBlock(entryBlock, 'zh', [{ start: 0, end: 3 }, { start: 3, end: entryBlock.zh.body.length }], { idFactory: () => 'only-chinese' });
  original.blocks = [...original.blocks.filter(block => block.id !== entryBlock.id), pieces[1]]; original.language = 'en';
  const reduced = { ...source, entries: [] }, before = structuredClone(original);
  const draft = createWizardDraft(reduced, { project: original });draft.entryIds=['data'];
  assert.throws(() => updateWizardProject(original, reduced, draft), error => error.code === 'ENTRY_LANGUAGE_SOURCE_MISSING' && /资料库|原文/u.test(error.message) && /重新|补充|取消/u.test(error.message));
  assert.deepEqual(original, before);
  draft.entryIds = [];
  const removed = updateWizardProject(original, reduced, draft);
  assert.equal(removed.blocks.filter(block => block.kind === 'entry' && !block.hiddenLanguages?.includes(removed.language)).length, 0);
});

for (const language of ['en', 'zh']) test(`wizard restores an explicitly reselected deleted ${language} profile without replacing the other language continuation`, async () => {
  const { splitBlock } = await import('../app/core/split-block.mjs');
  const source = library(), other = language === 'en' ? 'zh' : 'en';
  const original = createWizardProject(source, { ...initializeSelection(source, createWizardDraft(source)), entryIds: [] });
  const expected = structuredClone(original.blocks[0][language]);
  const profile = original.blocks[0];
  profile[other].body = other === 'zh' ? '中文长简介首段中文长简介续稿' : 'A long first profile paragraph and a customized continuation';
  profile.richText = { [other]: { body: [{ start: 2, end: 7, style: { fontWeight: 700, color: '#123456' } }] } };
  const pieces = splitBlock(profile, other, [{ start: 0, end: 4 }, { start: 4, end: profile[other].body.length }], { idFactory: () => `profile-only-${other}` });
  original.blocks = [pieces[1]]; original.language = language;
  const before = structuredClone(original), libraryBefore = structuredClone(source), continuation = structuredClone(pieces[1]);
  const draft = createWizardDraft(source, { project: original });
  assert.deepEqual(draft.personFields, []);draft.personFields=[...personFields];
  const updated = updateWizardProject(original, source, draft);
  const restored = updated.blocks.filter(block => block.kind === 'profile' && !block.hiddenLanguages?.includes(language));
  assert.equal(restored.length, 1);
  assert.deepEqual(restored[0][language], expected);
  assert.deepEqual(restored[0][other], { title: '', subtitle: '', body: '' });
  assert.deepEqual(restored[0].hiddenLanguages, [other]);
  assert.deepEqual(updated.blocks.find(block => block.id === continuation.id), continuation);
  assert.deepEqual(original, before); assert.deepEqual(source, libraryBefore);
  assert.equal(validateProject(updated), true);
  const again = updateWizardProject(updated, source, createWizardDraft(source, { project: updated }));
  assert.deepEqual(again.blocks, updated.blocks);
});

test('restored profile snapshots the current library text while retaining the other language source', async () => {
  const { splitBlock } = await import('../app/core/split-block.mjs');
  const source = library();
  const original = createWizardProject(source, { ...initializeSelection(source, createWizardDraft(source)), entryIds: [] });
  const first = original.blocks[0]; first.zh.body = '中文长简介首段中文长简介续稿';
  const pieces = splitBlock(first, 'zh', [{ start: 0, end: 4 }, { start: 4, end: first.zh.body.length }], { idFactory: () => 'profile-zh-remains' });
  original.blocks = [pieces[1]]; original.language = 'en';
  const oldChineseSource = original.profileSource.zh.body;
  source.person.email = 'new-email@example.invalid';
  const draft=createWizardDraft(source,{project:original});draft.personFields=[...personFields];
  const updated = updateWizardProject(original, source, draft);
  const restored = updated.blocks.find(block => !block.hiddenLanguages?.includes('en'));
  assert.equal(updated.profileSource.en.body, restored.en.body);
  assert.ok(restored.en.body.includes('new-email@example.invalid'));
  assert.equal(updated.profileSource.zh.body, oldChineseSource);
});
