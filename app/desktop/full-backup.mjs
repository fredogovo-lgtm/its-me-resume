import path from 'node:path';
import { constants as fsConstants, lstatSync, realpathSync, openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { lstat, realpath, open, readdir, mkdir, rename, unlink } from 'node:fs/promises';
import { createState, validateState } from '../core/model.mjs';
import { validateAttachmentMetadata } from '../core/attachments.mjs';
import { LIBRARY_LICENSE_FILE, validateLibraryLicenseRecord } from './library-license.mjs';

const MiB = 1024 * 1024;
export const FULL_BACKUP_LIMITS = Object.freeze({
  archiveBytes: 256 * MiB, expandedBytes: 384 * MiB, totalBytes: 256 * MiB,
  stateBytes: 32 * MiB, fileBytes: 100 * MiB, files: 12002,
});
const FORMAT = 'its-me-full-backup';
const LEGACY_MANAGED = ['attachments', 'exports', 'state.json'];
const MANAGED = ['attachments', 'exports', LIBRARY_LICENSE_FILE, 'state.json'];
const LIBRARY_LICENSE_BYTES = 65536;
const JOURNAL = '.full-backup-transaction.json';
const STATE_KEYS = ['schemaVersion', 'library', 'projects', 'activeProjectId', 'backups', 'exports', 'personalTemplates'];
const COUNT_KEYS = ['libraryEntries', 'libraryVersions', 'projects', 'templates', 'attachments', 'pdfs', 'snapshots'];
const SHA256 = /^[a-f0-9]{64}$/u;
const FILE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z]+$/u;
const hash = value => createHash('sha256').update(value).digest('hex');
const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
const sortPaths = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
const problem = (message, options) => new Error('完整备份：' + message, options);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function exact(value, keys) {
  if (!plain(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw problem('清单字段无效。');
}
function positiveLimits(input = {}) {
  const result = { ...FULL_BACKUP_LIMITS, ...input };
  for (const key of Object.keys(result)) if (!Object.hasOwn(FULL_BACKUP_LIMITS, key) || !Number.isSafeInteger(result[key]) || result[key] < 1 || result[key] > FULL_BACKUP_LIMITS[key]) throw problem('备份限额无效。');
  return Object.freeze(result);
}
function safePath(value) {
  if (typeof value !== 'string' || value.length > 220 || /[\\:\x00-\x1f\x7f]/u.test(value) || value.includes('..')) return false;
  if (value === 'state.json' || value === LIBRARY_LICENSE_FILE) return true;
  const [directory, name, extra] = value.split('/');
  if (extra !== undefined || !name || /[. ]$/u.test(name) || /[*?"<>|]/u.test(name) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) return false;
  return directory === 'attachments' ? FILE_UUID.test(name) : directory === 'exports' && name.length <= 180 && /\.pdf$/iu.test(name);
}
function assertState(state) {
  validateState(state);
  if (Object.keys(state).some(key => !STATE_KEYS.includes(key))) throw problem('资料含不支持的顶层字段，未备份或替换。');
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (/^(?:key|token|secret|password|credentials|drafts?|session|api[-_]?key|access[-_]?token|refresh[-_]?token|authorization|ai[-_]?credentials|session[-_]?(?:key|drafts?)|ai[-_]?drafts?)$/iu.test(key)) throw problem('资料中含凭据或会话草稿字段，未备份或替换。');
      visit(item);
    }
  };
  visit(state);
}
function references(state) {
  const metadata = [
    ...(state.library.attachments ?? []), ...state.projects.flatMap(item => item.attachments ?? []),
    ...state.backups.flatMap(item => item.library.attachments ?? []),
    ...state.exports.flatMap(item => [...(item.attachments ?? []), ...(item.editable?.attachments ?? [])]),
  ];
  const attachments = new Map();
  for (const item of metadata) {
    validateAttachmentMetadata(item);
    const relative = 'attachments/' + item.storedFile;
    const previous = attachments.get(relative);
    if (previous && (previous.size !== item.size || (previous.sha256 && item.sha256 && previous.sha256 !== item.sha256))) throw problem('同一附件的引用不一致。');
    attachments.set(relative, { ...item, sha256: item.sha256 ?? previous?.sha256 });
  }
  const pdfs = new Set(state.exports.map(item => 'exports/' + item.pdfFile));
  const required = new Set(['state.json', ...attachments.keys(), ...pdfs]);
  if ([...required].some(value => !safePath(value))) throw problem('资料引用了不安全的文件路径。');
  return { attachments, pdfs, required };
}
function countsFor(state, refs = references(state)) {
  return {
    libraryEntries: state.library.entries.length, libraryVersions: state.backups.length,
    projects: state.projects.length, templates: state.personalTemplates?.length ?? 0,
    attachments: refs.attachments.size, pdfs: refs.pdfs.size,
    snapshots: state.exports.filter(item => item.editable !== null).length,
  };
}
function validatePdf(bytes) {
  if (bytes.length < 16 || !/^%PDF-(?:1\.[0-7]|2\.0)$/u.test(bytes.subarray(0, 8).toString('ascii')) || !/%%EOF[\x00\t\n\f\r ]*$/u.test(bytes.subarray(Math.max(0, bytes.length - 1024)).toString('latin1'))) throw problem('归档 PDF 不完整。');
}
function validateLibraryLicenseBytes(bytes) {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.length > LIBRARY_LICENSE_BYTES) throw Error('size');
    return validateLibraryLicenseRecord(JSON.parse(Buffer.from(bytes).toString('utf8')));
  } catch { throw problem('资料库身份或授权记录损坏，原文件已保留。'); }
}
function validateContent(state, files, { freeEdition = false } = {}) {
  const refs = references(state);
  if (files.has(LIBRARY_LICENSE_FILE)) { if (!freeEdition) validateLibraryLicenseBytes(files.get(LIBRARY_LICENSE_FILE)); refs.required.add(LIBRARY_LICENSE_FILE); }
  if (files.size !== refs.required.size || [...refs.required].some(relative => !files.has(relative))) throw problem('清单与资料引用不符，存在缺失或多余文件。');
  for (const [relative, metadata] of refs.attachments) {
    const bytes = files.get(relative);
    if (bytes.length !== metadata.size || (metadata.sha256 !== undefined && hash(bytes) !== metadata.sha256)) throw problem('附件大小或哈希与资料引用不符。');
  }
  for (const relative of refs.pdfs) validatePdf(files.get(relative));
  return countsFor(state, refs);
}
function checkBytes(files, limits) {
  if (!files.size || files.size > limits.files) throw problem('文件数量超过上限。');
  let total = 0;
  for (const [relative, bytes] of files) {
    const maximum = relative === 'state.json' ? limits.stateBytes : relative === LIBRARY_LICENSE_FILE ? LIBRARY_LICENSE_BYTES : limits.fileBytes;
    if (!safePath(relative) || bytes.length > maximum) throw problem('文件路径或单文件大小超过上限。');
    total += bytes.length;
    if (total > limits.totalBytes) throw problem('备份内容总量超过256MB上限。');
  }
  return total;
}
function encodeSnapshot(snapshot, limits) {
  const totalBytes = checkBytes(snapshot.files, limits);
  const counts = validateContent(snapshot.state, snapshot.files);
  const files = [...snapshot.files].map(([relative, bytes]) => ({ path: relative, size: bytes.length, sha256: hash(bytes) })).sort(sortPaths);
  const manifest = { createdAt: new Date().toISOString(), files, totalBytes, counts };
  const payload = { format: FORMAT, version: snapshot.files.has(LIBRARY_LICENSE_FILE) ? 2 : 1, manifest, manifestSha256: hash(JSON.stringify(manifest)), files: files.map(item => ({ path: item.path, data: snapshot.files.get(item.path).toString('base64') })) };
  const serialized = Buffer.from(JSON.stringify(payload));
  if (serialized.length > limits.expandedBytes) throw problem('备份解压后内容超过上限。');
  const bytes = gzipSync(serialized, { level: 6 });
  if (bytes.length > limits.archiveBytes) throw problem('备份包超过256MB上限。');
  return { bytes, manifest };
}

