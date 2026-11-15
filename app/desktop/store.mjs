import path from 'node:path';
import { FullBackupManager } from './full-backup.mjs';
import { constants as fsConstants, existsSync } from 'node:fs';
import { attachmentExtension, validateAttachmentMetadata, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, ATTACHMENT_MIME } from '../core/attachments.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, open, rename, unlink, lstat, realpath, rm } from 'node:fs/promises';
import {
  createState,
  validateState,
  validateLibrary,
  validateProject,
  addBackup,
  restoreLibrary,
  recordExport,
  reopenExport as reopenHistoricalExport,
} from '../core/model.mjs';

const clone = value => structuredClone(value);
const attachmentHash = bytes => createHash('sha256').update(bytes).digest('hex');
const sameFile = (left, right) => left.dev === right.dev && left.ino === right.ino;
function attachmentProblem(metadata, detail, cause) {
  return new Error(`附件“${metadata.name}”${detail}。请重新导入正确文件作为新附件。`, cause ? { cause } : undefined);
}
const safePdfName = value => typeof value === 'string'
  && value.length > 4 && value.length <= 200
  && !/[\\/:\x00-\x1f\x7f]/.test(value)
  && !value.includes('..') && value.endsWith('.pdf');

function copyPdf(value) {
  if (!(value instanceof Uint8Array)) throw new Error('PDF 必须是二进制内容。');
  const bytes = Buffer.from(value);
  const header = bytes.subarray(0, 8).toString('ascii');
  const tail = bytes.subarray(Math.max(0, bytes.length - 1024)).toString('latin1');
  if (bytes.length < 16 || !/^%PDF-(?:1\.[0-7]|2\.0)$/.test(header)
      || !/%%EOF[\x00\t\n\f\r ]*$/.test(tail)) {
    throw new Error('PDF 内容不完整或格式无效，未记录本次导出。');
  }
  return bytes;
}

/** Preserve pre-rename local data unless a new ITS ME database already exists. */
export function resolveDataDirectory(appDataDirectory, override) {
  if (override !== undefined) {
    if (typeof override !== 'string' || !override.trim()) throw new Error('本地数据目录参数无效。');
    return path.resolve(override);
  }
  const current = path.join(appDataDirectory, 'ITS ME', 'data');
  const legacy = path.join(appDataDirectory, '履历工坊', 'data');
  if (existsSync(path.join(current, 'state.json'))) return current;
  return existsSync(path.join(legacy, 'state.json')) ? legacy : current;
}

/** Owns one local database. Main-process callers must share this instance. */
export class LocalStore {
  #directory;
  #stateFile;
  #exportsDirectory;
  #attachmentsDirectory;
  #state = null;
  #fullBackup;
  #queue = Promise.resolve();

  constructor(directory, { freeEdition = false } = {}) {
    if (typeof directory !== 'string' || !directory.trim()) {
      throw new Error('本地数据目录无效。');
    }
    this.#directory = path.resolve(directory);
    this.#stateFile = path.join(this.#directory, 'state.json');
    this.#exportsDirectory = path.join(this.#directory, 'exports');
    this.#attachmentsDirectory = path.join(this.#directory, 'attachments');
    this.#fullBackup = new FullBackupManager(this.#directory, { freeEdition });
  }

