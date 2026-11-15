// Shared schema for generated offline customer documents; this does not authenticate a publisher.
export const REQUIRED_GUIDE_FILES=Object.freeze(['客户快速上手.md','客户快速上手.html','第三方组件索引.md','第三方组件索引.html','版本与升级说明.md','版本与升级说明.html']);
export const REQUIRED_RUNTIME_NOTICE_FILES=Object.freeze(['third-party-licenses/Electron/LICENSE','third-party-licenses/Electron/LICENSES.chromium.html']);
const VERSION=/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/u;
const SOURCE=/^node_modules\/(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+(?:\/node_modules\/(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+)*$/u;
const HEX=/^[a-f0-9]{64}$/u;
const fail=message=>{throw Error('客户文档清单：'+message);};
const object=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed,label)=>{if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail(label+'字段格式无效。');};
export const isCustomerGuideVersion=value=>typeof value==='string'&&VERSION.test(value);
export const isCustomerGuideSource=value=>typeof value==='string'&&(value==='Electron'||SOURCE.test(value));
export const isCustomerGuideRelativePath=value=>typeof value==='string'&&value.length>0&&!/[\\\u0000-\u001f<>:"|?*]/u.test(value)&&!value.startsWith('/')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!/[. ]$/u.test(part));
const noticePath=value=>isCustomerGuideRelativePath(value)&&value.startsWith('third-party-licenses/');
export function validateCustomerGuideManifest(manifest,{expectedVersion,expectedRuntimeVersion}={}){
 keys(manifest,['schemaVersion','version','runtimeVersion','components','files'],'顶层');
 if(manifest.schemaVersion!==1||!isCustomerGuideVersion(manifest.version)||!isCustomerGuideVersion(manifest.runtimeVersion)||!Array.isArray(manifest.files)||!Array.isArray(manifest.components)||!manifest.components.length)fail('版本、运行时或组件结构无效。');
 for(const [expected,actual,label]of [[expectedVersion,manifest.version,'应用版本'],[expectedRuntimeVersion,manifest.runtimeVersion,'运行时版本']])if(expected!==undefined&&(!isCustomerGuideVersion(expected)||expected!==actual))fail(label+'与期望不一致。');
 const files=new Map(),folded=new Set();
 for(const item of manifest.files){
  keys(item,['path','size','sha256'],'文件');
  if(!isCustomerGuideRelativePath(item.path)||(!REQUIRED_GUIDE_FILES.includes(item.path)&&!noticePath(item.path))||!Number.isSafeInteger(item.size)||item.size<0||!HEX.test(item.sha256||'')||folded.has(item.path.toLowerCase()))fail('文件路径、大小、摘要或重复项无效。');
  files.set(item.path,item);folded.add(item.path.toLowerCase());
 }
 for(const required of [...REQUIRED_GUIDE_FILES,...REQUIRED_RUNTIME_NOTICE_FILES])if(!files.has(required))fail('缺少必需文档或许可：'+required);
 const sources=new Set(),owned=new Set(),related=[];let electron=0;
 for(const component of manifest.components){
  keys(component,['name','version','license','source','licenseFiles','licenseNote','relatedLicenseFiles'],'组件');
  if(!isCustomerGuideSource(component.source)||!isCustomerGuideVersion(component.version)||typeof component.license!=='string'||!component.license.trim()||!Array.isArray(component.licenseFiles)||(component.licenseNote!==undefined&&typeof component.licenseNote!=='string')||(component.relatedLicenseFiles!==undefined&&!Array.isArray(component.relatedLicenseFiles))||sources.has(component.source.toLowerCase()))fail('组件身份、来源、版本、许可或重复项无效。');
  sources.add(component.source.toLowerCase());
  const expectedName=component.source==='Electron'?'Electron':component.source.slice(component.source.lastIndexOf('node_modules/')+'node_modules/'.length);
  if(component.name!==expectedName)fail('组件名称与来源路径不一致。');
  if(component.source==='Electron'){electron++;if(component.version!==manifest.runtimeVersion||REQUIRED_RUNTIME_NOTICE_FILES.some(file=>!component.licenseFiles.includes(file)))fail('Electron运行时版本或必需许可引用无效。');}
  const references=new Set();
  for(const file of component.licenseFiles){if(!noticePath(file)||!file.startsWith('third-party-licenses/'+component.source+'/')||!files.has(file)||references.has(file.toLowerCase()))fail('组件许可引用无效或重复。');references.add(file.toLowerCase());owned.add(file);}
  for(const file of component.relatedLicenseFiles||[]){if(!noticePath(file)||!files.has(file)||references.has(file.toLowerCase()))fail('组件关联许可引用无效或重复。');references.add(file.toLowerCase());related.push(file);}
 }
 if(electron!==1)fail('必须包含一个Electron组件。');
 for(const file of related)if(!owned.has(file))fail('关联许可缺少实际组件的原始引用。');
 for(const file of files.keys())if(noticePath(file)&&!owned.has(file))fail('包含未被组件引用的额外许可文件。');
 return manifest;
}