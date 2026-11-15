import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../app/core/model.mjs';

function api(name) {
  assert.equal(typeof model[name], 'function', `${name} must be exported`);
  return model[name];
}
const text = (title = '', body = '') => ({ title, subtitle: '', body });
function entry(id = 'entry-one', changes = {}) {
  return { id, category: 'work', period: '2024—2026', tags: ['SQL', '数据分析'], zh: text('数据分析师', '使用 SQL 分析业务数据'), en: text('Data analyst', 'Analyse business data with SQL'), stale: { zh: false, en: true }, ...changes };
}
function library() {
  return { person: { zh: { name: '虚构人物', headline: '数据分析师', city: '虚构城市' }, en: { name: 'Fictional Person', headline: 'Data analyst', city: 'Fictional City' }, email: 'fictional@example.invalid', phone: '000-0000', website: '' }, entries: [entry(), entry('entry-two', { tags: ['绘画'], zh: text('绘画', '绘制插画'), en: text('Painting', 'Create illustrations') })] };
}
function frozen(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}

test('empty state starts without personal data and has independent nested objects', () => {
  const state = api('createState')();
  assert.deepEqual(state.projects, []);
  assert.deepEqual(state.exports, []);
  assert.deepEqual(state.backups, []);
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.activeProjectId, null);
  assert.deepEqual(state.library.entries, []);
  assert.equal(state.library.person.zh.name, '');
  state.library.person.zh.name = 'local';
  assert.equal(api('emptyLibrary')().person.zh.name, '');
  assert.equal(state.library.person.en.name, '');
});

test('project creation copies library contents without linking local edits back to it', () => {
  const source = frozen(library());
  const project = api('createProject')(source, { name: '岗位简历', jobTitle: '分析师', jobDescription: 'SQL', template: 'sidebar', language: 'en' });
  assert.equal(project.name, '岗位简历');
  assert.equal(project.jobTitle, '分析师');
  assert.equal(project.jobDescription, 'SQL');
  assert.equal(project.language, 'en');
  assert.equal(project.template, 'sidebar');
  assert.equal(project.mode, 'flow');
  assert.equal(project.paper.width, 210);
  assert.equal(project.paper.height, 297);
  assert.equal(project.blocks.length, 3);
  assert.equal(project.blocks[0].kind, 'profile');
  assert.equal(project.blocks[0].zh.title, '虚构人物');
  assert.equal(project.blocks[0].en.title, 'Fictional Person');
  assert.equal(project.blocks[0].zh.subtitle, '数据分析师');
  assert.equal(project.blocks[0].zh.body, '虚构城市 · 000-0000 · fictional@example.invalid');
  project.blocks[1].zh.body = '局部改写';
  project.blocks[1].tags.push('local');
  assert.equal(source.entries[0].zh.body, '使用 SQL 分析业务数据');
  assert.deepEqual(source.entries[0].tags, ['SQL', '数据分析']);
  assert.equal(api('validateProject')(project), true);
});

test('selected entries keep requested order and blank projects begin with a profile', () => {
  const create = api('createProject');
  assert.deepEqual(create(library(), { entryIds: ['entry-two', 'entry-one'] }).blocks.slice(1).map(block => block.sourceId), ['entry-two', 'entry-one']);
  assert.equal(create(library(), { entryIds: [] }).blocks.length, 1);
  assert.equal(create(library(), { template: 'blank' }).blocks.length, 1);
  assert.equal(create(library(), { template: 'blank', entryIds: ['entry-one'] }).blocks.length, 2);
  assert.throws(() => create(library(), { entryIds: ['not-found'] }));
  assert.throws(() => create(library(), { entryIds: ['entry-one', 'entry-one'] }));
});

test('entry blocks get distinct identities and independently copied bilingual content', () => {
  const source = frozen(entry());
  const first = api('makeBlock')(source);
  const second = api('makeBlock')(source);
  assert.notEqual(first.id, source.id);
  assert.notEqual(first.id, second.id);
  assert.equal(first.sourceId, source.id);
  assert.equal(first.kind, 'entry');
  assert.deepEqual(first.stale, { zh: false, en: true });
  assert.equal(first.width, 180);
  assert.equal(first.height, 20);
  assert.equal(first.page, 0);
  first.zh.title = '本地标题';
  assert.equal(source.zh.title, '数据分析师');
  assert.equal(first.en.title, 'Data analyst');
});

