// Presets expand the local keyword matcher; they never generate experience or call AI.
export const jobPresets = [
  { id: 'product', name: '产品经理', keywords: ['产品', '需求分析', '用户研究', '原型', 'PRD', '项目管理', 'product', 'research'] },
  { id: 'software', name: '软件开发', keywords: ['开发', '编程', '前端', '后端', 'JavaScript', 'TypeScript', 'Python', 'Java', 'React', 'SQL', 'software'] },
  { id: 'data', name: '数据分析师', keywords: ['数据分析', '数据', 'SQL', 'Python', 'Excel', '统计', 'BI', 'analytics'] },
  { id: 'design', name: '视觉 / UX 设计', keywords: ['设计', '用户体验', '交互', '视觉', 'Figma', 'UI', 'UX', 'design'] },
  { id: 'operations', name: '运营', keywords: ['运营', '用户增长', '活动', '内容', '社群', '数据分析', 'operations'] },
  { id: 'marketing', name: '市场营销', keywords: ['市场', '营销', '品牌', '推广', '广告', '传播', 'marketing'] },
  { id: 'sales', name: '销售 / 商务', keywords: ['销售', '商务', '客户', '谈判', '渠道', '合同', 'sales'] },
  { id: 'finance', name: '财务 / 会计', keywords: ['财务', '会计', '审计', '预算', '税务', 'Excel', 'finance', 'accounting'] },
  { id: 'hr', name: '人力资源', keywords: ['人力资源', '招聘', '培训', '绩效', '薪酬', '员工关系', 'HR'] },
  { id: 'education', name: '教育 / 培训', keywords: ['教学', '教育', '培训', '课程', '教研', '授课', 'education'] },
  { id: 'engineering', name: '工程 / 制造', keywords: ['工程', '机械', '制造', '质量', '工艺', 'CAD', 'SolidWorks', 'engineering'] },
  { id: 'admin', name: '行政 / 综合支持', keywords: ['行政', '办公', '协调', '流程', '文档', '采购', 'administration'] },
];
export const findJobPreset = id => jobPresets.find(preset => preset.id === id);
