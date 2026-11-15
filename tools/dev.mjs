import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = path.join(projectRoot, 'work', 'runtime', 'electron', 'electron.exe');
const lock = JSON.parse(await readFile(path.join(projectRoot, 'tools', 'runtime-lock.json'), 'utf8'));
try {
  await access(executable);
  const actualVersion = (await readFile(path.join(path.dirname(executable), 'version'), 'utf8')).trim();
  if (actualVersion !== lock.version) throw new Error('运行时版本与锁定版本不一致。');
} catch (error) {
  console.error(`${error.message}\n请先运行 powershell -NoProfile -ExecutionPolicy Bypass -File tools/setup-runtime.ps1`);
  process.exit(1);
}
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [projectRoot, ...process.argv.slice(2)], {
  cwd: projectRoot,
  stdio: 'inherit',
  windowsHide: true,
  env: environment,
});
child.on('error', error => {
  console.error(`无法启动ITS ME：${error.message}`);
  process.exitCode = 1;
});
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
