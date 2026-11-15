import test from 'node:test';
import assert from 'node:assert/strict';
import {isStartupLocationFailure,requestStartupDataRecovery} from '../app/desktop/startup-recovery.mjs';
const failure=()=>Error('资料目录迁移：资料位置配置或资料目录无效；未创建空资料库。');
const candidate={token:'verified-original-token',dataDirectory:'D:/fictional-library',runtimeDirectory:'D:/original/runtime',draftScopeDirectory:'D:/original'};
function harness({candidates=[candidate],canChoose=true,choices=[],folders=[],inspectError=false,directoryError=false,recoverError=false,claim,result={location:{dataDirectory:candidate.dataDirectory}}}={}){
 const events=[];let inspected=0;
 const service={async inspect(){events.push(['inspect']);if(inspectError&&++inspected===1)throw Error('unavailable');return{candidates,canChooseDirectory:canChoose,notices:[]};},async inspectDirectory(directory){events.push(['directory',directory]);if(directoryError)throw Error('unverified');return {...candidate,token:'selected-verified-token',dataDirectory:directory};},async recover(value){events.push(['recover',value]);if(recoverError)throw Error('busy or changed');return result;}};
 const dialog={async showMessageBox(options){events.push(['message',options]);const wanted=choices.shift();assert.ok(wanted,'Unexpected dialog');const index=options.buttons.indexOf(wanted);assert.ok(index>=0,JSON.stringify({wanted,buttons:options.buttons}));return{response:index};},async showOpenDialog(options){events.push(['folder-dialog',options]);return folders.shift()||{canceled:true,filePaths:[]};}};
 return {events,run:error=>requestStartupDataRecovery({error:error||failure(),appDataDirectory:'D:/fictional-appdata',installDirectory:'D:/fictional-program',dialog,createRecovery:()=>service,claimRuntime:claim?async runtime=>{events.push(['claim',runtime]);return claim(runtime);}:undefined})};
}
test('only data-location startup failures enter recovery; ordinary startup errors are not redirected',async()=>{
 assert.equal(isStartupLocationFailure(Error('资料目录迁移：wrong pointer')),true);assert.equal(isStartupLocationFailure(Error('permission error')),false);
 let called=false;const result=await requestStartupDataRecovery({error:Error('store failure'),createRecovery:()=>{called=true;throw Error('must not inspect');}});assert.deepEqual(result,{handled:false});assert.equal(called,false);
});
test('exit never selects or writes any library; default and cancel both mean exit',async()=>{
 const h=harness({choices:['退出']});assert.deepEqual(await h.run(),{handled:true,recovered:false,canceled:true});assert.equal(h.events.filter(x=>x[0]==='recover').length,0);const options=h.events.find(x=>x[0]==='message')[1];assert.equal(options.buttons[options.defaultId],'退出');assert.equal(options.buttons[options.cancelId],'退出');
});
test('reconnection requires a second explicit confirmation and preserves verified token',async()=>{
 const h=harness({choices:['重新连接资料库','确认连接并重启']});const r=await h.run();assert.equal(r.recovered,true);assert.deepEqual(h.events.find(x=>x[0]==='recover')[1],{token:candidate.token,confirmed:true});const confirm=h.events.filter(x=>x[0]==='message')[1][1];assert.ok(confirm.detail.includes(candidate.dataDirectory));assert.equal(confirm.buttons[confirm.defaultId],'取消');
});
test('canceling final confirmation never invokes recovery writes',async()=>{
 const h=harness({choices:['重新连接资料库','取消']});assert.equal((await h.run()).canceled,true);assert.equal(h.events.filter(x=>x[0]==='recover').length,0);
});
test('canceling directory chooser returns to selection without writes',async()=>{
 const h=harness({choices:['选择原资料库文件夹','退出'],folders:[{canceled:true,filePaths:[]}]});assert.equal((await h.run()).canceled,true);assert.equal(h.events.filter(x=>x[0]==='directory'||x[0]==='recover').length,0);
});
test('unverified directory is rejected rather than treated as a fresh empty library',async()=>{
 const h=harness({choices:['选择原资料库文件夹','退出'],folders:[{canceled:false,filePaths:['D:/unverified']}],directoryError:true});assert.equal((await h.run()).canceled,true);assert.equal(h.events.filter(x=>x[0]==='recover').length,0);assert.match(h.events.filter(x=>x[0]==='message')[1][1].detail,/无法与原位置记录核对/);
});
test('multiple candidates are not auto-selected; chosen candidate token is used',async()=>{
 const h=harness({candidates:[candidate,{...candidate,token:'second',dataDirectory:'D:/other'}],choices:['选择原资料库文件夹','确认连接并重启'],folders:[{canceled:false,filePaths:['D:/other']}]});assert.equal((await h.run()).recovered,true);assert.deepEqual(h.events.find(x=>x[0]==='recover')[1],{token:'selected-verified-token',confirmed:true});assert.equal(h.events.find(x=>x[0]==='message')[1].buttons.includes('重新连接资料库'),false);
});
test('a busy or changed library is shown as a failure with no automatic write retry',async()=>{
 const h=harness({choices:['重新连接资料库','确认连接并重启','退出'],recoverError:true});assert.equal((await h.run()).canceled,true);assert.equal(h.events.filter(x=>x[0]==='recover').length,1);assert.match(h.events.filter(x=>x[0]==='message').at(-1)[1].detail,/连接未完成/);
});
test('failed inspection does not offer an unverified directory; explicit recheck can then connect',async()=>{
 const h=harness({choices:['重新检测','重新连接资料库','确认连接并重启'],inspectError:true});assert.equal((await h.run()).recovered,true);const first=h.events.find(x=>x[0]==='message')[1];assert.deepEqual(first.buttons,['重新检测','退出']);assert.equal(h.events.filter(x=>x[0]==='recover').length,1);
});
test('service-level canceled result never claims reconnection succeeded',async()=>{
 const h=harness({choices:['重新连接资料库','确认连接并重启'],result:{canceled:true}});assert.deepEqual(await h.run(),{handled:true,recovered:false,canceled:true});
});
test('invalid candidate token is rejected before writes',async()=>{
 const h=harness({candidates:[{...candidate,token:''}],choices:['重新连接资料库','退出']});assert.equal((await h.run()).canceled,true);assert.equal(h.events.filter(x=>x[0]==='recover').length,0);
});

test('an existing instance using the verified original profile cancels before showing recovery dialogs',async()=>{
 const h=harness({claim:async()=>false});const result=await h.run();assert.equal(result.alreadyRunning,true);assert.equal(result.recovered,false);assert.equal(h.events.filter(x=>x[0]==='message'||x[0]==='recover').length,0);assert.deepEqual(h.events.find(x=>x[0]==='claim'),['claim',candidate.runtimeDirectory]);
});
test('ambiguous same-library paths can explicitly select a verified runtime anchor without folder guessing',async()=>{
 const second={...candidate,token:'other-runtime-token',runtimeDirectory:'D:/other-original/runtime'};
 const h=harness({candidates:[candidate,second],choices:['选择检测到的资料库','位置 2','确认连接并重启']});const result=await h.run();assert.equal(result.recovered,true);assert.deepEqual(h.events.find(x=>x[0]==='recover')[1],{token:'other-runtime-token',confirmed:true});assert.equal(h.events.filter(x=>x[0]==='directory').length,0);
});
