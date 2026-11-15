// One writer per canonical library directory in the current Windows session.
// The OS owns the named mutex; a crashed process/closed pipe releases it.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
// Only capabilities issued in this main process can use the crash-safe OS lock.
// Standalone Store callers must not write concurrently with a desktop session.
const sessions=new WeakMap();
function checkedSession(capability,directory){
 const state=capability&&typeof capability==='object'?sessions.get(capability):null;
 if(!state||!state.live||typeof directory!=='string'||!path.isAbsolute(directory)||path.resolve(directory).toLowerCase()!==state.directory)throw Error('资料库独占会话无效或已结束，未开始资料写入。');
 return state;
}
export function assertLibrarySession(capability,directory){checkedSession(capability,directory);}
export function runWithLibrarySession(capability,directory,operation){
 const state=checkedSession(capability,directory);
 if(!state.accepting)throw Error('资料库会话正在结束，未接纳新的资料操作。');
 if(typeof operation!=='function')throw Error('资料库操作无效。');
 const task=state.queue.then(async()=>{
  if(!state.live)throw Error('资料库独占保护已中断，未开始资料写入。');
  const result=await operation();
  if(!state.live)throw Error('资料库独占保护已中断，请重新打开软件核对资料。');
  return result;
 });
 state.queue=task.catch(()=>{});return task;
}
export async function acquireLibrarySession({directory,onLost=()=>{},timeoutMs=12000}={}){
 if(process.platform!=='win32')throw Error('当前资料库互斥保护只支持 Windows。');
 if(typeof directory!=='string'||!path.isAbsolute(directory)||typeof onLost!=='function')throw Error('资料库保护参数无效。');
 const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('资料库目录无效，未开始写入。');
 const canonical=(await realpath(directory)).toLowerCase(),scope=createHash('sha256').update(canonical).digest('hex');
 const script="$ErrorActionPreference='Stop'; $m=[Threading.Mutex]::new($false,'Local\\ITS-ME-library-"+scope+"'); $held=$false; try { try { $held=$m.WaitOne(0) } catch [Threading.AbandonedMutexException] { $held=$true }; if(-not $held){ [Console]::Out.WriteLine('BUSY'); [Console]::Out.Flush(); exit 9 }; [Console]::Out.WriteLine('READY'); [Console]::Out.Flush(); [void][Console]::In.ReadLine() } finally { if($held){ $m.ReleaseMutex() }; $m.Dispose() }";
 const executable=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 const child=spawn(executable,['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let ready=false,released=false,settled=false,output='',resolveExit,sessionState,releasePromise;const exited=new Promise(r=>resolveExit=r);child.stderr.resume();child.stdin.on('error',()=>{});
 return new Promise((resolve,reject)=>{
  const fail=message=>{if(!settled){settled=true;clearTimeout(timer);released=true;child.stdin.end();child.kill();reject(Error(message));}};
  const timer=setTimeout(()=>fail('资料库保护未能启动，请关闭其它窗口后重试；原资料保留。'),timeoutMs);
  child.stdout.on('data',chunk=>{
   if(settled)return;output+=chunk.toString('utf8');
   if(output.length>1024)return fail('资料库保护返回无效结果，未开始写入。');
   if(output.includes('BUSY'))return fail('这份资料库已在另一个 ITS ME 窗口使用。请先关闭该窗口，再打开。');
   if(output.includes('READY')){
    settled=true;ready=true;clearTimeout(timer);
    const capability={helperPid:child.pid,release(){
     if(releasePromise)return releasePromise;
     sessionState.accepting=false;
     releasePromise=(async()=>{await sessionState.queue;const alreadyExited=released;released=true;sessionState.live=false;if(!alreadyExited&&!child.stdin.destroyed)child.stdin.end('release\n');const timeout=setTimeout(()=>child.kill(),2500);await exited;clearTimeout(timeout);})();
     return releasePromise;
    }};
    sessionState={directory:canonical,live:true,accepting:true,queue:Promise.resolve()};sessions.set(capability,sessionState);resolve(capability);
   }
  });
  child.once('error',()=>fail('资料库保护未能启动，未开始写入。'));
  child.once('exit',()=>{
   resolveExit();
   if(sessionState){sessionState.live=false;sessionState.accepting=false;}
   if(ready&&!released){released=true;try{onLost();}catch{}}
   else if(!settled)fail('资料库保护未能启动，请重新打开软件。');
  });
 });
}
