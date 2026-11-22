#requires -Version 5.1
# Offline regression test for updater activation on Windows PowerShell 5.1.
# The test copies the already-installed CI Node.js executable into a temporary
# component folder, ensuring no network download or user data is involved.
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $sourceRoot '__hledgerui'
$stage = Join-Path $env:TEMP ('webuix-runtime-test-' + [Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path (Join-Path $stage 'scripts') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $appRoot 'scripts\update-runtime.ps1') -Destination (Join-Path $stage 'scripts\update-runtime.ps1')
    $manifest = Get-Content -LiteralPath (Join-Path $appRoot 'runtime-manifest.json') -Raw | ConvertFrom-Json
    $nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
    $version = (& $nodeExecutable --version).TrimStart('v')
    $manifest.node.version = $version
    $manifest.node.'windows-x64'.url = "https://nodejs.org/dist/v$version/node-v$version-win-x64.zip"
    $manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $stage 'runtime-manifest.json') -Encoding UTF8
    $root = Join-Path $stage 'data\node\win-x64'
    $installed = Join-Path $root ("v" + $version)
    New-Item -ItemType Directory -Path $installed -Force | Out-Null
    Copy-Item -LiteralPath $nodeExecutable -Destination (Join-Path $installed 'node.exe')
    Set-Content -LiteralPath (Join-Path $root 'active.txt') -Value 'v0.0.1' -NoNewline -Encoding ASCII
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $stage 'scripts\update-runtime.ps1') -Component node -Unattended
    if ($LASTEXITCODE -ne 0) { throw "Updater exited with $LASTEXITCODE" }
    $actual = (Get-Content -LiteralPath (Join-Path $root 'active.txt') -Raw).Trim()
    if ($actual -cne ('v' + $version)) { throw "Expected v$version in active.txt, got $actual" }
    Write-Host "PASS: existing active.txt replaced with v$version without downloading anything."
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
