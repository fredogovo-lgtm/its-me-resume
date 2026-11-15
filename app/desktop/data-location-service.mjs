// Coordinates a library move, including its authorization. Profile and AI credentials stay local.
const READ_ONLY = new Set(['appInfo','dataLocationStatus','licenseStatus','softwareUpdateStatus','aiStatus','aiRulesStatus']);
const PREPARE_WRITES = new Set(['saveProject','saveLibrary','aiRulesConfigure']);
export class DataLocationService {
  #options; #phase='idle';
  constructor(options) { this.#options=options; }
  get busy() { return this.#phase!=='idle'; }
  allows(name) { return !this.busy || READ_ONLY.has(name) || this.#phase==='cleanup' && name==='load' || this.#phase==='prepare' && PREPARE_WRITES.has(name); }
  status() {
    const location=this.#options.location;
    const cleanup=this.#options.cleanupStatus?.()??{state:'none',sourceDirectory:'',remainingFiles:0,notice:'',canRetry:false};
    return {dataDirectory:location.dataDirectory,runtimeDirectory:location.runtimeDirectory,customDataDirectory:location.customDataDirectory,isOverride:location.isOverride,busy:this.busy,canChange:!location.isOverride&&!this.busy&&!['pending','blocked'].includes(cleanup.state),cleanup};
  }
  async startupCleanup(openWindow) {
    if(this.busy||typeof openWindow!=='function')throw Error('资料清理启动状态无效。');
    this.#phase='cleanup';
    try { await openWindow();await this.#options.drain?.();return await this.#options.cleanup?.(); }
    finally { this.#phase='idle'; }
  }
  async retryCleanup() {
    const o=this.#options;
    if(o.location.isOverride)throw Error('测试启动参数不能清理普通资料目录。');
    if(this.busy||o.isBusy?.())throw Error('请先结束其它资料操作，再重试清理旧资料。');
    if(typeof o.cleanup!=='function')throw Error('当前版本不支持重试清理旧资料。');
    this.#phase='cleanup';
    try { await o.drain?.();return await o.cleanup(); }
    finally { this.#phase='idle'; }
  }
  async change() {
    const o=this.#options;
    if(o.location.isOverride)throw Error('此窗口使用测试启动参数指定资料目录。请从普通快捷方式打开软件后更改资料位置。');
    if(this.busy||o.isBusy?.())throw Error('请先结束导出、AI、更新或其它资料操作，再更改目录。');
    if(['pending','blocked'].includes(o.cleanupStatus?.()?.state))throw Error('旧资料副本尚未清理，请先重试清理或核对保留的资料后再迁移。');
    this.#phase='prepare';let handoff=false,prepared=false;
    try {
      const targetDirectory=await o.choose();
      if(!targetDirectory)return {canceled:true};
      await o.inspect(targetDirectory);
      if(!await o.confirm(targetDirectory))return {canceled:true};
      prepared=true;
      if(!await o.prepare())return {canceled:true};
      this.#phase='copy';
      await o.drain?.();
      await o.flush?.();
      const migration=await o.migrate(targetDirectory);
      try { await o.restart(); }
      catch(error) {
        try { await migration.rollback(); }
        catch {
          this.#phase='committed';handoff=true;
          await o.requireRestart?.();
          return {handoff:true,restartRequired:true};
        }
        throw Error('资料已复制，但软件未能重启。已恢复原目录选择；请稍后重试。',{cause:error});
      }
      this.#phase='committed';handoff=true;
      return {handoff:true};
    } catch(error) {
      if(error?.requiresRestart===true) {
        this.#phase='committed';handoff=true;
        await o.requireRestart?.();
        return {handoff:true,restartRequired:true};
      }
      throw error;
    } finally {
      if(!handoff) { this.#phase='idle';if(prepared)await o.resumeEditing?.(); }
    }
  }
}