test('library validation preserves extensions but rejects duplicate ids and unsafe shapes', () => {
  const valid = library();
  valid.person.zh.note = '可扩展';
  valid.entries[0].custom = { source: 'manual' };
  assert.equal(api('validateLibrary')(valid), true);
  assert.equal(valid.entries[0].custom.source, 'manual');
  assert.throws(() => model.validateLibrary({ ...valid, entries: [entry(), entry()] }));
  assert.throws(() => model.validateLibrary({ ...valid, entries: new Array(2001).fill(entry()) }));
  assert.throws(() => model.validateLibrary({ ...valid, entries: [entry('bad/path')] }));
  assert.throws(() => model.validateLibrary({ ...valid, person: null }));
  assert.throws(() => model.validateLibrary({ ...valid, entries: [entry('ok', { tags: [4] })] }));
  assert.throws(() => model.validateLibrary({ ...valid, extra: NaN }));
  assert.throws(() => model.validateLibrary({ ...valid, extra: new Date() }));
});

test('project validation rejects non-finite measurements and dangerous PDF-independent data', () => {
  const project = api('createProject')(library());
  assert.equal(api('validateProject')(project), true);
  for (const changed of [
    { ...project, blocks: [{ ...project.blocks[0], x: NaN }] },
    { ...project, paper: { ...project.paper, width: Infinity } },
    { ...project, blocks: [{ ...project.blocks[0], page: -1 }] },
    { ...project, blocks: [project.blocks[0], project.blocks[0]] },
    { ...project, blocks: new Array(501).fill(project.blocks[0]) },
    { ...project, language: 'xx' },
    { ...project, accent: 'url(https://invalid)' },
    { ...project, fontFamily: 'Arial; background: red' },
    { ...project, id: '../project' }
  ]) assert.throws(() => model.validateProject(changed));
});

test('bilingual layouts retain independent measurements and validate their boundaries', () => {
  const project = api('createProject')(library());
  const id = project.blocks[0].id;
  project.layoutByLanguage = { zh: { mode: 'free', positions: { [id]: { x: 20, y: 30, width: 170, height: 25, page: 1, fontSize: 12 } } }, en: { mode: 'flow', positions: { [id]: { x: 15, y: 15, width: 180, height: 35, page: 0, fontSize: 11 } } } };
  assert.equal(api('validateProject')(project), true);
  assert.equal(project.layoutByLanguage.zh.positions[id].y, 30);
  project.layoutByLanguage.en.positions[id].height = NaN;
  assert.throws(() => model.validateProject(project));
});

test('recommendations explain matching keywords and exclude irrelevant entries', () => {
  const ranked = api('rankEntries')(library().entries, '数据分析师', '熟练使用 SQL');
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].entryId, 'entry-one');
  assert.ok(ranked[0].score > 0);
  assert.ok(ranked[0].reasons.some(reason => reason.toLowerCase().includes('sql')));
  assert.deepEqual(model.rankEntries(library().entries, '', ''), []);
  assert.deepEqual(model.rankEntries(library().entries, '护理', '临床'), []);
  assert.deepEqual(model.rankEntries(library().entries, '！！！', '，。'), []);
});

test('library backups contain pre-update snapshots, keep newest five, and do not mutate input', () => {
  const add = api('addBackup');
  let state = api('createState')();
  for (let index = 0; index < 6; index++) {
    state.library.person.zh.name = `版本${index}`;
    state = add(frozen(state), `保存${index}`);
  }
  assert.equal(state.backups.length, 5);
  assert.deepEqual(state.backups.map(backup => backup.label), ['保存5', '保存4', '保存3', '保存2', '保存1']);
  assert.equal(state.backups[0].library.person.zh.name, '版本5');
  state.library.person.zh.name = '后来编辑';
  assert.equal(state.backups[0].library.person.zh.name, '版本5');
});

