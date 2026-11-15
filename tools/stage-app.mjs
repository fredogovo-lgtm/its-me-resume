// Prepare the app and its production dependencies for either Windows package.
import { access, cp, mkdir, readFile, rename } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');

export async function prepareApplication({output} = {}) {
  const dest = path.resolve(output || path.join(root, 'work/production-app'));
  if (!dest.startsWith(path.join(root, 'work') + path.sep)) throw Error('暂存目录必须位于项目 work 中。');
  const policy = JSON.parse(await readFile(path.join(root, 'app/desktop/license-policy.json'), 'utf8'));
  if (policy.mode !== 'free' || !Array.isArray(policy.keys) || policy.keys.length || Object.keys(policy).length !== 2) {
    throw Error('此构建需要免费版发布策略。');
  }
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !path.isAbsolute(npmCli)) throw Error('请从项目目录运行 npm run installer 或 npm run package。');
  await access(npmCli);
  try {
    await access(dest);
    await rename(dest, dest + '-previous-' + Date.now());
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(dest, {recursive: true});
  await cp(path.join(root, 'app'), path.join(dest, 'app'), {recursive: true});
  for (const name of ['package.json', 'package-lock.json']) {
    await cp(path.join(root, name), path.join(dest, name));
  }
  const result = spawnSync(process.execPath, [
    npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', dest
  ], {cwd: root, windowsHide: true, stdio: ['ignore', 2, 2]});
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('生产依赖安装失败。');
  return dest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const output = process.argv.slice(2).find(value => value.startsWith('--out='))?.slice(6);
  console.log(await prepareApplication({output}));
}
