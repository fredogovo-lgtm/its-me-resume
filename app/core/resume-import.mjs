// Conservative local import candidates. Source text is data, never commands or HTML.
import {validateLibrary} from './model.mjs';
import {createEntry,setPeriod} from './entry-content.mjs';
export const RESUME_IMPORT_MAX_TEXT=200000;
const fields=['name','headline','city','email','phone','website'];
const shared=new Set(['email','phone','website']);
const categories=new Set(['work','project','education','skills','certificate','other']);
const headings={work:/^(?:工作(?:经历|经验)|职业经历|实习(?:经历|经验)|work\s*(?:experience|history)|professional\s+experience|employment(?:\s+history)?|experience)$/iu,project:/^(?:项目(?:经历|经验|实践)|projects?(?:\s+experience)?)$/iu,education:/^(?:教育(?:背景|经历)|学历|education(?:al\s+background)?)$/iu,skills:/^(?:专业技能|技能(?:特长)?|技术能力|skills?|technical\s+skills)$/iu,certificate:/^(?:证书(?:与荣誉)?|荣誉(?:与证书)?|获奖(?:经历)?|certifications?|awards?(?:\s*(?:&|and)\s*certifications?)?)$/iu,other:/^(?:其他(?:经历|信息)?|个人简介|自我评价|summary|profile|additional\s+information)$/iu};
const labels={name:/^(?:姓名|name)\s*[:：]\s*(.+)$/iu,headline:/^(?:求职意向|职业方向|职位|headline|target\s+role)\s*[:：]\s*(.+)$/iu,city:/^(?:城市|所在地|现居地|city|location)\s*[:：]\s*(.+)$/iu,email:/^(?:(?:邮箱|电子邮箱|email|e-mail)\s*[:：]\s*)?([^\s@]+@[^\s@]+\.[^\s@]+)$/iu,phone:/^(?:电话|手机|联系电话|phone|mobile)\s*[:：]\s*(.+)$/iu,website:/^(?:(?:网站|个人网站|网址|website|portfolio)\s*[:：]\s*)?(https?:\/\/\S+)$/iu};
const clean=(value,max=RESUME_IMPORT_MAX_TEXT)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value))throw Error('导入文字类型、长度或控制字符无效。');return value.replace(/\r\n?/gu,'\n').trim();};
const current=(library,language,field)=>shared.has(field)?library.person[field]:library.person[language][field];
function checkLanguage(language){if(!['zh','en'].includes(language))throw Error('导入语言无效。');}
export function parseResumeText(input,{language='zh',library,fileName='粘贴的文字'}={}){
 checkLanguage(language);const sourceText=clean(input);if(!sourceText)throw Error('没有可整理的文字，请先选择文件或粘贴简历。');if(library)validateLibrary(library);
 const review={language,fileName:clean(fileName,240),sourceText,person:[],entries:[],warnings:['本机分类仅供参考，请对照源文核对；未识别的信息保留为正文。重复导入会新增经历。']};
 let category='other',paragraph=[],hasSection=false;
 const flush=()=>{if(!paragraph.length)return;const source=paragraph.join('\n'),split=hasSection&&paragraph.length>1&&paragraph[0].length<=200,title=split?paragraph[0]:hasSection?paragraph[0].slice(0,200):language==='zh'?'待分类的简历内容':'Imported resume text',body=split?paragraph.slice(1).join('\n'):source;
  const duplicate=library?.entries.some(e=>e.category===category&&e[language]?.title===title&&e[language]?.body===body);
  review.entries.push({candidateId:'import-'+review.entries.length,category,title,subtitle:'',period:'',body,source,selected:!duplicate,duplicate:Boolean(duplicate)});paragraph=[];
  if(review.entries.length>100)throw Error('候选段落过多，请分批粘贴或先精简文档。');
 };
 for(const raw of sourceText.split('\n')){
  const line=raw.trim();if(!line){flush();continue;}
  const heading=line.replace(/\s*[:：]\s*$/u,'').replace(/^[\d一二三四五六七八九十]+[.、)）]\s*/u,'');
  const section=Object.entries(headings).find(([,pattern])=>pattern.test(heading));
  if(section){flush();category=section[0];hasSection=true;continue;}
  let match;if(!hasSection){const found=fields.find(field=>{match=line.match(labels[field]);return match&&match[1].length<=2000&&!review.person.some(row=>row.field===field);});if(found){const value=match[1].trim(),before=library?current(library,language,found):'';review.person.push({field:found,value,source:raw,before,replace:false,selected:!before});continue;}}
  paragraph.push(raw);
 }
 flush();return review;
}
export function mergeConfirmedImport(library,review){
 validateLibrary(library);checkLanguage(review?.language);if(!Array.isArray(review.person)||review.person.length>6||!Array.isArray(review.entries)||review.entries.length>100)throw Error('导入确认内容无效。');
 const next=structuredClone(library),seen=new Set();let selected=0;
 for(const row of review.person){if(!row||!fields.includes(row.field)||seen.has(row.field))throw Error('个人信息字段无效。');seen.add(row.field);const value=clean(row.value,2000);if(row.selected!==true)continue;
  const before=current(next,review.language,row.field);if(before!==row.before)throw Error('个人信息在核对期间发生变化，请重新整理后确认。');
  if(before&&before!==value&&!row.replace)throw Error('替换已有个人信息需要明确勾选覆盖。');
  if(shared.has(row.field))next.person[row.field]=value;else {
   next.person[review.language][row.field]=value;
   // Import is an explicit local-language save too. Shared contacts and an
   // unchanged value must not manufacture or clear translation review state.
   if(value!==before){next.person.stale||={zh:false,en:false};next.person.stale[review.language]=false;next.person.stale[review.language==='zh'?'en':'zh']=true;}
  }selected++;
 }
 for(const row of review.entries){if(!row||!categories.has(row.category))throw Error('经历分类无效。');if(row.selected!==true)continue;
  const entry=createEntry({title:clean(row.title,2000),category:row.category,language:review.language});entry[review.language].subtitle=clean(row.subtitle,5000);entry[review.language].body=clean(row.body);setPeriod(entry,review.language,clean(row.period,500));entry.stale[review.language==='zh'?'en':'zh']=true;next.entries.push(entry);selected++;
 }
 if(!selected)throw Error('请至少勾选一项要导入的内容。');validateLibrary(next);return next;
}