/** Strict, bounded decoder. Limits may only be lowered (also used by tests). */
export function decodeFullBackup(input, customLimits, { freeEdition = false } = {}) {
  if (typeof freeEdition !== 'boolean') throw problem('免费版选项无效。');
  const limits = positiveLimits(customLimits);
  if (!(input instanceof Uint8Array) || input.length > limits.archiveBytes || input.length < 18) throw problem('备份包大小无效或超过上限。');
  let payload;
  try { payload = JSON.parse(gunzipSync(input, { maxOutputLength: limits.expandedBytes }).toString('utf8')); }
  catch { throw problem('备份包损坏或解压后内容超过上限。'); }
  exact(payload, ['format', 'version', 'manifest', 'manifestSha256', 'files']);
  if (payload.format !== FORMAT || ![1, 2].includes(payload.version)) throw problem('备份格式或版本不支持。');
  const manifest = payload.manifest;
  exact(manifest, ['createdAt', 'files', 'totalBytes', 'counts']);
  if (typeof manifest.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(manifest.createdAt) || !Number.isFinite(Date.parse(manifest.createdAt))) throw problem('备份时间无效。');
  if (typeof payload.manifestSha256 !== 'string' || !SHA256.test(payload.manifestSha256) || hash(JSON.stringify(manifest)) !== payload.manifestSha256) throw problem('清单哈希不符。');
  exact(manifest.counts, COUNT_KEYS);
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > limits.files || !Array.isArray(payload.files) || payload.files.length !== manifest.files.length) throw problem('文件数量或清单无效。');
  if (!Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 1 || manifest.totalBytes > limits.totalBytes) throw problem('备份内容总量超过上限。');
  const files = new Map(), names = new Set();
  let total = 0, previous = '';
  for (let index = 0; index < manifest.files.length; index++) {
    const entry = manifest.files[index], data = payload.files[index];
    exact(entry, ['path', 'size', 'sha256']); exact(data, ['path', 'data']);
    const maximum = entry.path === 'state.json' ? limits.stateBytes : entry.path === LIBRARY_LICENSE_FILE ? LIBRARY_LICENSE_BYTES : limits.fileBytes;
    if (!safePath(entry.path) || entry.path <= previous || names.has(entry.path.toLowerCase()) || data.path !== entry.path) throw problem('文件路径、顺序或重复名称无效。');
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > maximum || !SHA256.test(entry.sha256)) throw problem('单文件大小或哈希无效。');
    total += entry.size;
    if (total > limits.totalBytes) throw problem('备份内容总量超过上限。');
    if (typeof data.data !== 'string' || data.data.length !== 4 * Math.ceil(entry.size / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(data.data)) throw problem('文件编码无效。');
    const bytes = Buffer.from(data.data, 'base64');
    if (bytes.length !== entry.size || bytes.toString('base64') !== data.data || hash(bytes) !== entry.sha256) throw problem('文件内容哈希不符或缺失。');
    files.set(entry.path, bytes); names.add(entry.path.toLowerCase()); previous = entry.path;
  }
  if ((payload.version === 2) !== files.has(LIBRARY_LICENSE_FILE)) throw problem('备份版本与资料库身份文件不符。');
  if (total !== manifest.totalBytes || !files.has('state.json')) throw problem('清单总量不符或缺少资料。');
  let state;
  try { state = JSON.parse(files.get('state.json').toString('utf8')); assertState(state); }
  catch { throw problem('备份内资料格式无效，未替换本机资料。'); }
  const counts = validateContent(state, files, { freeEdition });
  if (COUNT_KEYS.some(key => !Number.isSafeInteger(manifest.counts[key]) || manifest.counts[key] !== counts[key])) throw problem('清单数量与实际内容不符。');
  return { state, files, manifest, packageHash: hash(input) };
}
async function maybeStat(filePath) {
  try { return await lstat(filePath); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function directory(filePath) {
  const info = await lstat(filePath);
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(filePath), filePath)) throw problem('存储目录含链接或不是普通目录。');
  return info;
}
async function regularBytes(filePath, maximum) {
  const before = await lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximum || !samePath(await realpath(filePath), filePath)) throw problem('源文件含链接、不是普通文件或大小超过上限。');
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFile(before, opened) || before.size !== opened.size || opened.size > maximum) throw problem('源文件在读取时已改变。');
    const bytes = await handle.readFile(), after = await handle.stat(), current = await lstat(filePath);
    if (bytes.length !== opened.size || !current.isFile() || current.isSymbolicLink() || !sameFile(opened, current) || !sameFile(opened, after) || opened.size !== after.size || opened.size !== current.size || opened.mtimeMs !== current.mtimeMs || opened.ctimeMs !== current.ctimeMs || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs || !samePath(await realpath(filePath), filePath)) throw problem('源文件在读取时已改变。');
    return bytes;
  } finally { await handle?.close(); }
}
async function writeExclusive(filePath, bytes) {
  let handle, created = false;
  try {
    handle = await open(filePath, 'wx', 0o600); created = true;
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (created) await unlink(filePath).catch(() => {});
    if (error.code === 'EEXIST') throw problem('目标文件已存在，请使用新的文件名；没有覆盖原文件。');
    throw error;
  }
}
function targetPath(root, relative) {
  const result = path.join(root, ...relative.split('/'));
  if (!samePath(path.dirname(result), relative === 'state.json' || relative === LIBRARY_LICENSE_FILE ? root : path.join(root, relative.split('/')[0]))) throw problem('目标路径越界。');
  return result;
}
async function sourceSnapshot(root, limits, { allowDamagedIdentity = false, freeEdition = false } = {}) {
  const rootInfo = await maybeStat(root);
  if (rootInfo) await directory(root);
  const inventory = [];
  for (const name of freeEdition ? LEGACY_MANAGED : MANAGED) {
    const item = path.join(root, name), info = await maybeStat(item);
    if (!info) { inventory.push([name, null]); continue; }
    if (name === 'state.json' || name === LIBRARY_LICENSE_FILE) {
      if (!info.isFile() || info.isSymbolicLink()) throw problem('本机资料文件不是普通文件。');
      inventory.push([name, info.size, info.mtimeMs, info.ctimeMs, info.dev, info.ino]);
    } else {
      await directory(item);
      const children = (await readdir(item)).sort();
      if (children.length > limits.files) throw problem('本机目录文件数量超过上限。');
      inventory.push([name, 'directory']);
      for (const child of children) {
        const childPath = path.join(item, child), childInfo = await lstat(childPath);
        if (!childInfo.isFile() || childInfo.isSymbolicLink() || !samePath(await realpath(childPath), childPath)) throw problem('本机受管目录含链接或非普通文件。');
        inventory.push([name + '/' + child, childInfo.size, childInfo.mtimeMs, childInfo.ctimeMs, childInfo.dev, childInfo.ino]);
      }
    }
  }
  const hasState = Boolean(await maybeStat(path.join(root, 'state.json')));
  const hasIdentity = !freeEdition && Boolean(await maybeStat(path.join(root, LIBRARY_LICENSE_FILE)));
  if (hasIdentity && !hasState) throw problem('资料库身份存在但state.json缺失，未重建或覆盖资料。');
  const stateBytes = hasState ? await regularBytes(path.join(root, 'state.json'), limits.stateBytes) : Buffer.from(JSON.stringify(createState()) + '\n');
  let state;
  try { state = JSON.parse(stateBytes.toString('utf8')); assertState(state); }
  catch { throw problem('当前资料损坏或含不支持字段，已保留原文件；请先修复，不能直接覆盖。'); }
  const refs = references(state), files = new Map([['state.json', stateBytes]]);
  let damagedIdentity = null;
  if (hasIdentity) {
    const identityPath = path.join(root, LIBRARY_LICENSE_FILE);
    const identityBytes = await regularBytes(identityPath, LIBRARY_LICENSE_BYTES);
    try { validateLibraryLicenseBytes(identityBytes); files.set(LIBRARY_LICENSE_FILE, identityBytes); }
    catch (error) {
      if (!allowDamagedIdentity || (await lstat(identityPath)).nlink !== 1) throw error;
      // Opaque damaged bytes never enter a valid backup or confer authorization.
      damagedIdentity = identityBytes;
    }
  }
  if (refs.required.size + Number(hasIdentity) > limits.files) throw problem('文件数量超过上限。');
  let total = stateBytes.length + (files.get(LIBRARY_LICENSE_FILE)?.length ?? 0);
  for (const relative of [...refs.required].sort()) {
    if (relative === 'state.json') continue;
    const bytes = await regularBytes(targetPath(root, relative), limits.fileBytes);
    total += bytes.length;
    if (total > limits.totalBytes) throw problem('备份内容总量超过256MB上限。');
    files.set(relative, bytes);
  }
  checkBytes(files, limits); validateContent(state, files);
  const signature = hash(JSON.stringify({ inventory, files: [...files].map(([relative, bytes]) => [relative, hash(bytes)]), damagedIdentity: damagedIdentity ? hash(damagedIdentity) : null }));
  return { state, files, signature, hasState, damagedIdentity };
}
async function archivePath(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !/\.itsme-backup$/iu.test(filePath)) throw problem('请选择本地 .itsme-backup 文件。');
  const resolved = path.resolve(filePath);
  await directory(path.dirname(resolved));
  return resolved;
}

