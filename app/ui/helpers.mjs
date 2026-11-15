export const categories = { work: '工作经历', project: '项目经历', education: '教育背景', skills: '专业技能', certificate: '证书与荣誉', other: '其他经历' };
export const categoryEnglish = { work: 'Experience', project: 'Projects', education: 'Education', skills: 'Skills', certificate: 'Awards & certificates', other: 'Additional experience' };
export const icon = (name, size = 20) => {
  const paths = {
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    folder: '<path d="M3 7V4h7l2 3h9v13H3Z"/>',
    library: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v18m4-13h4m-4 4h4m-4 4h4"/>',
    edit: '<path d="M13 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-8M15 3l6 6M10 14l-1 5 5-1L22 10a2 2 0 0 0-6-6Z"/>',
    history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2"/>',
    settings: '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m-2-5h4l1 3 3 1 3 1v4l-2 2-1 3-1 3h-4l-2-2-3-1-3-1v-4l2-2 1-3Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>',
    undo: '<path d="m9 4-6 6 6 6M3 10h11a7 7 0 0 1 7 7v3"/>',
    redo: '<path d="m15 4 6 6-6 6m6-6H10a7 7 0 0 0-7 7v3"/>',
    grip: '<path d="M8 5h1m6 0h1M8 12h1m6 0h1M8 19h1m6 0h1"/>',
    file: '<path d="M14 2H5v20h14V7Zm0 0v6h5M8 12h8m-8 4h8"/>',
    check: '<path d="m5 12 4 4L20 5"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 4H4v12"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
};
export const escape = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const clone = value => structuredClone(value);
export const uid = () => crypto.randomUUID();
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const dateLabel = value => new Date(value).toLocaleString('zh-CN', { hour12: false });
export const field = (label, html, extra = '') => `<label class="field ${extra}"><span>${label}</span>${html}</label>`;
export const input = (name, value = '', extra = '') => `<input name="${name}" value="${escape(value)}" ${extra}>`;
export const textarea = (name, value = '', rows = 4, extra = '') => `<textarea name="${name}" rows="${rows}" ${extra}>${escape(value)}</textarea>`;
export const button = (label, action, style = 'secondary', extra = '') => `<button type="button" class="button ${style}" data-action="${action}" ${extra}>${label}</button>`;
export const categoryOptions = (selected) => Object.entries(categories).map(([key, value]) => `<option value="${key}" ${selected === key ? 'selected' : ''}>${value}</option>`).join('');
