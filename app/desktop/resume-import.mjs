// Native picker supplies the only file path; this module does not write to the library.
import {open,lstat} from 'node:fs/promises';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
export const RESUME_IMPORT_LIMITS=Object.freeze({fileBytes:16*1024*1024,textCharacters:200000,pdfPages:50,archiveBytes:32*1024*1024,archiveEntries:1024,timeoutMs:15000});
function publicError(message){return Error(message);}
export async function extractResumeText(filePath,{timeoutMs=RESUME_IMPORT_LIMITS.timeoutMs,signal}={}){
 if(typeof filePath!=='string'||!path.isAbsolute(filePath))throw publicError('请选择本机简历文件。');
 const extension=path.extname(filePath).toLowerCase();if(!['.txt','.docx','.pdf'].includes(extension))throw publicError('支持 TXT、DOCX 和有文字的 PDF；旧版 DOC 请另存为 DOCX。');
 if(signal?.aborted)throw publicError('已取消简历提取。');
 let handle;try{
  const before=await lstat(filePath);if(!before.isFile()||before.isSymbolicLink()||before.size<=0||before.size>RESUME_IMPORT_LIMITS.fileBytes)throw publicError('简历文件必须是普通文件，大小需在 1 字节到 16 MB 之间。');
  handle=await open(filePath,'r');const opened=await handle.stat();if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size||opened.mtimeMs!==before.mtimeMs)throw publicError('文件在读取时发生变化，请重新选择。');
  const data=Buffer.alloc(before.size);let offset=0;while(offset<data.length){const {bytesRead}=await handle.read(data,offset,data.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}const extra=Buffer.alloc(1),tail=await handle.read(extra,0,1,before.size),after=await handle.stat();if(offset!==before.size||tail.bytesRead||after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw publicError('文件在读取时发生变化，请重新选择。');
  const payload=Uint8Array.from(data);
  const result=await new Promise((resolve,reject)=>{
   let settled=false;const worker=new Worker(new URL('./resume-import-worker.mjs',import.meta.url),{workerData:{extension,bytes:payload,limits:RESUME_IMPORT_LIMITS},transferList:[payload.buffer],resourceLimits:{maxOldGenerationSizeMb:192,maxYoungGenerationSizeMb:32,stackSizeMb:4}});
   const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate();if(error)reject(error);else resolve(value);};
   const abort=()=>done(publicError('已取消简历提取。'));
   const timer=setTimeout(()=>done(publicError('简历文字提取超时，已停止处理。请简化文档或改为粘贴文字。')),Math.max(1,Math.min(timeoutMs,RESUME_IMPORT_LIMITS.timeoutMs)));
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   worker.once('message',message=>{if(!message||message.ok!==true)return done(publicError(typeof message?.error==='string'?message.error:'未能提取简历文字。'));const value=message.result;if(typeof value?.text!=='string'||value.text.length>RESUME_IMPORT_LIMITS.textCharacters||!Array.isArray(value.warnings)||value.warnings.some(v=>typeof v!=='string'||v.length>500))return done(publicError('提取结果超出允许范围。'));if(value.pages!==undefined&&(!Array.isArray(value.pages)||value.pages.length>RESUME_IMPORT_LIMITS.pdfPages||value.pages.some((p,i)=>p.page!==i+1||typeof p.text!=='string'||p.text.length>RESUME_IMPORT_LIMITS.textCharacters)))return done(publicError('PDF分页文字无效。'));done(null,value);});
   worker.once('error',()=>done(publicError('文字处理未完成，已安全停止。请改用 TXT 或粘贴文字。')));worker.once('exit',()=>{if(!settled)done(publicError('文字处理已停止，请改用 TXT 或粘贴文字。'));});
  });
  return {fileName:path.basename(filePath).slice(0,240),...result};
 }catch(error){if(error?.code)throw publicError('文件无法读取，请检查文件是否仍存在且可访问。');throw error;}
 finally{await handle?.close();}
}

