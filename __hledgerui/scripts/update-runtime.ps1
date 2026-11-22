#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('node', 'hledger', 'git')]
    [string]$Component,
    [switch]$Unattended
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $root 'runtime-manifest.json') -Raw | ConvertFrom-Json
$item = $manifest.$Component
$platform = $item.'windows-x64'
$version = [string]$item.version
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') { throw 'Windows x64 is required.' }
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid pinned version.' }
$uri = [Uri]([string]$platform.url)
$sha256 = [string]$platform.sha256
if ($sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid SHA-256 checksum.' }
$expectedPath = switch ($Component) {
    'node' { "/dist/v$version/node-v$version-win-x64.zip" }
    'hledger' { "/hledgerorg/hledger/releases/download/$version/hledger-windows-x64.zip" }
    'git' { "/git-for-windows/git/releases/download/v$version.windows.1/MinGit-$version-64-bit.zip" }
}
$expectedHost = if ($Component -eq 'node') { 'nodejs.org' } else { 'github.com' }
if ($uri.Scheme -ne 'https' -or $uri.Host -ne $expectedHost -or $uri.AbsolutePath -ne $expectedPath) {
    throw 'Unexpected release URL.'
}

$componentRoot = Join-Path $root "data\$Component\win-x64"
$versionName = "v$version"
$installDir = Join-Path $componentRoot $versionName
$relativeExe = if ($Component -eq 'git') { 'cmd\git.exe' } elseif ($Component -eq 'node') { 'node.exe' } else { 'hledger.exe' }
$installedExe = Join-Path $installDir $relativeExe
Write-Output "[updater] Component: $Component; pinned version: $version"
Write-Output "[updater] Destination: $installDir"
if (-not $Unattended) {
    $confirmation = Read-Host 'Type YES to download and activate this version'
    if ($confirmation -cne 'YES') { Write-Output '[updater] Cancelled.'; exit 1 }
}
New-Item -ItemType Directory -Path $componentRoot -Force | Out-Null
$staging = Join-Path $componentRoot ('.staging-' + [Guid]::NewGuid().ToString('N'))
try {
    if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) {
        New-Item -ItemType Directory -Path $staging -Force | Out-Null
        $archive = Join-Path $staging 'upstream.zip'
        $unpack = Join-Path $staging 'unpacked'
        $payload = Join-Path $staging 'payload'
        Write-Output "[updater] Downloading $($uri.AbsoluteUri)"
        Invoke-WebRequest -Uri $uri.AbsoluteUri -OutFile $archive -UseBasicParsing
        $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -cne $sha256.ToLowerInvariant()) {
            throw "SHA-256 mismatch; expected $sha256 but downloaded $actual"
        }
        Write-Output '[updater] SHA-256 verified.'
        Expand-Archive -LiteralPath $archive -DestinationPath $unpack
        if ($Component -eq 'git') {
            # MinGit needs cmd/, mingw64/, usr/ etc; preserve the whole archive.
            $gitExe = Join-Path $unpack 'cmd\git.exe'
            if (-not (Test-Path -LiteralPath $gitExe -PathType Leaf)) { throw 'MinGit archive has no cmd/git.exe.' }
            Move-Item -LiteralPath $unpack -Destination $payload
        } else {
            $candidates = @(Get-ChildItem -LiteralPath $unpack -Filter $relativeExe -File -Recurse)
            if ($candidates.Count -ne 1) { throw "Expected one $relativeExe in archive." }
            # Keep all sibling files (Node/npm or hledger helper binaries and licences).
            New-Item -ItemType Directory -Path $payload -Force | Out-Null
            Copy-Item -Path (Join-Path $candidates[0].DirectoryName '*') -Destination $payload -Recurse -Force
        }
        $candidate = Join-Path $payload $relativeExe
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw "Missing extracted $relativeExe" }
        $output = (& $candidate --version 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw "Downloaded executable failed: $output" }
        if ($Component -eq 'node' -and $output -notmatch "^v$([regex]::Escape($version))(\s|$)") { throw "Node.js version mismatch: $output" }
        if ($Component -eq 'hledger' -and $output -notmatch "^hledger $([regex]::Escape($version))(\s|$|-)") { throw "hledger version mismatch: $output" }
        if ($Component -eq 'git' -and $output -notmatch "git version $([regex]::Escape($version))") { throw "Git version mismatch: $output" }
        Move-Item -LiteralPath $payload -Destination $installDir
    }
    $output = (& $installedExe --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Could not execute installed $Component" }
    if ($Component -eq 'node' -and $output -notmatch "^v$([regex]::Escape($version))(\s|$)") { throw "Existing Node.js version mismatch: $output" }
    if ($Component -eq 'hledger' -and $output -notmatch "^hledger $([regex]::Escape($version))(\s|$|-)") { throw "Existing hledger version mismatch: $output" }
    if ($Component -eq 'git' -and $output -notmatch "git version $([regex]::Escape($version))") { throw "Existing Git version mismatch: $output" }
    Write-Output "[updater] Executable verified: $output"

    $active = Join-Path $componentRoot 'active.txt'
    $pending = Join-Path $componentRoot ('.active-' + [Guid]::NewGuid().ToString('N'))
    [System.IO.File]::WriteAllText($pending, $versionName, [System.Text.Encoding]::ASCII)
    # Both files live in the same version selector directory. Move-Item -Force
    # replaces an existing active.txt without File.Replace's invalid null backup
    # argument on Windows PowerShell 5.1. Existing version folders are untouched.
    Write-Output "[updater] Switching active runtime to $versionName..."
    try {
        Move-Item -LiteralPath $pending -Destination $active -Force -ErrorAction Stop
    } finally {
        if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending -Force }
    }
    if ((Get-Content -LiteralPath $active -Raw).Trim() -cne $versionName) {
        throw "Runtime selection verification failed for $Component"
    }
    Write-Output "[updater] Activated $Component $version in its own data/$Component folder."
    Write-Output '[updater] Restart the server to use a new Node.js executable.'
    exit 0
} finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