  #enqueue(operation) {
    const result = this.#queue.then(operation);
    // A failed write must not poison later independent updates.
    this.#queue = result.catch(() => {});
    return result;
  }

  async #read() {
    if (await this.#fullBackup.recover()) this.#state = null;
    if (this.#state !== null) return this.#state;
    await mkdir(this.#directory, { recursive: true });
    let source;
    try {
      source = await readFile(this.#stateFile, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return this.#commit(createState());
    }
    let state;
    try {
      state = JSON.parse(source);
      validateState(state);
    } catch (error) {
      throw new Error(`本地数据损坏，已保留原文件，请先修复或恢复备份。${error.message}`, { cause: error });
    }
    this.#state = state;
    return state;
  }

  async #commit(candidate) {
    validateState(candidate);
    const serialized = `${JSON.stringify(candidate, null, 2)}\n`;
    const temporary = path.join(this.#directory, `.state-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporary, this.#stateFile);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporary).catch(() => {});
    }
    // Publish only once the complete candidate replaced the file successfully.
    this.#state = candidate;
    return candidate;
  }

  async load() {
    return this.#enqueue(async () => clone(await this.#read()));
  }

  async createFullBackup(filePath) {
    return this.#enqueue(async () => {
      await this.#read();
      return this.#fullBackup.create(filePath);
    });
  }

  async inspectFullBackup(filePath) {
    // Inspection is read-only, including for an empty destination directory.
    return this.#enqueue(() => this.#fullBackup.inspect(filePath));
  }

  async restoreFullBackup(filePath, token) {
    return this.#enqueue(async () => {
      try {
        const result = await this.#fullBackup.restore(filePath, token);
        this.#state = clone(result.state);
        return result;
      } catch (error) {
        // A later load must re-read disk after either a rollback or interrupted commit.
        this.#state = null;
        throw error;
      }
    });
  }
  async saveLibrary(library) {
    const snapshot = clone(library);
    return this.#enqueue(async () => {
      validateLibrary(snapshot);
      const state = await this.#read();
      if (isDeepStrictEqual(state.library, snapshot)) return clone(state);
      const next = addBackup(state, '保存资料库前');
      next.library = snapshot;
      return clone(await this.#commit(next));
    });
  }

  async saveProject(project) {
    const snapshot = clone(project);
    return this.#enqueue(async () => {
      validateProject(snapshot);
      const state = await this.#read();
      const index = state.projects.findIndex(item => item.id === snapshot.id);
      const projects = state.projects.slice();
      if (index === -1) projects.unshift(snapshot);
      else projects[index] = snapshot;
      return clone(await this.#commit({ ...state, projects, activeProjectId: snapshot.id }));
    });
  }

  async savePersonalTemplates(templates) {
    const snapshot = clone(templates);
    return this.#enqueue(async () => {
      const state = await this.#read();
      return clone(await this.#commit({ ...state, personalTemplates: snapshot }));
    });
  }

  async setActiveProject(id) {
    return this.#enqueue(async () => {
      const state = await this.#read();
      if (typeof id !== 'string' || !state.projects.some(item => item.id === id)) {
        throw new Error('找不到这份简历。');
      }
      if (state.activeProjectId === id) return clone(state);
      return clone(await this.#commit({ ...state, activeProjectId: id }));
    });
  }

  async deleteProject(id) {
    return this.#enqueue(async () => {
      const state = await this.#read();
      if (typeof id !== 'string' || !state.projects.some(item => item.id === id)) {
        throw new Error('找不到这份简历。');
      }
      const projects = state.projects.filter(item => item.id !== id);
      const activeProjectId = state.activeProjectId === id ? (projects[0]?.id ?? null) : state.activeProjectId;
      return clone(await this.#commit({ ...state, projects, activeProjectId }));
    });
  }

  async restoreBackup(id) {
    return this.#enqueue(async () => {
      const state = await this.#read();
      return clone(await this.#commit(restoreLibrary(state, id)));
    });
  }

  async reopenExport(id) {
    return this.#enqueue(async () => {
      const state = await this.#read();
      return clone(await this.#commit(reopenHistoricalExport(state, id)));
    });
  }

  async #checkAttachmentsDirectory(create = false) {
    if (create) await mkdir(this.#attachmentsDirectory, { recursive: true });
    const info = await lstat(this.#attachmentsDirectory);
    const root = await realpath(this.#directory);
    const actual = await realpath(this.#attachmentsDirectory);
    if (!info.isDirectory() || info.isSymbolicLink() || actual !== path.join(root, 'attachments')) {
      throw new Error('附件存储目录无效。');
    }
    return actual;
  }

  #findAttachment(state, id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(id)) throw new Error('附件编号无效。');
    const references = [
      ...(state.library.attachments ?? []),
      ...state.projects.flatMap(item => item.attachments ?? []),
      ...state.backups.flatMap(item => item.library.attachments ?? []),
      ...state.exports.flatMap(item => [...(item.attachments ?? []), ...(item.editable?.attachments ?? [])]),
    ].filter(item => item.id === id);
    if (!references.length) throw new Error('找不到这个附件。');
    references.forEach(item => validateAttachmentMetadata(item));
    const sha256 = references.find(item => item.sha256 !== undefined)?.sha256;
    if (references.some(item => item.storedFile !== references[0].storedFile || item.size !== references[0].size ||
        (item.sha256 !== undefined && item.sha256 !== sha256))) {
      throw attachmentProblem(references[0], '的引用不一致，无法确认原版本');
    }
    // An older reference may lack a hash. Retain any known hash without rewriting it.
    return { ...references[0], ...(sha256 !== undefined ? { sha256 } : {}) };
  }

  async #attachmentSource(state, id, snapshot) {
    const metadata = this.#findAttachment(state, id);
    if (snapshot && (snapshot.storedFile !== metadata.storedFile || snapshot.size !== metadata.size ||
        (snapshot.sha256 !== undefined && metadata.sha256 !== undefined && snapshot.sha256 !== metadata.sha256))) {
      throw attachmentProblem(metadata, '的快照与本地引用不一致');
    }
    const sha256 = metadata.sha256 ?? snapshot?.sha256;
    const problem = detail => attachmentProblem(metadata, detail);
    let handle;
    try {
      const root = await this.#checkAttachmentsDirectory();
      const filePath = path.resolve(this.#attachmentsDirectory, metadata.storedFile);
      if (path.dirname(filePath) !== this.#attachmentsDirectory) throw problem('的存储路径无效');
      const info = await lstat(filePath);
      if (!info.isFile() || info.isSymbolicLink() ||
          await realpath(filePath) !== path.join(root, metadata.storedFile)) throw problem('的存储路径无效');
      if (info.size !== metadata.size) throw problem('的大小已改变，无法使用原版本');
      // Read through one handle; never follow a source that was swapped for a link.
      handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
      const opened = await handle.stat();
      if (!opened.isFile() || !sameFile(info, opened) || opened.size !== metadata.size) throw problem('的文件已改变，无法使用原版本');
      const bytes = await handle.readFile();
      const after = await handle.stat();
      const current = await lstat(filePath);
      if (!current.isFile() || current.isSymbolicLink() || !sameFile(opened, current) ||
          !sameFile(opened, after) || after.size !== metadata.size || bytes.length !== metadata.size ||
          after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs ||
          await realpath(filePath) !== path.join(root, metadata.storedFile) ||
          await this.#checkAttachmentsDirectory() !== root) throw problem('的文件或存储路径已改变');
      if (sha256 !== undefined && attachmentHash(bytes) !== sha256) throw problem('的内容已改变，无法验证原版本');
      return { metadata, filePath, bytes };
    } catch (error) {
      if (error.message?.startsWith(`附件“${metadata.name}”`)) throw error;
      throw attachmentProblem(metadata, error.code === 'ENOENT' ? '的原文件缺失' : '的文件或存储路径无效', error);
    } finally {
      if (handle) await handle.close();
    }
  }

  async #attachmentPath(state, id, snapshot) {
    return (await this.#attachmentSource(state, id, snapshot)).filePath;
  }

  async addAttachments(items) {
    if (!Array.isArray(items) || !items.length || items.length > MAX_ATTACHMENTS) throw new Error('请选择有效的附件列表。');
    // Copy caller-owned bytes before joining the write queue.
    const incoming = items.map(item => {
      if (!item || !(item.bytes instanceof Uint8Array)) throw new Error('附件必须包含二进制内容。');
      const extension = attachmentExtension(item.name);
      if (item.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('单个附件不能超过100MB。');
      const bytes = Buffer.from(item.bytes);
      const metadata = {
        id: randomUUID(), name: item.name, storedFile: randomUUID() + '.' + extension,
        size: bytes.length, addedAt: new Date().toISOString(), mime: item.mime ?? ATTACHMENT_MIME[extension],
        sha256: attachmentHash(bytes),
      };
      validateAttachmentMetadata(metadata);
      return { metadata, bytes };
    });
    return this.#enqueue(async () => {
      const state = await this.#read();
      if ((state.library.attachments ?? []).length + incoming.length > MAX_ATTACHMENTS) throw new Error('资料库附件数量已达上限。');
      await this.#checkAttachmentsDirectory(true);
      const created = [];
      let committed = false;
      try {
        for (const item of incoming) {
          const filePath = path.join(this.#attachmentsDirectory, item.metadata.storedFile);
          const handle = await open(filePath, 'wx', 0o600);
          created.push(filePath);
          try { await handle.writeFile(item.bytes); await handle.sync(); }
          finally { await handle.close(); }
        }
        const next = addBackup(state, '添加补充文件前');
        next.library = { ...clone(state.library), attachments: [...clone(state.library.attachments ?? []), ...incoming.map(item => item.metadata)] };
        await this.#commit(next);
        committed = true;
        return clone(next);
      } finally {
        if (!committed) await Promise.all(created.map(filePath => unlink(filePath).catch(() => {})));
      }
    });
  }

  async removeAttachment(id) {
    return this.#enqueue(async () => {
      const state = await this.#read();
      if (typeof id !== 'string' || !(state.library.attachments ?? []).some(item => item.id === id)) throw new Error('资料库中找不到这个附件。');
      const next = addBackup(state, '移除补充文件前');
      next.library = { ...clone(state.library), attachments: (state.library.attachments ?? []).filter(item => item.id !== id).map(clone) };
      // Physical files are retained for projects, all PDF history and library backups.
      return clone(await this.#commit(next));
    });
  }

  async getAttachmentPath(id) {
    return this.#enqueue(async () => this.#attachmentPath(await this.#read(), id));
  }

  async getAttachmentViewPath(id) {
    return this.#enqueue(async () => {
      const { metadata, bytes } = await this.#attachmentSource(await this.#read(), id);
      const temporaryRoot = await realpath(tmpdir());
      const directory = await mkdtemp(path.join(temporaryRoot, 'its-me-view-'));
      const target = path.join(directory, metadata.name);
      const checkDirectory = async () => {
        const info = await lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink() || path.dirname(directory) !== temporaryRoot ||
            await realpath(directory) !== directory || path.dirname(target) !== directory) {
          throw attachmentProblem(metadata, '的查看副本目录无效');
        }
      };
      await checkDirectory();
      // The validated original name is readable; the unique parent isolates every open.
      await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
      await checkDirectory();
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink() || await realpath(target) !== target) {
        throw attachmentProblem(metadata, '的查看副本路径无效');
      }
      // Keep opened copies for external editors. Never write them back or collect user data.
      return target;
    });
  }

  async copyProjectAttachments(project, pdfPath) {
    const snapshot = clone(project);
    return this.#enqueue(async () => {
      validateProject(snapshot);
      if (!(snapshot.attachments ?? []).length) return undefined;
      if (typeof pdfPath !== 'string' || !path.isAbsolute(pdfPath)) throw new Error('PDF目标路径无效。');
      const state = await this.#read();
      // Resolve every source first, so a missing selection cannot leave a partial folder.
      for (const metadata of snapshot.attachments) await this.#attachmentPath(state, metadata.id, metadata);
      const parent = path.dirname(path.resolve(pdfPath));
      const stem = path.basename(pdfPath, path.extname(pdfPath)).slice(0, 80);
      const directory = path.resolve(parent, stem + '_补充材料_' + randomUUID());
      if (path.dirname(directory) !== parent) throw new Error('补充材料路径无效。');
      let created = false;
      try {
        await mkdir(directory);
        created = true;
        const used = new Set();
        for (const metadata of snapshot.attachments) {
          const extension = path.extname(metadata.name);
          const stem = path.basename(metadata.name, extension);
          let name = metadata.name;
          let count = 1;
          while (used.has(name.toLocaleLowerCase())) name = stem + ' (' + count++ + ')' + extension;
          used.add(name.toLocaleLowerCase());
          // Re-read verified bytes so the exported copy cannot race a later source edit.
          const { bytes } = await this.#attachmentSource(state, metadata.id, metadata);
          await writeFile(path.join(directory, name), bytes, { flag: 'wx', mode: 0o600 });
        }
        return directory;
      } catch (error) {
        // This unique directory was created by this operation and is within the chosen parent.
        if (created && path.dirname(directory) === parent) await rm(directory, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    });
  }

  async #checkExportsDirectory(create = false) {
    if (create) await mkdir(this.#exportsDirectory, { recursive: true });
    const info = await lstat(this.#exportsDirectory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('PDF 存储目录无效。');
    }
  }

  async commitExport(project, pdfBytes, metadata = {}) {
    const snapshot = clone(project);
    const exportMetadata = clone(metadata);
    const bytes = copyPdf(pdfBytes);
    return this.#enqueue(async () => {
      validateProject(snapshot);
      const state = await this.#read();
      for (const metadata of snapshot.attachments ?? []) await this.#attachmentPath(state, metadata.id, metadata);
      await this.#checkExportsDirectory(true);
      const pdfFile = `${randomUUID()}.pdf`;
      const filePath = path.join(this.#exportsDirectory, pdfFile);
      let handle;
      let created = false;
      let committed = false;
      try {
        handle = await open(filePath, 'wx', 0o600);
        created = true;
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close();
        handle = null;
        const next = recordExport(state, snapshot, pdfFile, exportMetadata);
        await this.#commit(next);
        committed = true;
        return clone(next);
      } finally {
        if (handle) await handle.close().catch(() => {});
        // Never delete a historical PDF. Only our unrecorded new file is disposable.
        if (created && !committed) await unlink(filePath).catch(() => {});
      }
    });
  }

  async getExportPath(id) {
    return this.#enqueue(async () => {
      const state = await this.#read();
      const entry = typeof id === 'string' ? state.exports.find(item => item.id === id) : null;
      if (!entry || !safePdfName(entry.pdfFile)) throw new Error('找不到这次 PDF 导出。');
      await this.#checkExportsDirectory();
      const filePath = path.resolve(this.#exportsDirectory, entry.pdfFile);
      if (path.dirname(filePath) !== this.#exportsDirectory) throw new Error('PDF 路径无效。');
      const info = await lstat(filePath);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('历史 PDF 文件无效。');
      return filePath;
    });
  }
}