test('restoring a library snapshots the current library and preserves existing projects and PDFs', () => {
  let state = api('createState')();
  state.library = library();
  state = api('addBackup')(state, '旧资料');
  const backupId = state.backups[0].id;
  state.library.person.zh.name = '当前资料';
  const project = api('createProject')(state.library);
  state.projects.push(project);
  state.activeProjectId = project.id;
  state = api('recordExport')(state, project, 'saved.pdf');
  const before = structuredClone(state);
  const restored = api('restoreLibrary')(frozen(state), backupId);
  assert.equal(restored.library.person.zh.name, '虚构人物');
  assert.equal(restored.backups[0].library.person.zh.name, '当前资料');
  assert.deepEqual(restored.projects, before.projects);
  assert.deepEqual(restored.exports, before.exports);
  assert.equal(restored.activeProjectId, project.id);
  assert.equal(state.library.person.zh.name, '当前资料');
  assert.throws(() => model.restoreLibrary(state, 'missing'));
});

test('successful exports retain all PDFs but only three newest editable snapshots globally', () => {
  let state = api('createState')();
  const project = api('createProject')(library(), { name: '岗位文档', jobTitle: '分析师', jobDescription: 'SQL' });
  for (let index = 0; index < 4; index++) state = api('recordExport')(frozen(state), project, `export-${index}.pdf`);
  assert.deepEqual(state.exports.map(item => item.pdfFile), ['export-3.pdf', 'export-2.pdf', 'export-1.pdf', 'export-0.pdf']);
  assert.deepEqual(state.exports.map(item => item.editable !== null), [true, true, true, false]);
  assert.equal(new Set(state.exports.map(item => item.id)).size, 4);
  assert.ok(state.exports.every(item => Number.isFinite(Date.parse(item.createdAt))));
  assert.equal(state.exports[0].jobDescription, 'SQL');
  project.blocks[0].zh.title = '导出后的改写';
  assert.equal(state.exports[0].editable.blocks[0].zh.title, '虚构人物');
  assert.throws(() => model.recordExport(state, project, '../escape.pdf'));
  assert.throws(() => model.recordExport(state, project, 'C:\\secret.pdf'));
  assert.throws(() => model.recordExport(state, project, 'wrong.txt'));
});

test('reopening an export creates a new project without changing the export record', () => {
  let state = api('createState')();
  const original = api('createProject')(library());
  state.projects.push(original);
  state.activeProjectId = original.id;
  state = api('recordExport')(state, original, 'original.pdf');
  const snapshot = structuredClone(state.exports[0]);
  const reopened = api('reopenExport')(frozen(state), snapshot.id);
  assert.equal(reopened.projects.length, 2);
  assert.notEqual(reopened.activeProjectId, original.id);
  const next = reopened.projects.find(project => project.id === reopened.activeProjectId);
  assert.notEqual(next.name, original.name); assert.ok(next.name.startsWith(original.name + ' · 历史 ')); assert.ok(next.name.includes(snapshot.createdAt.slice(0, 16).replace('T', ' ')));
  assert.deepEqual(next.blocks, original.blocks);
  assert.deepEqual(reopened.exports[0], snapshot);
  next.blocks[0].zh.title = '新项目';
  assert.equal(reopened.exports[0].editable.blocks[0].zh.title, '虚构人物');
  assert.throws(() => model.reopenExport(state, 'missing'));
});

test('expired editable snapshots cannot be reopened and leave the source state intact', () => {
  let state = api('createState')();
  const project = api('createProject')(library());
  for (let index = 0; index < 4; index++) state = api('recordExport')(state, project, `doc-${index}.pdf`);
  const before = structuredClone(state);
  assert.throws(() => api('reopenExport')(frozen(state), state.exports[3].id));
  assert.deepEqual(state, before);
});

test('state validation rejects broken active references, oversized history and traversal filenames', () => {
  const state = api('createState')();
  assert.equal(api('validateState')(state), true);
  assert.throws(() => model.validateState({ ...state, activeProjectId: 'missing' }));
  assert.throws(() => model.validateState({ ...state, activeProjectId: undefined }));
  assert.throws(() => model.validateState({ ...state, schemaVersion: 2 }));
  const project = api('createProject')(library());
  const exported = api('recordExport')(state, project, 'safe.pdf');
  assert.throws(() => model.validateState({ ...exported, exports: [{ ...exported.exports[0], pdfFile: '..\\escape.pdf' }] }));
  assert.throws(() => model.validateState({ ...exported, exports: [{ ...exported.exports[0], editable: null }] }));
  const cycle = api('emptyLibrary')();
  cycle.self = cycle;
  assert.throws(() => model.validateLibrary(cycle));
});