function validateRecoveryJournal(journal) {
  exact(journal, journal.version === 3 ? ['version', 'id', 'phase', 'had', 'damagedIdentity'] : ['version', 'id', 'phase', 'had']);
  const managed = journal.version === 1 ? LEGACY_MANAGED : [2, 3].includes(journal.version) ? MANAGED : null;
  if (!managed) throw problem('恢复事务版本无效，请保留原目录。');
  exact(journal.had, managed);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(journal.id) || !['pending', 'committed'].includes(journal.phase) || managed.some(name => typeof journal.had[name] !== 'boolean')) throw problem('恢复事务记录无效，请保留原目录。');
  if (journal.version === 3) {
    exact(journal.damagedIdentity, ['fileName', 'size', 'sha256']);
    const damaged = journal.damagedIdentity;
    if (!journal.had[LIBRARY_LICENSE_FILE] || !journal.had['state.json'] || !Number.isSafeInteger(damaged.size) || damaged.size < 0 || damaged.size > LIBRARY_LICENSE_BYTES || !SHA256.test(damaged.sha256) || damaged.fileName !== '.rescue-library-license-' + journal.id + '-' + damaged.sha256 + '.bin') throw problem('损坏身份救援记录无效，已停止自动回退。');
  }
  return managed;
}
function maybeStatSync(location) {
  try { return lstatSync(location); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function directorySync(location) {
  const info = lstatSync(location);
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath(realpathSync(location), location)) throw problem('恢复事务目录含链接或类型无效。');
}
function regularBytesSync(location, maximum) {
  const before = lstatSync(location);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximum || !samePath(realpathSync(location), location)) throw problem('恢复事务文件含链接、过大或类型无效。');
  let descriptor;
  try {
    descriptor = openSync(location, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor), bytes = readFileSync(descriptor), after = fstatSync(descriptor), current = lstatSync(location);
    for (const info of [opened, after, current]) if (!info.isFile() || info.isSymbolicLink() || !sameFile(before, info) || info.size !== before.size || info.mtimeMs !== before.mtimeMs || info.ctimeMs !== before.ctimeMs) throw problem('恢复事务文件在检查时改变。');
    if (bytes.length !== before.size || !samePath(realpathSync(location), location)) throw problem('恢复事务文件在检查时改变。');
    return bytes;
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}
/** Read-only bootstrap guard: only a structurally valid, usable rollback can defer state loading. */
export function hasRecoverableFullBackupSync(dataDirectory, { freeEdition = false } = {}) {
  if (typeof freeEdition !== 'boolean') throw problem('免费版选项无效。');
  const root = path.resolve(dataDirectory), journalPath = path.join(root, JOURNAL);
  if (!maybeStatSync(journalPath)) return false;
  directorySync(root);
  let journal;
  try { journal = JSON.parse(regularBytesSync(journalPath, 4096).toString('utf8')); }
  catch { throw problem('恢复事务记录损坏，请保留原目录。'); }
  const managed = validateRecoveryJournal(journal), transaction = path.join(root, '.restore-' + journal.id);
  if (journal.version === 3) {
    const saved = path.join(root, journal.damagedIdentity.fileName), info = lstatSync(saved);
    const bytes = regularBytesSync(saved, LIBRARY_LICENSE_BYTES);
    if (info.nlink !== 1 || bytes.length !== journal.damagedIdentity.size || hash(bytes) !== journal.damagedIdentity.sha256) throw problem('损坏身份原件的救援副本不符，已停止自动回退。');
    let structurallyValid = true;
    try { validateLibraryLicenseBytes(bytes); } catch { structurallyValid = false; }
    if (structurallyValid) throw problem('救援记录不能跳过有效身份的正常验证。');
  }
  for (const folder of [transaction, path.join(transaction, 'old'), path.join(transaction, 'stage'), path.join(transaction, 'rejected')]) directorySync(folder);
  const originals = new Map();
  for (const name of managed) {
    const original = path.join(transaction, 'old', name), target = path.join(root, name), staged = path.join(transaction, 'stage', name);
    for (const location of [original, target, staged]) {
      const info = maybeStatSync(location);
      if (info && (info.isSymbolicLink() || (name === 'state.json' || name === LIBRARY_LICENSE_FILE ? !info.isFile() : !info.isDirectory()) || !samePath(realpathSync(location), location))) throw problem('恢复事务路径含链接或类型无效。');
    }
    if (journal.had[name]) {
      const selected = maybeStatSync(original) ? original : maybeStatSync(target) ? target : null;
      if (!selected) throw problem('恢复事务的原文件缺失，已停止自动回退。');
      originals.set(name, selected);
    }
  }
  const statePath = journal.phase === 'committed' ? path.join(root, 'state.json') : originals.get('state.json');
  if (statePath) {
    try { assertState(JSON.parse(regularBytesSync(statePath, FULL_BACKUP_LIMITS.stateBytes).toString('utf8'))); }
    catch { throw problem('恢复事务的资料文件损坏，未跳过资料验证。'); }
  }
  const identityPath = freeEdition && !managed.includes(LIBRARY_LICENSE_FILE) ? null : journal.phase === 'committed' ? (maybeStatSync(path.join(root, LIBRARY_LICENSE_FILE)) ? path.join(root, LIBRARY_LICENSE_FILE) : null) : originals.get(LIBRARY_LICENSE_FILE);
  if (identityPath) {
    const bytes = regularBytesSync(identityPath, LIBRARY_LICENSE_BYTES);
    if (journal.version === 3 && journal.phase === 'pending') {
      if (bytes.length !== journal.damagedIdentity.size || hash(bytes) !== journal.damagedIdentity.sha256) throw problem('待回退的损坏身份原件已变化，已停止自动回退。');
    } else if (!freeEdition) validateLibraryLicenseBytes(bytes);
  }
  return journal.phase === 'pending' && Boolean(statePath);
}
/** One instance per LocalStore; its public calls must use the store write queue. */
export class FullBackupManager {
  #directory; #limits; #tokens = new Map(); #fault; #freeEdition;
  constructor(dataDirectory, options = {}) {
    this.#directory = path.resolve(dataDirectory); this.#limits = positiveLimits(options.limits);
    this.#freeEdition = options.freeEdition ?? false;
    if (typeof this.#freeEdition !== 'boolean') throw problem('免费版选项无效。');
    this.#fault = options.onRestoreStep ?? (() => {});
  }
  async #readPackage(filePath) {
    const location = await archivePath(filePath);
    const bytes = await regularBytes(location, this.#limits.archiveBytes);
    const decoded = decodeFullBackup(bytes, this.#limits, { freeEdition: this.#freeEdition });
    // Retired identity records remain authenticated by the package hash, but never
    // become live files or gate data access in the free edition.
    if (this.#freeEdition) decoded.files.delete(LIBRARY_LICENSE_FILE);
    return { ...decoded, location, bytes: bytes.length };
  }
  #summary(value) {
    const record = !this.#freeEdition && value.files?.has(LIBRARY_LICENSE_FILE) ? validateLibraryLicenseBytes(value.files.get(LIBRARY_LICENSE_FILE)) : null;
    const libraryAuthorization = record ? structuredClone({ libraryId: record.libraryId, license: record.license }) : null;
    return { counts: structuredClone(value.manifest.counts), createdAt: value.manifest.createdAt, bytes: value.bytes, fileName: path.basename(value.location), warnings: [], libraryAuthorization };
  }
  async create(filePath) {
    const location = await archivePath(filePath);
    const snapshot = await sourceSnapshot(this.#directory, this.#limits, { freeEdition: this.#freeEdition });
    const packaged = encodeSnapshot(snapshot, this.#limits);
    // Do not put an external backup into a managed file or the transaction directory.
    const relative = path.relative(this.#directory, location);
    if (relative && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) && ['attachments', 'exports'].includes(relative.split(path.sep)[0])) throw problem('不能把备份放进附件或 PDF 存储目录。');
    if ((await sourceSnapshot(this.#directory, this.#limits, { freeEdition: this.#freeEdition })).signature !== snapshot.signature) throw problem('本机资料在准备备份时已改变，请重试。');
    await writeExclusive(location, packaged.bytes);
    if (hash(await regularBytes(location, this.#limits.archiveBytes)) !== hash(packaged.bytes)) throw problem('保存后校验失败，请保留原资料并使用新文件名重试。');
    return this.#summary({ manifest: packaged.manifest, files: snapshot.files, location, bytes: packaged.bytes.length });
  }
  async inspect(filePath) {
    this.#tokens.clear();
    if (await maybeStat(path.join(this.#directory, JOURNAL))) throw problem('有尚未完成的恢复，请先重新打开资料库。');
    const incoming = await this.#readPackage(filePath);
    const current = await sourceSnapshot(this.#directory, this.#limits, { allowDamagedIdentity: true, freeEdition: this.#freeEdition });
    this.#tokens.clear();
    const token = randomUUID();
    this.#tokens.set(token, { location: incoming.location, hash: incoming.packageHash, signature: current.signature });
    return { ...this.#summary(incoming), token, currentIdentityDamaged: current.damagedIdentity !== null, warnings: current.damagedIdentity ? ['当前资料库身份记录损坏。恢复前将另存损坏原件，另建的资料救援包不含该授权；恢复后的授权以备份内实际签名验证为准。'] : [] };
  }
  async restore(filePath, token) {
    const approval = typeof token === 'string' ? this.#tokens.get(token) : null;
    this.#tokens.clear();
    if (!approval || !samePath(approval.location, path.resolve(filePath))) throw problem('请先预检并明确确认这份备份。');
    const incoming = await this.#readPackage(filePath);
    if (incoming.packageHash !== approval.hash) throw problem('备份包在预检后已改变，请重新预检。');
    const current = await sourceSnapshot(this.#directory, this.#limits, { allowDamagedIdentity: true, freeEdition: this.#freeEdition });
    if (current.signature !== approval.signature) throw problem('本机资料在预检后已改变，请重新预检。');
    await mkdir(this.#directory, { recursive: true }); await directory(this.#directory);
    if (await maybeStat(path.join(this.#directory, JOURNAL))) throw problem('有尚未完成的恢复，请先重新打开资料库。');
    const id = randomUUID(), transaction = path.join(this.#directory, '.restore-' + id);
    const stage = path.join(transaction, 'stage'), old = path.join(transaction, 'old');
    const rescueFileName = '.rescue-' + new Date().toISOString().replace(/[:.]/gu, '-') + '-' + id + '.itsme-backup';
    const rescueFile = path.join(this.#directory, rescueFileName);
    let damagedIdentity = null;
    if (current.damagedIdentity !== null) {
      const bytes = current.damagedIdentity, sha256 = hash(bytes);
      damagedIdentity = { fileName: '.rescue-library-license-' + id + '-' + sha256 + '.bin', size: bytes.length, sha256 };
      const saved = path.join(this.#directory, damagedIdentity.fileName);
      await writeExclusive(saved, bytes);
      if (hash(await regularBytes(saved, LIBRARY_LICENSE_BYTES)) !== sha256) throw problem('损坏身份原件另存校验失败，未替换原资料。');
      await this.#fault('damaged-identity-written');
    }
    await writeExclusive(rescueFile, encodeSnapshot(current, this.#limits).bytes);
    const checkedRescue = await this.#readPackage(rescueFile);
    if (checkedRescue.files.size !== current.files.size || [...current.files].some(([relative, bytes]) => !checkedRescue.files.has(relative) || hash(checkedRescue.files.get(relative)) !== hash(bytes))) throw problem('救援备份校验失败，未替换原资料。');
    // The rescue archive is durable and verified before any original file is moved.
    await this.#fault('rescue-written');
    await mkdir(transaction); await mkdir(stage); await mkdir(old); await mkdir(path.join(transaction, 'rejected'));
    await mkdir(path.join(stage, 'attachments')); await mkdir(path.join(stage, 'exports'));
    for (const [relative, bytes] of incoming.files) await writeExclusive(targetPath(stage, relative), bytes);
    await this.#fault('stage-written');
    const latest = await sourceSnapshot(this.#directory, this.#limits, { allowDamagedIdentity: true, freeEdition: this.#freeEdition });
    if (latest.signature !== approval.signature) throw problem('本机资料在准备恢复时已改变，请重新预检；救援包已保留。');
    // Re-read the chosen archive as well; no stale token after a file is replaced during preparation.
    if ((await this.#readPackage(filePath)).packageHash !== approval.hash) throw problem('备份包在准备恢复时已改变，请重新预检；救援包已保留。');
    if (damagedIdentity) {
      const saved = path.join(this.#directory, damagedIdentity.fileName), info = await lstat(saved);
      const bytes = await regularBytes(saved, LIBRARY_LICENSE_BYTES);
      if (info.nlink !== 1 || bytes.length !== damagedIdentity.size || hash(bytes) !== damagedIdentity.sha256) throw problem('损坏身份原件的救援副本已变化，未替换原资料。');
    }
    const managed = incoming.files.has(LIBRARY_LICENSE_FILE) || current.files.has(LIBRARY_LICENSE_FILE) || damagedIdentity ? MANAGED : LEGACY_MANAGED;
    const had = Object.fromEntries(await Promise.all(managed.map(async name => [name, Boolean(await maybeStat(path.join(this.#directory, name)))])));
    const journal = { version: damagedIdentity ? 3 : managed === MANAGED ? 2 : 1, id, phase: 'pending', had, ...(damagedIdentity ? { damagedIdentity } : {}) };
    await writeExclusive(path.join(this.#directory, JOURNAL), Buffer.from(JSON.stringify(journal)));
    try {
      await this.#fault('journal-written');
      if (damagedIdentity) hasRecoverableFullBackupSync(this.#directory, { freeEdition: this.#freeEdition });
      for (const name of managed) {
        if (had[name]) { await rename(path.join(this.#directory, name), path.join(old, name)); await this.#fault('old-moved:' + name); }
        if (name !== LIBRARY_LICENSE_FILE || incoming.files.has(LIBRARY_LICENSE_FILE)) { await rename(path.join(stage, name), path.join(this.#directory, name)); await this.#fault('new-installed:' + name); }
      }
      const installed = await sourceSnapshot(this.#directory, this.#limits, { freeEdition: this.#freeEdition });
      if (installed.files.size !== incoming.files.size || [...incoming.files].some(([relative, bytes]) => !installed.files.has(relative) || hash(installed.files.get(relative)) !== hash(bytes))) throw problem('恢复后资料校验失败。');
      await this.#fault('verified');
      const commitPath = path.join(transaction, 'committed.json');
      await writeExclusive(commitPath, Buffer.from(JSON.stringify({ ...journal, phase: 'committed' })));
      await rename(commitPath, path.join(this.#directory, JOURNAL));
      await unlink(path.join(this.#directory, JOURNAL)).catch(() => {});
      return { state: structuredClone(incoming.state), counts: structuredClone(incoming.manifest.counts), rescueFile, rescueFileName, rescueDataDirectory: transaction, damagedIdentityFileName: damagedIdentity?.fileName ?? null };
    } catch (error) {
      try { await this.recover(); }
      catch (rollbackError) { throw problem('恢复中断，自动回退未完成；原文件和救援包均已保留。请保留整个数据目录并重新打开软件。' , { cause: rollbackError }); }
      throw problem('恢复未完成，已回退原资料；救援包和原文件均已保留。');
    }
  }
  /** Runs before LocalStore reads; unfinished transactions roll back, never rebuild the database. */
  async recover() {
    const journalPath = path.join(this.#directory, JOURNAL);
    if (!await maybeStat(journalPath)) return false;
    await directory(this.#directory);
    const bytes = await regularBytes(journalPath, 4096);
    let journal;
    try { journal = JSON.parse(bytes.toString('utf8')); } catch { throw problem('恢复事务记录损坏，请保留原目录。'); }
    const managed = validateRecoveryJournal(journal);
    hasRecoverableFullBackupSync(this.#directory, { freeEdition: this.#freeEdition });
    const transaction = path.join(this.#directory, '.restore-' + journal.id);
    await directory(transaction); await directory(path.join(transaction, 'old')); await directory(path.join(transaction, 'stage')); await directory(path.join(transaction, 'rejected'));
    if (journal.phase === 'pending') {
      for (const name of [...managed].reverse()) {
        const original = path.join(transaction, 'old', name), target = path.join(this.#directory, name), staged = path.join(transaction, 'stage', name);
        const oldInfo = await maybeStat(original), targetInfo = await maybeStat(target), stageInfo = await maybeStat(staged);
        for (const [item, info] of [[original, oldInfo], [target, targetInfo], [staged, stageInfo]]) if (info && (info.isSymbolicLink() || (name === 'state.json' || name === LIBRARY_LICENSE_FILE ? !info.isFile() : !info.isDirectory()) || !samePath(await realpath(item), item))) throw problem('恢复事务路径含链接或类型无效，已停止回退。');
        if (oldInfo || (!journal.had[name] && !stageInfo && targetInfo)) {
          if (targetInfo) await rename(target, path.join(transaction, 'rejected', name + '-' + randomUUID()));
          if (oldInfo) await rename(original, target);
        }
      }
    }
    await unlink(journalPath);
    return true;
  }
}