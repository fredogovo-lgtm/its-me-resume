import {DataLocationRecovery} from './data-location-recovery.mjs';

export function isStartupLocationFailure(error) {
  return typeof error?.message === 'string' && error.message.startsWith('资料目录迁移：');
}
const short = value => typeof value === 'string' ? value.slice(0,1000) : '';
const canceled = () => ({handled:true,recovered:false,canceled:true});

/** Native dialogs only. No BrowserWindow, Store, runtime initialization or credentials. */
export async function requestStartupDataRecovery({error,appDataDirectory,installDirectory,dialog,
  createRecovery=options=>new DataLocationRecovery(options),claimRuntime=async()=>true}={}) {
  if(!isStartupLocationFailure(error))return {handled:false};
  const recovery=createRecovery({appDataDirectory,installDirectory});
  let warning='',claimedRuntime='';
  const claim=async candidate=>{if(claimedRuntime===candidate.runtimeDirectory)return true;if(!await claimRuntime(candidate.runtimeDirectory))return false;claimedRuntime=candidate.runtimeDirectory;return true;};
  for(;;){
    let overview;
    try { overview=await recovery.inspect(); }
    catch { overview={candidates:[],canChooseDirectory:false,notices:['暂时无法核验原资料位置，请保留原资料后重试。']}; }
    const candidates=Array.isArray(overview.candidates)?overview.candidates:[];
    const unique=candidates.length===1?candidates[0]:null;
    if(unique&&!await claim(unique))return {...canceled(),alreadyRunning:true};
    const actions=[];
    if(candidates.length>1)actions.push(['选择检测到的资料库','candidates']);
    if(unique)actions.push(['重新连接资料库','connect']);
    if(overview.canChooseDirectory)actions.push(['选择原资料库文件夹','choose']);
    actions.push(['重新检测','retry'],['退出','exit']);
    const paths=candidates.slice(0,5).map(item=>short(item.dataDirectory)).filter(Boolean);
    const notices=(Array.isArray(overview.notices)?overview.notices:[]).slice(0,3).map(short).filter(Boolean);
    const detail=[warning,paths.length?'检测到的资料位置：\n'+paths.join('\n'):'未找到可直接连接的原资料位置。',
      ...notices,'软件没有新建空库或覆盖原资料。请选择原来的资料库，核对后重新连接。'].filter(Boolean).join('\n\n');
    const choice=await dialog.showMessageBox({type:'warning',title:'重新连接资料库',
      message:'ITS ME 暂时无法连接原资料库',detail,buttons:actions.map(item=>item[0]),
      defaultId:actions.length-1,cancelId:actions.length-1,noLink:true});
    const action=actions[choice.response]?.[1]||'exit';
    if(action==='exit')return canceled();
    if(action==='retry'){warning='';continue;}
    let candidate=unique;
    if(action==='candidates'){
      const selected=await dialog.showMessageBox({type:'question',title:'选择检测到的资料库',message:'检测到多条原位置记录，请明确选择',
        detail:candidates.map((item,index)=>'位置 '+(index+1)+'：'+short(item.dataDirectory)+'\n原本机设置：'+short(item.runtimeDirectory)).join('\n\n'),
        buttons:[...candidates.map((_item,index)=>'位置 '+(index+1)),'取消'],defaultId:candidates.length,cancelId:candidates.length,noLink:true});
      if(!Number.isInteger(selected.response)||selected.response<0||selected.response>=candidates.length)continue;
      candidate=candidates[selected.response];
    }
    if(action==='choose'){
      const picked=await dialog.showOpenDialog({title:'选择原资料库文件夹',buttonLabel:'核对这个资料库',
        ...(unique?.dataDirectory?{defaultPath:unique.dataDirectory}:{}),properties:['openDirectory','dontAddToRecent']});
      if(picked.canceled||!picked.filePaths?.[0])continue;
      try { candidate=await recovery.inspectDirectory(picked.filePaths[0]); }
      catch { warning='选定文件夹无法与原位置记录核对，或资料不完整。请保留原文件并重新选择。';continue; }
    }
    if(!candidate?.token){warning='资料位置已变化，请重新检测后再连接。';continue;}
    if(!await claim(candidate))return {...canceled(),alreadyRunning:true};
    const confirmed=await dialog.showMessageBox({type:'question',title:'确认重新连接资料库',
      message:'重新连接这份已有资料库？',
      detail:short(candidate.dataDirectory)+'\n\n现有资料已通过核验。只修复位置记录，不移动或删除资料；沿用原来的本机设置。完成后软件会重新启动。损坏的位置记录会另存保留。',
      buttons:['取消','确认连接并重启'],defaultId:0,cancelId:0,noLink:true});
    if(confirmed.response!==1)return canceled();
    try {
      const result=await recovery.recover({token:candidate.token,confirmed:true});
      if(result.canceled)return canceled();
      return {handled:true,recovered:true,location:result.location,rescueFileName:result.rescueFileName||''};
    } catch {
      warning='连接未完成：资料可能正在使用，或文件／位置记录在核验后发生了变化。原资料保留，请关闭其他 ITS ME 窗口后重新检测。';
    }
  }
}
