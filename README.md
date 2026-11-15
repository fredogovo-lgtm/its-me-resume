# ITS ME

ITS ME 是一款免费的 Windows x64 离线简历工作台。把经历、技能、作品和联系方式保存到个人资料库，再按岗位挑选内容，制作中英文简历，调整排版并导出 PDF。

## 下载安装

在 [GitHub Releases](https://github.com/fredogovo-lgtm/its-me-resume/releases/latest) 展开 **Assets**，下载 Windows 安装程序。0.15.1 提供[安装包](https://github.com/fredogovo-lgtm/its-me-resume/releases/download/v0.15.1/ITS-ME-0.15.1-Setup.exe)和[中文图文手册](https://github.com/fredogovo-lgtm/its-me-resume/releases/download/v0.15.1/ITS-ME-0.15.1-User-Guide-zh-CN.pdf)。双击安装程序，选择安装位置，然后打开 ITS ME。本版安装包未做 Windows 发布者代码签名。

已有旧版时，先保存正在编辑的内容，然后打开 **设置 → 软件更新**，选择下载的新版 Setup。软件会在启动安装器前创建资料备份。

## 做第一份简历

1. 打开资料库，填入姓名、联系方式以及至少一段经历，保存资料。
2. 新建简历，选择要投递的岗位、语言和资料条目，在编辑器里调整文字和版式。
3. 预览并导出 PDF。要为不同岗位定制简历，可以新建副本，分别修改和导出。
4. 换电脑前在 **设置 → 本地资料 → 一键打包资料库（换机）** 保存完整备份，在新电脑安装软件后恢复。备份含个人资料和归档 PDF，为未加密文件，请放在自己控制的位置。

## 本地资料与可选 AI

编辑、排版、PDF 导出、备份均可离线使用。资料库、简历、照片、附件和归档 PDF 保存在本机。应用内可以查看资料位置和更改资料目录。

在设置中配置自己的 DeepSeek 或兼容服务 API Key 后，可主动使用翻译、润色、选材等 AI 功能。发送前检查本次任务选中的文字与必要上下文，结果由你核对并决定采用。接口费用按所选服务商的账户规则计算。Key 可仅在本次会话使用，或由系统在本机加密保存。完整资料备份不含 Key、全局 AI 规则及未提交草稿。

## 在 Windows 上从源码运行

使用 64 位 Windows、Node.js 24 或更高版本及随附的 npm。在仓库根目录运行以下命令。首次安装依赖、下载 Electron 和准备 NSIS 构建工具需要网络。

```powershell
npm ci
npm run setup
npm test
npm start
```

开发测试可以通过 `npm start -- "--data-dir=D:\ITS-ME-demo"` 指定一个独立的空资料目录。Electron 版本和 SHA-256 记录在 `tools/runtime-lock.json`。

## 构建 Windows 安装包

完成上述依赖和运行时准备后，运行 `npm run installer`。生成的 `ITS-ME-0.15.1-Setup.exe`、SHA-256 清单及第三方声明在 `outputs/内测/ITS ME-0.15.1-Windows安装包/` 下。运行 `npm run package` 可单独生成完整目录版，路径为 `outputs/原型/ITS ME-0.15.1-win-x64/`。

应用入口位于 `app/desktop/main.mjs`，界面位于 `app/ui/`，资料和排版逻辑位于 `app/core/`。依赖版本由 npm 锁文件固定。第三方组件及其随附许可见[第三方组件索引](docs/第三方组件索引.md)。
