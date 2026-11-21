#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('node', 'hledger')]
    [string]$Component,
    [ValidateRange(0, 2147483647)]
    [int]$ServerProcessId = 0,
    [switch]$Unattended
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $root 'runtime-manifest.json') -Raw | ConvertFrom-Json
$item = $manifest.$Component
$platform = $item.'windows-x64'
$version = [string]$item.version
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') {
    throw 'Only Windows x64 portable runtimes are supported by this updater.'
}
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid pinned version in runtime-manifest.json.' }
$uri = [Uri]([string]$platform.url)
$sha256 = [string]$platform.sha256
if ($sha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'Missing trusted SHA-256 checksum.' }
if ($Component -eq 'node') {
    if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'nodejs.org' -or
        $uri.AbsolutePath -ne "/dist/v$version/node-v$version-win-x64.zip") {
        throw 'Unapproved Node.js download URL.'
    }
} else {
    if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'github.com' -or
        $uri.AbsolutePath -ne "/hledgerorg/hledger/releases/download/$version/hledger-windows-x64.zip") {
        throw 'Unapproved hledger download URL.'
    }
}
$componentRoot = Join-Path $root "data\$Component\win-x64"
$versionDir = "v$version"
$installDir = Join-Path $componentRoot $versionDir
$executableName = if ($Component -eq 'node') { 'node.exe' } else { 'hledger.exe' }
$targetExecutable = Join-Path $installDir $executableName

Write-Host ""
Write-Host "hledger-webuix portable runtime manager" -ForegroundColor Cyan
Write-Host "Component: $Component"
Write-Host "Approved version: $version"
Write-Host "Source: $($uri.AbsoluteUri)"
Write-Host "Destination: $installDir"
Write-Host "Checksums must match the reviewed runtime-manifest.json."
Write-Host ""
if (-not $Unattended) {
    $answer = Read-Host "Type YES to proceed"
    if ($answer -cne 'YES') { Write-Host 'Cancelled. No changes made.'; exit 0 }
}
if ($ServerProcessId -gt 0) {
    $running = Get-Process -Id $ServerProcessId -ErrorAction SilentlyContinue
    if ($running) {
        Write-Host ""
        Write-Host "Stop the hledger-webuix server window with Ctrl+C." -ForegroundColor Yellow
        Write-Host "The updater will continue after the server exits."
        Wait-Process -Id $ServerProcessId
    }
}

New-Item -ItemType Directory -Path $componentRoot -Force | Out-Null
$stage = Join-Path $componentRoot ('.staging-' + [Guid]::NewGuid().ToString('N'))
try {
    if (-not (Test-Path -LiteralPath $targetExecutable -PathType Leaf)) {
        New-Item -ItemType Directory -Path $stage -Force | Out-Null
        $archive = Join-Path $stage 'upstream.zip'
        $extracted = Join-Path $stage 'extracted'
        $payload = Join-Path $stage 'payload'
        Write-Host 'Downloading approved release...'
        Invoke-WebRequest -Uri $uri.AbsoluteUri -OutFile $archive -UseBasicParsing
        $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -cne $sha256.ToLowerInvariant()) {
            throw "SHA-256 mismatch. Download discarded. Expected $sha256; got $actual"
        }
        Write-Host 'SHA-256 verified.' -ForegroundColor Green
        Expand-Archive -LiteralPath $archive -DestinationPath $extracted
        New-Item -ItemType Directory -Path $payload -Force | Out-Null
        $matches = @(Get-ChildItem -LiteralPath $extracted -Filter $executableName -File -Recurse)
        if ($matches.Count -ne 1) { throw "Expected exactly one $executableName in the official archive." }
        Copy-Item -LiteralPath $matches[0].FullName -Destination (Join-Path $payload $executableName)
        $license = Get-ChildItem -LiteralPath $extracted -Filter 'LICENSE' -File -Recurse | Select-Object -First 1
        if ($license) { Copy-Item -LiteralPath $license.FullName -Destination (Join-Path $payload 'LICENSE') }
        $candidate = Join-Path $payload $executableName
        $versionOutput = (& $candidate --version 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw "Downloaded executable failed: $versionOutput" }
        if ($Component -eq 'node' -and $versionOutput -notmatch "^v$([regex]::Escape($version))(\s|$)") {
            throw "Wrong Node.js version: $versionOutput"
        }
        if ($Component -eq 'hledger' -and $versionOutput -notmatch "^hledger $([regex]::Escape($version))(\s|$|-)") {
            throw "Wrong hledger version: $versionOutput"
        }
        Move-Item -LiteralPath $payload -Destination $installDir
    }
    $installedVersion = (& $targetExecutable --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Unable to run $targetExecutable" }
    if ($Component -eq 'node' -and $installedVersion -notmatch "^v$([regex]::Escape($version))(\s|$)") {
        throw "Existing portable Node.js has the wrong version: $installedVersion"
    }
    if ($Component -eq 'hledger' -and $installedVersion -notmatch "^hledger $([regex]::Escape($version))(\s|$|-)") {
        throw "Existing portable hledger has the wrong version: $installedVersion"
    }
    # Changing the active version is one small file write; previous version directories stay available.
    $activeFile = Join-Path $componentRoot 'active.txt'
    $pending = Join-Path $componentRoot ('.active-' + [Guid]::NewGuid().ToString('N'))
    [System.IO.File]::WriteAllText($pending, $versionDir, [System.Text.Encoding]::ASCII)
    Move-Item -LiteralPath $pending -Destination $activeFile -Force
    Write-Host ""
    Write-Host "Portable $Component $version activated." -ForegroundColor Green
    Write-Host "Start hledger-webuix again to use the new runtime."
    Write-Host "Earlier version directories are preserved for manual rollback."
} finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
