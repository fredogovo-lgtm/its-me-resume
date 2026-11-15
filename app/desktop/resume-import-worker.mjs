import {parentPort,workerData} from 'node:worker_threads';
import {inflateRawSync} from 'node:zlib';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import http from 'node:http';
import https from 'node:https';
const {extension,limits}=workerData,bytes=Buffer.from(workerData.bytes);
// No external resources are needed for text extraction. Reject any attempted fetch.
const deny=()=>{throw Error('IMPORT_EXTERNAL_RESOURCE');};globalThis.fetch=deny;http.request=http.get=https.request=https.get=deny;syncBuiltinESMExports();
function text(value){const normalized=value.replace(/\r\n?/gu,'\n').replace(/\f/gu,'\n').replace(/[\u0000-\u0008\u000b\u000e-\u001f]/gu,'').trim();if(normalized.length>limits.textCharacters)throw Error('简历文字超过 20 万字，请分批导入。');return normalized;}
function readTxt(){let encoding='utf-8',start=0;if(bytes[0]===255&&bytes[1]===254){encoding='utf-16le';start=2;}else if(bytes[0]===254&&bytes[1]===255){encoding='utf-16be';start=2;}else if(bytes[0]===239&&bytes[1]===187&&bytes[2]===191)start=3;let value;try{value=new TextDecoder(encoding,{fatal:true}).decode(bytes.subarray(start));}catch{throw Error('TXT 编码无法识别，请另存为 UTF-8 或带 BOM 的 UTF-16 后导入。');}if(/[\u0000-\u0008\u000b\u000e-\u001f]/u.test(value))throw Error('TXT 包含二进制或不支持的控制字符，请改为粘贴文字。');return {text:text(value),warnings:[]};}
function inspectDocx(){
 let end=-1;for(let offset=bytes.length-22;offset>=Math.max(0,bytes.length-65557);offset--)if(bytes.readUInt32LE(offset)===0x06054b50&&offset+22+bytes.readUInt16LE(offset+20)===bytes.length){end=offset;break;}
 if(end<0)throw Error('DOCX 文件损坏或格式不受支持。');
 const count=bytes.readUInt16LE(end+10),centralSize=bytes.readUInt32LE(end+12),central=bytes.readUInt32LE(end+16);
 if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+8)!==count||count>limits.archiveEntries||central+centralSize!==end||count===65535)throw Error('DOCX 压缩结构或文件数量超出限制。');
 let offset=central,total=0;const names=new Set();
 for(let i=0;i<count;i++){
  if(offset+46>end||bytes.readUInt32LE(offset)!==0x02014b50)throw Error('DOCX 压缩目录损坏。');
  const flags=bytes.readUInt16LE(offset+8),method=bytes.readUInt16LE(offset+10),compressed=bytes.readUInt32LE(offset+20),size=bytes.readUInt32LE(offset+24),nameSize=bytes.readUInt16LE(offset+28),extra=bytes.readUInt16LE(offset+30),comment=bytes.readUInt16LE(offset+32),local=bytes.readUInt32LE(offset+42);
  if(offset+46+nameSize+extra+comment>end)throw Error('DOCX 压缩目录损坏。');const name=bytes.subarray(offset+46,offset+46+nameSize).toString('utf8');offset+=46+nameSize+extra+comment;
  if(flags&1||![0,8].includes(method)||size===0xffffffff||compressed===0xffffffff||local+30>central||bytes.readUInt32LE(local)!==0x04034b50||names.has(name)||/[\\\u0000]/u.test(name)||name.startsWith('/')||name.split('/').includes('..'))throw Error('DOCX 包含不支持或不安全的压缩结构。');names.add(name);
  if(/(?:vbaProject|activeX|embeddings\/.*(?:\.exe|\.bin)$)/iu.test(name))throw Error('DOCX 包含宏或嵌入程序，请另存为纯文字文档后导入。');
  total+=size;if(total>limits.archiveBytes||size>limits.archiveBytes||size>Math.max(1024*1024,compressed*200))throw Error('DOCX 解压内容过大，请精简后导入。');
  const localNameSize=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28),data=local+30+localNameSize+localExtra;
  if(data+compressed>central||bytes.readUInt16LE(local+6)!==flags||bytes.readUInt16LE(local+8)!==method||bytes.subarray(local+30,local+30+localNameSize).toString('utf8')!==name)throw Error('DOCX 压缩条目不一致。');
  let inflated;try{inflated=method===0?bytes.subarray(data,data+compressed):inflateRawSync(bytes.subarray(data,data+compressed),{maxOutputLength:Math.max(1,Math.min(size+1,limits.archiveBytes))});}catch{throw Error('DOCX 解压失败或内容超出限制。');}if(inflated.length!==size)throw Error('DOCX 解压长度不一致。');
  if(/\.(?:xml|rels)$/iu.test(name)&&/<!\s*(?:DOCTYPE|ENTITY)/iu.test(inflated.toString('utf8')))throw Error('DOCX 包含不支持的 XML 实体，请另存为纯文字文档。');
 }
 if(offset!==end||!names.has('word/document.xml')||!names.has('[Content_Types].xml'))throw Error('文件不是可读取的 DOCX 文档。');
}
async function readDocx(){inspectDocx();const mammoth=createRequire(import.meta.url)('mammoth');const result=await mammoth.extractRawText({buffer:bytes});return {text:text(result.value),warnings:['仅提取 DOCX 正文文字；图片、排版、批注和部分特殊对象可能未包含，请对照原文件核对。']};}
async function readPdf(){
 if(bytes.subarray(0,5).toString()!=='%PDF-')throw Error('PDF 文件损坏或格式不受支持。');
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:Uint8Array.from(bytes),disableFontFace:true,useSystemFonts:false,isEvalSupported:false,useWorkerFetch:false,disableAutoFetch:true,disableStream:true,useWasm:false,isImageDecoderSupported:false,isOffscreenCanvasSupported:false,stopAtErrors:true,verbosity:0});
 let pdf;try{pdf=await task.promise;if(pdf.numPages>limits.pdfPages)throw Error('PDF 页数超过 50 页，请仅保留简历页面后导入。');const pages=[];let length=0;
  for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){const page=await pdf.getPage(pageNumber),content=await page.getTextContent();let value='';for(const item of content.items)if(typeof item.str==='string'){value+=item.str+(item.hasEOL?'\n':' ');length+=item.str.length+1;if(length>limits.textCharacters)throw Error('简历文字超过 20 万字，请分批导入。');}pages.push(value.trim());page.cleanup();}
  const value=text(pages.join('\n\n')),warnings=['PDF 文字顺序可能与视觉排版不同，尤其是分栏或表格；请对照原文件核对。'];if(!value)warnings.push('未提取到文字，可能是扫描图片或文字已转曲。本版本不做 OCR，请手动粘贴文字。');return {text:value,warnings,pages:pages.map((text,index)=>({page:index+1,text}))};
 }catch(error){if(error?.name==='PasswordException')throw Error('PDF 已加密或需要密码，请先另存为未加密 PDF。');if(/页数|20 万字/u.test(error?.message||''))throw error;throw Error('PDF 无法解析，可能已损坏或加密。请另存 PDF 或粘贴文字。');}
 finally{await task.destroy().catch(()=>{});}
}
try{const result=extension==='.txt'?readTxt():extension==='.docx'?await readDocx():await readPdf();parentPort.postMessage({ok:true,result});}
catch(error){const message=typeof error?.message==='string'&&/^(?:TXT |DOCX |PDF |简历|文件不是)/u.test(error.message)?error.message:'未能提取简历文字，请另存为 TXT 或手动粘贴文字。';parentPort.postMessage({ok:false,error:message});}


