export function userMessage(value) {
  const text = String(value?.message ?? value ?? '操作未完成，请重试。');
  return text.replace(/(?:Error:\s*)?Error invoking remote method ['"][^'"]+['"]:\s*/gu, '')
    .replace(/(^|：|:\s+)Error:\s*/gu, '$1').split(/\r?\n/u)[0].trim() || '操作未完成，请重试。';
}
