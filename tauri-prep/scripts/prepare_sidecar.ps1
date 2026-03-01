# prepare_sidecar.ps1 — Build the multicorpus sidecar and copy it into tauri-prep/src-tauri/binaries/.
#
# Usage: pwsh tauri-prep/scripts/prepare_sidecar.ps1
#   Run from the repo root.

param()
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path "$PSScriptRoot\..\..\"
$tauriDir = Join-Path $repoRoot "tauri-prep\src-tauri"
$binariesDir = Join-Path $tauriDir "binaries"

Write-Host "==> Building multicorpus sidecar (format=onedir)..."
Set-Location $repoRoot
python scripts/build_sidecar.py --format onedir --preset tauri

# Detect target triple
$targetTriple = (rustc --print host-tuple 2>&1) -replace '\s',''
if (-not $targetTriple) {
    Write-Error "Could not determine target triple from rustc --print host-tuple"
    exit 1
}
Write-Host "==> Target triple: $targetTriple"

New-Item -ItemType Directory -Force -Path $binariesDir | Out-Null

$srcDir = Join-Path $repoRoot "dist\multicorpus"
$destDir = Join-Path $binariesDir "multicorpus-$targetTriple"

if (-not (Test-Path $srcDir)) {
    Write-Error "Expected onedir bundle at $srcDir"
    exit 1
}

if (Test-Path $destDir) { Remove-Item $destDir -Recurse -Force }
Copy-Item $srcDir $destDir -Recurse
Write-Host "==> Copied $srcDir -> $destDir"
Write-Host "==> Sidecar ready in $binariesDir"
