import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { build } from 'electron-builder';
import { prepareApplication } from './stage-app.mjs';
import { generateCustomerGuides, copyCustomerGuides } from './customer-guides.mjs';

const root = path.resolve(import.meta.dirname, '..');
const lock = JSON.parse(await readFile(path.join(root, 'tools/runtime-lock.json'), 'utf8'));
const source = await prepareApplication({output: path.join(root, 'work/installer-stage-production')});
const {version} = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/u.test(version)) throw Error('无效的版本号。');
const guideSource = path.join(source, 'docs');
await generateCustomerGuides({projectRoot: root, applicationDirectory: source, outputDirectory: guideSource});
const destination = path.join(root, 'outputs/内测', 'ITS ME-' + version + '-Windows安装包');
try {
  await access(destination);
  await rename(destination, destination + '-previous-' + Date.now());
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(destination, {recursive: true});
const appId = 'com.itsme.resume';
await build({projectDir: root, config: {
  appId, productName: 'ITS ME', electronVersion: lock.version, electronDist: path.join(root, 'work/runtime/electron'),
  directories: {app: source, output: destination}, files: ['app/**/*', 'package.json'],
  extraFiles: [{from: guideSource, to: '客户说明', filter: ['**/*']}], asar: true, compression: 'normal', publish: null,
  win: {icon: path.join(root, 'app/assets/itsme.ico'), target: [{target: 'nsis', arch: ['x64']}],
    executableName: 'ITS ME', artifactName: 'ITS-ME-${version}-Setup.${ext}', requestedExecutionLevel: 'asInvoker'},
  nsis: {include: path.join(root, 'tools/installer-uninstall.nsh'), oneClick: false, perMachine: false,
    allowElevation: false, packElevateHelper: false, allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true, createStartMenuShortcut: true, deleteAppDataOnUninstall: false,
    runAfterFinish: true, uninstallDisplayName: 'ITS ME', differentialPackage: false}
}});
await copyCustomerGuides({projectRoot: root, sourceDirectory: guideSource, outputDirectory: path.join(destination, '客户说明')});
const installer = 'ITS-ME-' + version + '-Setup.exe';
const bytes = await readFile(path.join(destination, installer));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const release = {appId, version, platform: 'win32', arch: 'x64', mode: 'offline-installer', file: installer,
  size: bytes.length, sha256, signed: false, licenseMode: 'free', licenseKeyIds: [], created: new Date().toISOString()};
await writeFile(path.join(destination, 'release.json'), JSON.stringify(release, null, 2));
await writeFile(path.join(destination, 'SHA256SUMS.txt'), sha256 + '  ' + installer + '\n');
console.log(path.join(destination, installer));
