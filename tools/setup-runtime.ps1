$ErrorActionPreference = 'Stop'
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + [IO.Path]::PathSeparator + $env:PSModulePath
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot 'work\runtime'
$runtimeLock = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'runtime-lock.json') | ConvertFrom-Json
$archivePath = Join-Path $runtimeRoot $runtimeLock.archive
$checksumPath = Join-Path $runtimeRoot 'SHASUMS256.txt'
$electronDirectory = Join-Path $runtimeRoot 'electron'
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

function Download-VerifiedReleaseFile([string]$Uri, [string]$Destination) {
    $partialPath = "$Destination.download"
    try {
        Invoke-WebRequest -Uri $Uri -OutFile $partialPath
        Move-Item -LiteralPath $partialPath -Destination $Destination -Force
    } finally {
        if (Test-Path -LiteralPath $partialPath) { Remove-Item -LiteralPath $partialPath -Force }
    }
}

if (-not (Test-Path -LiteralPath $checksumPath)) {
    Download-VerifiedReleaseFile $runtimeLock.checksumsUrl $checksumPath
}
$escapedArchive = [regex]::Escape($runtimeLock.archive)
$checksums = Get-Content -Raw -LiteralPath $checksumPath
$releaseMatch = [regex]::Match($checksums, "(?m)^([a-fA-F0-9]{64}) \*?$escapedArchive\r?$")
if (-not $releaseMatch.Success -or $releaseMatch.Groups[1].Value.ToLowerInvariant() -ne $runtimeLock.sha256) {
    throw '官方校验清单与锁定 SHA256 不一致；已停止，不会运行该运行时。'
}
if (-not (Test-Path -LiteralPath $archivePath)) {
    Download-VerifiedReleaseFile $runtimeLock.archiveUrl $archivePath
}
$actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
if ($actualHash -ne $runtimeLock.sha256) {
    throw "Electron ZIP 校验失败；保留文件供检查：$archivePath"
}
$electronExecutable = Join-Path $electronDirectory 'electron.exe'
$versionFile = Join-Path $electronDirectory 'version'
if (Test-Path -LiteralPath $electronDirectory) {
    if (-not (Test-Path -LiteralPath $electronExecutable) -or -not (Test-Path -LiteralPath $versionFile) -or (Get-Content -Raw -LiteralPath $versionFile).Trim() -ne $runtimeLock.version) {
        throw "运行时目录已存在但版本或文件不匹配；请先保留并检查该目录：$electronDirectory"
    }
} else {
    $stagingDirectory = Join-Path $runtimeRoot ("electron-unpack-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stagingDirectory | Out-Null
    Expand-Archive -LiteralPath $archivePath -DestinationPath $stagingDirectory
    if (-not (Test-Path -LiteralPath (Join-Path $stagingDirectory 'electron.exe'))) {
        throw "解压结果缺少 electron.exe，已保留待检查：$stagingDirectory"
    }
    Move-Item -LiteralPath $stagingDirectory -Destination $electronDirectory
}
if ($runtimeLock.PSObject.Properties.Name -contains 'executableSha256') {
    $actualExecutableHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $electronExecutable).Hash.ToLowerInvariant()
    if ($actualExecutableHash -ne $runtimeLock.executableSha256) { throw 'electron.exe SHA256 不匹配，已停止。' }
}
Write-Host "Electron $($runtimeLock.version) 已就绪；ZIP SHA256 $actualHash"
Write-Host $electronExecutable
