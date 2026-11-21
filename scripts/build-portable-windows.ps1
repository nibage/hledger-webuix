#requires -Version 5.1
[CmdletBinding()]
param([string]$OutputDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist'))
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'update-runtime.ps1') -Component node -Unattended
if ($LASTEXITCODE -ne 0) { throw 'Could not stage Node.js runtime.' }
& (Join-Path $PSScriptRoot 'update-runtime.ps1') -Component hledger -Unattended
if ($LASTEXITCODE -ne 0) { throw 'Could not stage hledger runtime.' }
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$stage = Join-Path $env:TEMP ('hledger-webuix-pack-' + [Guid]::NewGuid().ToString('N'))
$packageRoot = Join-Path $stage 'hledger-webuix'
try {
  New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
  foreach ($name in @('server.js','hledger-webuix.html','favicon.svg','start.bat','README.md','LICENSE','package.json','runtime-manifest.json','THIRD_PARTY_LICENSES.md')) {
    Copy-Item -LiteralPath (Join-Path $root $name) -Destination $packageRoot
  }
  Copy-Item -LiteralPath (Join-Path $root 'scripts') -Destination $packageRoot -Recurse
  Copy-Item -LiteralPath (Join-Path $root 'runtime') -Destination $packageRoot -Recurse
  $archive = Join-Path $OutputDir 'hledger-webuix-portable-win-x64.zip'
  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
  Compress-Archive -Path (Join-Path $packageRoot '*') -DestinationPath $archive
  Write-Host "Portable bundle ready: $archive" -ForegroundColor Green
} finally { if (Test-Path $stage) { Remove-Item $stage -Recurse -Force } }
