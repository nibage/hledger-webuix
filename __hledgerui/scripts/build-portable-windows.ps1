#requires -Version 5.1
[CmdletBinding()]
param([string]$OutputDir = '')

$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $appRoot
if (-not $OutputDir) { $OutputDir = Join-Path $repoRoot 'dist' }

# The updater creates versioned runtimes inside __hledgerui/data/ and verifies
# official release download hashes before activation.
& (Join-Path $PSScriptRoot 'update-runtime.ps1') -Component node -Unattended
if ($LASTEXITCODE -ne 0) { throw 'Could not stage portable Node.js.' }
& (Join-Path $PSScriptRoot 'update-runtime.ps1') -Component hledger -Unattended
if ($LASTEXITCODE -ne 0) { throw 'Could not stage portable hledger.' }

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$stage = Join-Path $env:TEMP ('hledger-webuix-build-' + [Guid]::NewGuid().ToString('N'))
$packageRoot = Join-Path $stage '__hledgerui'
try {
  New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
  foreach ($name in @('server.js','index.html','favicon.svg','start.bat','start.sh','runtime-manifest.json')) {
    Copy-Item -LiteralPath (Join-Path $appRoot $name) -Destination $packageRoot
  }
  foreach ($name in @('README.md','LICENSE','THIRD_PARTY_LICENSES.md')) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $name) -Destination $packageRoot
  }
  Copy-Item -LiteralPath (Join-Path $appRoot 'scripts') -Destination $packageRoot -Recurse
  Copy-Item -LiteralPath (Join-Path $appRoot 'data') -Destination $packageRoot -Recurse

  $archive = Join-Path $OutputDir 'hledger-webuix-portable-win-x64.zip'
  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
  # Keep the __hledgerui directory itself in the ZIP, so users can extract
  # one directory and launch its start.bat without arranging files manually.
  Compress-Archive -LiteralPath $packageRoot -DestinationPath $archive
  Write-Host "Portable bundle ready: $archive" -ForegroundColor Green
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
