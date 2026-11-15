param([string]$LicensePublicKey,[switch]$Development)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + [IO.Path]::PathSeparator + $env:PSModulePath
$projectRoot = Split-Path -Parent $PSScriptRoot
if ($Development) { throw '-Development 已停用：正式安装包使用免费版发布策略。源码开发请用官方 Electron 运行时打开源码目录。' }
if ($LicensePublicKey) { throw '免费版不使用签发公钥。请不要传入 -LicensePublicKey。' }
$freePolicy = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'app\desktop\license-policy.json') | ConvertFrom-Json
if ($freePolicy.mode -ne 'free' -or $freePolicy.keys -isnot [Array] -or $freePolicy.keys.Count -ne 0 -or @($freePolicy.PSObject.Properties).Count -ne 2) { throw '正式安装包必须使用免费版发布策略，未更改输出目录。' }
& (Join-Path $PSScriptRoot 'setup-runtime.ps1')
$package = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
$runtimeLock = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'runtime-lock.json') | ConvertFrom-Json
$requiredFiles = @('app\desktop\main.mjs', 'app\desktop\preload.cjs', 'app\desktop\store.mjs', 'app\core\model.mjs', 'app\ui\index.html', 'app\ui\print.html', 'app\ui\print.mjs', 'app\ui\app.mjs', 'app\ui\editor.mjs', 'app\ui\wizard.mjs', 'app\ui\wizard-model.mjs', 'app\ui\projects.mjs', 'app\core\attachments.mjs', 'app\ui\frame-geometry.mjs', 'app\ui\language-layout.mjs', 'app\core\rich-text.mjs', 'app\core\split-block.mjs', 'app\ui\rich-text-view.mjs', 'app\ui\rich-editing.mjs', 'app\ui\rich-editing.css', 'app\ui\pagination.mjs', 'app\ui\inspector-panels.mjs', 'app\ui\inspector-panels.css', 'app\ui\styles.css', 'app\ui\resume-view.mjs', 'app\ui\resume.css')
$requiredFiles += @('app\core\entry-content.mjs','app\core\content-check.mjs','app\core\text-overlap.mjs','app\core\template-layout.mjs','app\core\backup-review.mjs','app\ui\inline-editing.mjs','app\ui\content-check.mjs','app\ui\content-check.css','app\ui\layout-review.mjs','app\ui\layout-review.css','app\ui\text-regions.mjs','app\ui\template-preview.mjs','app\ui\template-preview.css','app\ui\workspace-panels.mjs','app\ui\workspace-panels.css','app\ui\backup-preview.mjs','app\ui\backup-preview.css','app\ui\export-history.mjs','app\ui\history-review.css')
$requiredFiles += @('app\core\photo.mjs','app\core\personal-templates.mjs','app\core\page-insertion.mjs','app\core\project-versions.mjs','app\core\source-updates.mjs','app\ui\photo.mjs','app\ui\photo-view.mjs','app\ui\photo.css','app\ui\library-drafts.mjs','app\ui\library-navigation.mjs','app\ui\material-placement.mjs','app\ui\personal-templates.mjs','app\ui\personal-templates.css','app\ui\source-updates.mjs','app\ui\source-updates.css','app\ui\projects-versions.css','app\ui\user-message.mjs')
$requiredFiles += @('app\core\canvas-groups.mjs','app\core\submission.mjs','app\core\bilingual-sync.mjs','app\core\resume-import.mjs','app\desktop\resume-import.mjs','app\desktop\resume-import-worker.mjs','app\desktop\offline-license.mjs','app\desktop\license-policy.json','app\ui\bilingual-sync.mjs','app\ui\bilingual-sync.css','app\ui\resume-import.mjs','app\ui\resume-import.css','app\ui\submission.mjs')
$requiredFiles += @('app\core\bilingual-review.mjs','app\desktop\offline-update.mjs','app\ui\software-update.mjs')
$requiredFiles += @('app\desktop\installer-version.mjs','app\ui\state-transactions.mjs')
$requiredFiles += @('app\desktop\library-license.mjs','app\desktop\library-session.mjs')
$requiredFiles += @('app\desktop\data-location.mjs','app\desktop\data-location-cleanup.mjs','app\desktop\data-location-service.mjs','app\ui\data-location.mjs')
$requiredFiles += @('app\desktop\data-location-recovery.mjs','app\desktop\startup-recovery.mjs')
$requiredFiles += @('app\core\ai-rule-preferences.mjs','app\desktop\ai-rules-store.mjs','app\ui\ai-rule-controls.mjs')
$requiredFiles += @('app\core\ai-tasks.mjs','app\core\ai-apply.mjs','app\desktop\ai-config.mjs','app\desktop\ai-vault.mjs','app\desktop\ai-service.mjs','app\ui\ai-assistant.mjs','app\ui\ai-context.mjs','app\ui\ai-assistant.css')
$requiredFiles += @('app\core\ai-experience.mjs','app\ui\ai-translation-fields.mjs','app\core\ai-policy.mjs','app\desktop\ai-provider.mjs','app\desktop\app-info.mjs','app\ui\ai-content-task.mjs','app\ui\ai-completion.mjs','app\ui\ai-layout.mjs','app\ui\wizard-drafts.mjs','app\ui\ai-date-format.mjs')
$requiredFiles += @('app\core\design-tools.mjs','app\core\document-style.mjs','app\core\library-experience.mjs','app\desktop\full-backup.mjs','app\desktop\full-backup-ipc.mjs','app\ui\design-tools.mjs','app\ui\design-tools.css','app\ui\design-material-view.mjs','app\ui\document-links.mjs','app\ui\document-quality.mjs','app\ui\experience-controls.mjs','app\ui\full-backup.mjs','app\ui\full-backup.css','app\ui\library-experience.css')
$requiredFiles += @('app\ui\resume-import-draft.mjs','app\ui\personal-template-review.mjs')
$requiredFiles += @('app\core\library-save-ai.mjs','app\ui\library-save-ai.mjs','app\ui\library-save-ai.css')
$requiredFiles += @('app\ui\ai-draft-dialog.mjs','app\ui\ai-review-drafts.mjs','app\ui\ai-review-apply.mjs','app\ui\editor-canvas-copy.mjs')
foreach ($requiredFile in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $requiredFile) -PathType Leaf)) { throw "源码不完整，未打包：$requiredFile" }
}
$outputRoot = Join-Path $projectRoot 'outputs\原型'
if ($package.version -notmatch '^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$') { throw 'package.json 版本号无效。' }
$destination = [IO.Path]::GetFullPath((Join-Path $outputRoot ("ITS ME-" + $package.version + '-win-x64')))
$absoluteOutputRoot = [IO.Path]::GetFullPath($outputRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $destination.StartsWith($absoluteOutputRoot, [StringComparison]::OrdinalIgnoreCase)) { throw '打包路径不在项目 outputs/原型 目录内。' }
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
if (Test-Path -LiteralPath $destination) {
    $preserved = $destination + '-previous-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
    Move-Item -LiteralPath $destination -Destination $preserved
    Write-Host "已保留上次打包：$preserved"
}
New-Item -ItemType Directory -Path $destination | Out-Null
$runtimeDirectory = Join-Path $projectRoot 'work\runtime\electron'
Get-ChildItem -LiteralPath $runtimeDirectory -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse
}
$stageArgs = @((Join-Path $PSScriptRoot 'stage-app.mjs'), '--out=' + (Join-Path $projectRoot 'work\portable-stage'))
$appSource = (& node @stageArgs).Trim()
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $appSource)) { throw '应用和生产依赖暂存失败。' }
$appDestination = Join-Path $destination 'resources\app'
New-Item -ItemType Directory -Path $appDestination -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $appSource 'package.json') -Destination $appDestination
Copy-Item -LiteralPath (Join-Path $appSource 'package-lock.json') -Destination $appDestination
Copy-Item -LiteralPath (Join-Path $appSource 'app') -Destination $appDestination -Recurse
Copy-Item -LiteralPath (Join-Path $appSource 'node_modules') -Destination $appDestination -Recurse
$guideSource = Join-Path $appSource 'docs'
& node (Join-Path $PSScriptRoot 'customer-guides.mjs') ('--application=' + $appSource) ('--out=' + $guideSource)
if ($LASTEXITCODE -ne 0) { throw '客户使用说明生成失败，未宣布打包完成。' }
& node (Join-Path $PSScriptRoot 'customer-guides.mjs') ('--copy-from=' + $guideSource) ('--out=' + (Join-Path $destination '客户说明'))
if ($LASTEXITCODE -ne 0) { throw '客户使用说明复制校验失败，未宣布打包完成。' }
Move-Item -LiteralPath (Join-Path $destination 'electron.exe') -Destination (Join-Path $destination 'ITS ME.exe')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'runtime-lock.json') -Destination (Join-Path $destination '运行时校验.json')
$notice = @"
ITS ME $($package.version) — Windows x64 离线桌面版

启动：双击 ITS ME.exe。
这是便携目录版，未做发布者代码签名；标准安装版另附 Setup 安装程序。
本版软件免费使用，安装即可编辑和导出，不需要激活、授权文件或联系作者签发。
日常资料管理、排版、导出与备份均可离线使用。
可选 AI 由用户主动配置自己的 API Key 并发送；仅本次任务选定文字和必要上下文联网发送，API 费用由用户服务账号承担。
Key 可由系统在本机加密保存或仅此次会话使用，不进入资料库备份。
运行时：官方 Electron $($runtimeLock.version)，SHA256 见“运行时校验.json”。
运行时授权与第三方声明保留在 LICENSE、LICENSES.chromium.html 等随包文件。
默认资料位于本机用户应用数据目录下，可在软件设置中打开或选择空文件夹迁移。
测试可用参数 --data-dir=绝对路径 指定独立资料目录。
客户快速上手、版本与升级说明、第三方组件索引见“客户说明”目录。
请保留整个目录，不能只复制 exe。
"@
$notice | Set-Content -LiteralPath (Join-Path $destination '使用说明.txt') -Encoding utf8
Write-Host "未签名离线目录版已打包：$destination"
