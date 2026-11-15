// Shared metadata rules. This module has no filesystem or network access.
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const MAX_ATTACHMENTS = 2000;
export const ATTACHMENT_EXTENSIONS = Object.freeze(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'docx', 'pptx', 'xlsx', 'txt', 'md', 'zip']);
export const ATTACHMENT_MIME = Object.freeze({
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain', md: 'text/markdown', zip: 'application/zip',
});
const UUID_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.([a-z]+)$/u;
function fail(path, message) { throw new Error(path + ': ' + message); }
export function attachmentExtension(name, path = 'attachment.name') {
  if (typeof name !== 'string' || !name || name.length > 180 ||
      /[\\/:*?"<>|\u0000-\u001f\u007f]/u.test(name) || /[. ]$/u.test(name) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) fail(path, '附件文件名无效');
  const extension = name.split('.').at(-1).toLowerCase();
  if (!name.includes('.') || !ATTACHMENT_EXTENSIONS.includes(extension)) fail(path, '不支持的附件类型');
  return extension;
}
export function validateAttachmentMetadata(value, path = 'attachment') {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, '附件必须为普通对象');
  if (typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value.id)) fail(path + '.id', '附件编号无效');
  const extension = attachmentExtension(value.name, path + '.name');
  const match = typeof value.storedFile === 'string' && value.storedFile.match(UUID_FILE);
  if (!match || match[1] !== extension) fail(path + '.storedFile', '附件存储文件名无效');
  if (!Number.isSafeInteger(value.size) || value.size < 0 || value.size > MAX_ATTACHMENT_BYTES) fail(path + '.size', '单个附件不能超过100MB');
  if (typeof value.addedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.addedAt) || !Number.isFinite(Date.parse(value.addedAt))) fail(path + '.addedAt', '附件时间无效');
  if (typeof value.mime !== 'string' || value.mime.length > 160 ||
      (value.mime !== '' && !/^[a-z\d!#$&^_.+-]+\/[a-z\d!#$&^_.+-]+$/iu.test(value.mime))) fail(path + '.mime', '附件MIME类型无效');
  if (value.sha256 !== undefined && (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sha256))) fail(path + '.sha256', '附件SHA256无效');
  return true;
}
export function validateAttachmentList(value, path = 'attachments') {
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) fail(path, '附件列表类型或数量无效');
  const ids = new Set();
  for (let index = 0; index < value.length; index++) {
    validateAttachmentMetadata(value[index], path + '[' + index + ']');
    if (ids.has(value[index].id)) fail(path, '附件编号重复');
    ids.add(value[index].id);
  }
  return true;
}
