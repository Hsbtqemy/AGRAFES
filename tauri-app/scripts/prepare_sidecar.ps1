<#
.SYNOPSIS
    Build the multicorpus sidecar and copy it into tauri-app/src-tauri/binaries/
    for Windows (onedir format, per ADR-025).

.DESCRIPTION
    Calls scripts/build_sidecar.py with --format onedir --preset tauri, then
    copies the resulting directory into tauri-app/src-tauri/binaries/.

.PARAMETER Preset
    Build preset passed to build_sidecar.py (default: tauri)

.EXAMPLE
    .\tauri-app\scripts\prepare_sidecar.ps1
    .\tauri-app\scripts\prepare_sidecar.ps1 -Preset tauri
#>
param(
    [string]$Preset = "tauri"
)

$ErrorActionPreference = "Stop"

# Repo root = two levels up from this script
$RepoRoot = (Resolve-Path "$PSScriptRoot\..\.." ).Path
$BinDir   = Join-Path $RepoRoot "tauri-app\src-tauri\binaries"
$BuildScript = Join-Path $RepoRoot "scripts\build_sidecar.py"

Write-Host "==> Building sidecar (format=onedir, preset=$Preset) on Windows"
python $BuildScript --format onedir --preset $Preset

# Detect target triple
$TargetTriple = (rustc --print host-tuple 2>$null).Trim()
if (-not $TargetTriple) { $TargetTriple = "x86_64-pc-windows-msvc" }
Write-Host "==> Target triple: $TargetTriple"

$SrcDir  = Join-Path $RepoRoot "tauri\src-tauri\binaries\multicorpus-$TargetTriple"
$DestDir = Join-Path $BinDir   "multicorpus-$TargetTriple"

if (-not (Test-Path $SrcDir)) {
    Write-Error "Expected onedir at $SrcDir"
    exit 1
}

if (Test-Path $DestDir) {
    Remove-Item -Recurse -Force $DestDir
}

Copy-Item -Recurse $SrcDir $DestDir
Write-Host "==> Copied onedir to $DestDir"
Write-Host "==> Done. Sidecar ready in tauri-app/src-tauri/binaries/"
