// Offline customer documents generated from the staged application's own help data.
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readFile,writeFile,mkdir,readdir,lstat,rename,mkdtemp,rm,realpath} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {validateCustomerGuideManifest,isCustomerGuideVersion,isCustomerGuideSource} from './customer-guide-contract.mjs';
const defaultRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const within=(root,target)=>{const relative=path.relative(root,target);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
const html=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const markdown=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/([\\`*_\[\]#!|])/gu,'\\$1');
const localUrl=value=>value.split('/').map(part=>encodeURIComponent(part).replace(/[!'()*]/gu,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase())).join('/');
const json=async file=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/u,''));
async function noLinks(root,target){
 if(!within(root,target))throw Error('客户文档路径必须位于项目内。');
 let current=root;
 for(const segment of path.relative(root,target).split(path.sep)){
  current=path.join(current,segment);let info;try{info=await lstat(current);}catch(error){if(error.code==='ENOENT')break;throw error;}
  if(info.isSymbolicLink())throw Error('客户文档路径不允许经过链接。');
 }
}
async function checkedRoot(projectRoot){const root=path.resolve(projectRoot||defaultRoot);if((await realpath(root)).toLowerCase()!==root.toLowerCase())throw Error('项目根路径不能是链接。');return root;}
async function outputPath(root,output,version){
 if(typeof output!=='string'||!path.isAbsolute(output))throw Error('请指定客户文档的绝对输出目录。');
 const target=path.resolve(output),bases=[path.join(root,'work'),path.join(root,'outputs/原型','ITS ME-'+version+'-win-x64'),path.join(root,'outputs/内测','ITS ME-'+version+'-Windows安装包')];
 if(!bases.some(base=>within(base,target)))throw Error('客户文档输出仅允许项目 work 或本版打包目录中的子目录。');
 await noLinks(root,target);try{if(!(await lstat(target)).isDirectory())throw Error('客户文档输出已被普通文件占用。');}catch(error){if(error.code!=='ENOENT')throw error;}return target;
}
function validateTopics(topics){
 if(!Array.isArray(topics)||!topics.length)throw Error('客户帮助主题内容为空或格式无效。');
 for(const topic of topics){
  if(!topic||typeof topic.id!=='string'||typeof topic.title!=='string'||typeof topic.summary!=='string'||!Array.isArray(topic.keywords)||!topic.keywords.every(x=>typeof x==='string')||!Array.isArray(topic.sections)||!topic.sections.length)throw Error('客户帮助主题格式不完整。');
  for(const section of topic.sections)if(typeof section?.title!=='string'||!Array.isArray(section.paragraphs)||!section.paragraphs.every(x=>typeof x==='string')||(section.steps!==undefined&&(!Array.isArray(section.steps)||!section.steps.every(x=>typeof x==='string'))))throw Error('客户帮助主题正文格式不完整。');
 }
 return topics;
}
function page(title,body){return '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;"><title>'+html(title)+'</title><style>body{max-width:840px;margin:40px auto;padding:0 24px;font:16px/1.8 system-ui,"Microsoft YaHei",sans-serif;color:#202124;background:#fff}h1,h2,h3{line-height:1.35}section{margin:32px 0}a{color:#125aba}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #ddd;text-align:left;padding:8px;overflow-wrap:anywhere}code{overflow-wrap:anywhere}nav{padding:16px;background:#f5f6f8;border-radius:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body>'+body+'</body></html>\n';}
function quickStart(topics,version){
 const title='ITS ME '+version+' · 客户快速上手';let md='# '+markdown(title)+'\n\n',body='<h1>'+html(title)+'</h1><nav aria-label="目录"><ol>';
 topics.forEach((topic,index)=>body+='<li><a href="#topic-'+index+'">'+html(topic.title)+'</a></li>');body+='</ol></nav>';
 topics.forEach((topic,index)=>{md+='## '+markdown(topic.title)+'\n\n'+markdown(topic.summary)+'\n\n';body+='<section id="topic-'+index+'"><h2>'+html(topic.title)+'</h2><p>'+html(topic.summary)+'</p>';
  for(const section of topic.sections){md+='### '+markdown(section.title)+'\n\n';body+='<h3>'+html(section.title)+'</h3>';for(const paragraph of section.paragraphs){md+=markdown(paragraph)+'\n\n';body+='<p>'+html(paragraph)+'</p>';}if(section.steps?.length){section.steps.forEach((step,index)=>md+=(index+1)+'. '+markdown(step)+'\n');md+='\n';body+='<ol>'+section.steps.map(step=>'<li>'+html(step)+'</li>').join('')+'</ol>';}}body+='</section>';
 });return{md,html:page(title,body)};
}
const licenseName=name=>/(?:^|[-_.])(licen[cs]es?|copying|notice)(?:[-_.]|$)/iu.test(name);
async function componentFiles(root,application,lock,runtimeVersion,files,runtimeDirectory){
 const runtime=runtimeDirectory||path.join(root,'work/runtime/electron');await noLinks(root,runtime);const actualRuntime=(await readFile(path.join(runtime,'version'),'utf8')).trim();if(actualRuntime!==runtimeVersion)throw Error('Electron 运行时版本与锁定记录不一致。');
 const components=[];
 async function collect(name,version,license,directory,relative){
  const licenseFiles=[];for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
   if(!licenseName(entry.name))continue;const source=path.join(directory,entry.name);await noLinks(root,source);if(!entry.isFile())continue;
   const target='third-party-licenses/'+relative+'/'+entry.name;files.set(target,source);licenseFiles.push(target);
  }
  let licenseNote;
  if(!licenseFiles.length){for(const entry of await readdir(directory,{withFileTypes:true})){if(!entry.isFile()||!/^readme(?:\.(?:md|txt|markdown))?$/iu.test(entry.name))continue;const source=path.join(directory,entry.name);await noLinks(root,source);const bytes=await readFile(source);if(!/(?:^|\r?\n)\s*(?:#{1,6}\s+)?licen[cs]e\s*(?:\r?\n|$)/iu.test(bytes.toString('utf8')))continue;const target='third-party-licenses/'+relative+'/'+entry.name;files.set(target,source);licenseFiles.push(target);licenseNote='许可文本位于原始 README 的 License 章节；原字节保留。';}}
  components.push({name,version,license:typeof license==='string'?license:'见原始许可文件',licenseFiles,source:relative,...(licenseNote?{licenseNote}:{})});
 }
 await collect('Electron',runtimeVersion,'MIT；Chromium 另见完整声明',runtime,'Electron');
 if(!components[0].licenseFiles.some(file=>file.endsWith('/LICENSE'))||!components[0].licenseFiles.some(file=>file.endsWith('/LICENSES.chromium.html')))throw Error('Electron 完整许可证或 Chromium 声明缺失。');
 for(const [relative,item]of Object.entries(lock.packages||{}).filter(([key,item])=>key&&!item.dev).sort(([a],[b])=>a.localeCompare(b,'en'))){
  if(!/^node_modules\/(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+(?:\/node_modules\/(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+)*$/u.test(relative))throw Error('生产依赖路径格式无效。');
  const directory=path.join(application,...relative.split('/'));await noLinks(root,directory);let installed;
  try{installed=await json(path.join(directory,'package.json'));}catch(error){if(error.code==='ENOENT'&&item.optional)continue;throw Error('生产依赖缺失或元数据无效：'+relative);}
  const name=relative.slice(relative.lastIndexOf('node_modules/')+'node_modules/'.length);if(installed.name!==name||installed.version!==item.version)throw Error('生产依赖版本与锁定记录不一致：'+relative);
  await collect(name,installed.version,installed.license||item.license,directory,relative);
 }
 const canvas=components.find(component=>component.name==='@napi-rs/canvas');if(canvas?.licenseFiles.length)for(const component of components)if(component.name.startsWith('@napi-rs/canvas-')&&!component.licenseFiles.length)component.relatedLicenseFiles=[...canvas.licenseFiles];
 return components;
}

async function installedPackageSources(root,application,lock){
 const found=new Set();
 async function packageDirectory(relative,entry){
  if(!entry.isDirectory()||!isCustomerGuideSource(relative))throw Error('生产依赖目录格式无效：'+relative);
  const directory=path.join(application,...relative.split('/'));await noLinks(root,directory);await noLinks(root,path.join(directory,'package.json'));
  if(!lock.packages?.[relative]||lock.packages[relative].dev)throw Error('存在未在生产锁中登记的已安装组件：'+relative);
  found.add(relative);await modules(relative+'/node_modules');
 }
 async function modules(relative){
  const directory=path.join(application,...relative.split('/'));await noLinks(root,directory);let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
  for(const entry of entries){if(entry.name==='.bin'||entry.name==='.package-lock.json')continue;
   if(entry.name.startsWith('@')){const scope=path.join(directory,entry.name);await noLinks(root,scope);if(!entry.isDirectory())throw Error('生产依赖scope不是目录。');for(const child of await readdir(scope,{withFileTypes:true}))await packageDirectory(relative+'/'+entry.name+'/'+child.name,child);}
   else await packageDirectory(relative+'/'+entry.name,entry);
  }
 }
 await modules('node_modules');return found;
}
export async function collectCustomerGuideSources({root=defaultRoot,applicationRoot,runtimeRoot,expectedRuntimeVersion}={}){
 root=await checkedRoot(root);const application=path.resolve(applicationRoot||path.join(root,'work/production-app')),runtime=path.resolve(runtimeRoot||path.join(root,'work/runtime/electron'));
 for(const input of [application,runtime,path.join(application,'package.json'),path.join(application,'package-lock.json'),path.join(runtime,'version')])await noLinks(root,input);
 const metadata=await json(path.join(application,'package.json')),lock=await json(path.join(application,'package-lock.json')),runtimeVersion=(await readFile(path.join(runtime,'version'),'utf8')).trim();
 if(!isCustomerGuideVersion(metadata.version)||lock.lockfileVersion!==3||lock.packages?.['']?.version!==metadata.version)throw Error('组件来源应用版本与锁定记录无效。');
 if(!isCustomerGuideVersion(runtimeVersion)||(expectedRuntimeVersion!==undefined&&(!isCustomerGuideVersion(expectedRuntimeVersion)||runtimeVersion!==expectedRuntimeVersion)))throw Error('Electron运行时版本与期望不一致。');
 const installed=await installedPackageSources(root,application,lock),files=new Map(),components=await componentFiles(root,application,lock,runtimeVersion,files,runtime);
 if(components.filter(component=>component.source!=='Electron').length!==installed.size)throw Error('生产组件来源与实际安装目录不一致。');
 return{runtimeVersion,components,files:[...files].map(([targetPath,sourcePath])=>({targetPath,sourcePath}))};
}

function componentIndex(components,version){
 const title='ITS ME '+version+' · 第三方组件索引',intro='本索引记录本次暂存应用实际存在的生产依赖及 Electron 运行时，不包含未安装的可选平台包或仅用于打包的开发工具。完整许可文本在本目录 third-party-licenses 中，同时保留原随包文件；这是来源索引，不替代原始许可证或法律判断。';
 let md='# '+markdown(title)+'\n\n'+intro+'\n\n',body='<h1>'+html(title)+'</h1><p>'+html(intro)+'</p>';
 for(const component of components){const label=component.name+' '+component.version;md+='## '+markdown(label)+'\n\n许可：'+markdown(component.license)+'\n\n';body+='<section><h2>'+html(label)+'</h2><p>许可：'+html(component.license)+'</p>';
  if(component.licenseNote){md+=markdown(component.licenseNote)+'\n\n';body+='<p>'+html(component.licenseNote)+'</p>';}if(component.licenseFiles.length){body+='<ul>';for(const file of component.licenseFiles){md+='- ['+markdown(file)+']('+localUrl(file)+')\n';body+='<li><a href="'+html(localUrl(file))+'">'+html(file)+'</a></li>';}body+='</ul>';md+='\n';}else{const warning='未发现独立 LICENSE/NOTICE 文件，请同时查阅原始依赖目录 '+component.source+'。';md+=markdown(warning)+'\n\n';body+='<p>'+html(warning)+'</p>';}if(component.relatedLicenseFiles?.length){const note='同时参阅主组件 @napi-rs/canvas 的随包原始许可；此链接不替代平台包自身的许可声明。';md+=note+'\n\n';body+='<p>'+html(note)+'</p><ul>';for(const file of component.relatedLicenseFiles){md+='- ['+markdown(file)+']('+localUrl(file)+')\n';body+='<li><a href="'+html(localUrl(file))+'">'+html(file)+'</a></li>';}md+='\n';body+='</ul>';}body+='</section>';
 }
 return{md,html:page(title,body)};
}
function versionGuide(version,runtimeVersion){
 const title='ITS ME '+version+' · 版本与升级说明';
 const paragraphs=['本交付版本：'+version+'；平台：Windows x64；运行时：Electron '+runtimeVersion+'。','本软件免费使用，安装后即可编辑、导出及备份，无需激活、授权文件或作者签发。现有安装包未做 Windows 发布者代码签名，请从作者的可信发布渠道取得安装包及本版更新说明。','推荐在“设置 → 软件更新”选择新版 ITS-ME-版本-Setup.exe。软件会先处理未保存修改、创建完整救援备份，再退出并启动安装程序。无需先卸载旧版。','也可退出后直接双击新版 Setup；手动运行 Setup 不会自动创建上述救援备份，请先在软件内保存完整备份。安装时可以选择安装目录；安装和普通卸载保留本机资料。','更新沿用原有资料位置。“设置 → 本地资料 → 更改资料目录”可以复制资料到新的空文件夹，校验后重启；新目录成功打开后自动清理旧处已迁移的受管副本。该选择在普通快捷方式和后续更新中继续生效。AI 设置、Key、规则、未提交草稿和用户另放文件仍在原位置，不会一并删除。清理遇到占用或变化会保留并可在设置重试。仅测试启动参数 --data-dir 需要继续以原参数打开，新快捷方式不自动继承测试参数。','完整目录版必须保留整个文件夹，不能只复制 ITS ME.exe；旧目录不会被安装器原地更新，可保留作回退。','“设置 → 本地资料 → 一键打包资料库（换机）”或首页“备份与换机”可保存一个完整备份，包含受管资料、项目、模板、附件和归档 PDF，不包含 API Key、全局 AI 规则或未提交草稿。新电脑恢复资料后即可离线继续使用，AI 需重新配置。完整备份未加密，请安全保管。旧版资料和备份无需补发授权即可用于本免费版，旧授权原件保留亦不影响使用。','可选 AI 仍由用户主动配置自己的 API Key 并发送，仅主动使用时联网，接口费用由服务账号承担。照片和补充文件二进制不会自动发送。会话 Key 退出后需重新输入；规则及来源保护不能保证模型的语义事实正确，采用前仍需核对。','收到配套 release.json 或 SHA256SUMS 时可核对文件大小和摘要。未签名摘要用于发现传输损坏或文件变化，不能单独证明发布者身份。','如需反馈，可在设置复制不含简历内容及 Key 的版本/系统信息，附复现步骤联系取得软件的原发布渠道；不要发送 Key。复现优先使用虚构资料和脱敏截图；仅在明确知情且确有必要时另行处理个人资料。'];
 return{md:'# '+markdown(title)+'\n\n'+paragraphs.map(markdown).join('\n\n')+'\n',html:page(title,'<h1>'+html(title)+'</h1>'+paragraphs.map(p=>'<p>'+html(p)+'</p>').join(''))};
}

function protectInputTrees(root,application,out){
 if(out===application||within(out,application))throw Error('客户文档输出不能替换或包含应用输入目录。');
 for(const input of [path.join(application,'app'),path.join(application,'node_modules'),path.join(root,'work/runtime/electron'),path.join(root,'tools')])if(out===input||within(out,input)||within(input,out))throw Error('客户文档输出与必需输入树重叠，未移动原目录。');
}
async function readCustomerGuideDirectory(root,source,{expectedVersion,expectedRuntimeVersion,allowExtras=false}={}){
 await noLinks(root,source);await noLinks(root,path.join(source,'customer-guides.json'));
 const manifestBytes=await readFile(path.join(source,'customer-guides.json')),manifest=validateCustomerGuideManifest(JSON.parse(manifestBytes.toString('utf8')),{expectedVersion,expectedRuntimeVersion});
 const expected=new Set(['customer-guides.json']),files=new Map([['customer-guides.json',manifestBytes]]);
 for(const file of manifest.files){expected.add(file.path);const target=path.join(source,...file.path.split('/'));await noLinks(root,target);const bytes=await readFile(target);if(bytes.length!==file.size||digest(bytes)!==file.sha256)throw Error('客户文档文件与清单不一致。');files.set(file.path,bytes);}
 const actual=await listFiles(root,source);if(!allowExtras&&(actual.length!==expected.size||actual.some(file=>!expected.has(file))))throw Error('客户文档含清单之外的额外文件。');
 return{manifest,files};
}
async function protectExistingOutput(root,out){
 try{await lstat(out);}catch(error){if(error.code==='ENOENT')return;throw error;}
 try{await readCustomerGuideDirectory(root,out,{allowExtras:true});}catch{throw Error('现存输出不是完整的已生成客户文档，未移动原目录。');}
}
async function publish(root,out,files){
 await noLinks(root,out);await protectExistingOutput(root,out);await mkdir(path.dirname(out),{recursive:true});const temporary=await mkdtemp(path.join(path.dirname(out),'.customer-guides-'));let preserved;
 try{for(const [relative,bytes]of files){const target=path.join(temporary,...relative.split('/'));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});}
  await protectExistingOutput(root,out);try{await lstat(out);preserved=out+'-previous-'+Date.now()+'-'+randomUUID().slice(0,8);await rename(out,preserved);}catch(error){if(error.code!=='ENOENT')throw error;}
  try{await rename(temporary,out);}catch(error){if(preserved)await rename(preserved,out);throw error;}
 }catch(error){await rm(temporary,{recursive:true,force:true});throw error;}return preserved;
}
export async function generateCustomerGuides({projectRoot=defaultRoot,applicationDirectory,outputDirectory,topics}={}){
 const root=await checkedRoot(projectRoot),application=path.resolve(applicationDirectory||path.join(root,'work/production-app'));await noLinks(root,application);
 await noLinks(root,path.join(application,'package.json'));const metadata=await json(path.join(application,'package.json'));if(!isCustomerGuideVersion(metadata.version))throw Error('客户文档应用版本格式无效。');
 const out=await outputPath(root,outputDirectory,metadata.version);protectInputTrees(root,application,out);
 if(topics===undefined){const source=path.join(application,'app/ui/help-content.mjs');await noLinks(root,source);try{topics=(await import(pathToFileURL(source).href+'?sha256='+digest(await readFile(source)))).helpTopics;}catch{throw Error('暂存应用缺少可读取的客户帮助源，未借用其它版本的说明。');}}
 validateTopics(topics);await noLinks(root,path.join(root,'tools/runtime-lock.json'));const runtimeLock=await json(path.join(root,'tools/runtime-lock.json'));if(!isCustomerGuideVersion(runtimeLock.version))throw Error('运行时版本格式无效。');
 const catalog=await collectCustomerGuideSources({root,applicationRoot:application,runtimeRoot:path.join(root,'work/runtime/electron'),expectedRuntimeVersion:runtimeLock.version}),components=catalog.components,files=new Map();
 for(const file of catalog.files)files.set(file.targetPath,await readFile(file.sourcePath));
 for(const [name,content]of [['客户快速上手',quickStart(topics,metadata.version)],['第三方组件索引',componentIndex(components,metadata.version)],['版本与升级说明',versionGuide(metadata.version,runtimeLock.version)]]){files.set(name+'.md',Buffer.from(content.md));files.set(name+'.html',Buffer.from(content.html));}
 const entries=[...files].map(([relative,bytes])=>({path:relative,size:bytes.length,sha256:digest(bytes)})).sort((a,b)=>a.path.localeCompare(b.path,'en'));
 const manifest=validateCustomerGuideManifest({schemaVersion:1,version:metadata.version,runtimeVersion:runtimeLock.version,components,files:entries});files.set('customer-guides.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
 const preserved=await publish(root,out,files);return{version:metadata.version,outputDirectory:out,files:entries,components,preserved};
}
async function listFiles(root,directory,relative=''){
 const result=[];for(const entry of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);await noLinks(root,file);const name=relative?relative+'/'+entry.name:entry.name;if(entry.isDirectory())result.push(...await listFiles(root,file,name));else if(entry.isFile())result.push(name);else throw Error('客户文档含不支持的文件。');}return result;
}
export async function copyCustomerGuides({projectRoot=defaultRoot,sourceDirectory,outputDirectory,expectedVersion,expectedRuntimeVersion}={}){
 const root=await checkedRoot(projectRoot),source=path.resolve(sourceDirectory),{manifest,files}=await readCustomerGuideDirectory(root,source,{expectedVersion,expectedRuntimeVersion});
 const out=await outputPath(root,outputDirectory,manifest.version);if(source===out||within(source,out)||within(out,source))throw Error('客户文档来源与输出目录不能相同或互相嵌套。');
 const preserved=await publish(root,out,files);return{version:manifest.version,outputDirectory:out,files:manifest.files,preserved};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const args=process.argv.slice(2),option=name=>args.find(value=>value.startsWith('--'+name+'='))?.slice(name.length+3);if(args.some(value=>!/^--(?:application|out|copy-from)=.+/u.test(value))){console.error('参数仅支持 --application=暂存应用目录 --out=输出目录，或 --copy-from=已生成文档目录。');process.exitCode=1;}else{
  const operation=option('copy-from')?copyCustomerGuides({sourceDirectory:path.resolve(option('copy-from')),outputDirectory:option('out')&&path.resolve(option('out'))}):generateCustomerGuides({applicationDirectory:option('application')&&path.resolve(option('application')),outputDirectory:option('out')&&path.resolve(option('out'))});
  operation.then(result=>console.log(result.outputDirectory)).catch(error=>{console.error(error.message);process.exitCode=1;});
 }
}