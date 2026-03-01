<#
.SYNOPSIS
    Build the multicorpus sidecar for tauri-shell (Windows).

.DESCRIPTION
    Calls scripts/build_sidecar.py with preset "shell", then reads
    sidecar-manifest.json to locate the actual executable — works with both
    onefile and onedir outputs, without relying on target-triple heuristics.

.EXAMPLE
    .\tauri-shell\scripts\prepare_sidecar.ps1
#>

$ErrorActionPreference = "Stop"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot    = (Resolve-Path (Join-Path $ScriptDir ".." "..")).Path
$BuildScript = Join-Path $RepoRoot "scripts\build_sidecar.py"
$Preset      = "shell"

Write-Host "==> Building sidecar (preset=$Preset) ..."
python $BuildScript --preset $Preset

# ── Read manifest ──────────────────────────────────────────────────────────────
$ManifestPath = Join-Path $RepoRoot "tauri-shell\src-tauri\binaries\sidecar-manifest.json"
if (-not (Test-Path $ManifestPath)) {
    Write-Error "Manifest not found at: $ManifestPath"
    exit 1
}

$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$ExePath  = $Manifest.executable_path

Write-Host "==> Manifest executable_path: $ExePath"

# ── Verify the executable exists ──────────────────────────────────────────────
if (Test-Path $ExePath -PathType Leaf) {
    Write-Host "==> ✓ Sidecar binary (onefile): $ExePath"
} elseif (Test-Path $ExePath -PathType Container) {
    $BaseName = Split-Path $ExePath -Leaf
    $InnerExe = Join-Path $ExePath "$BaseName.exe"
    if (-not (Test-Path $InnerExe -PathType Leaf)) {
        $InnerExe = Join-Path $ExePath "multicorpus.exe"
    }
    if (Test-Path $InnerExe -PathType Leaf) {
        Write-Host "==> ✓ Sidecar binary (onedir): $InnerExe"
    } else {
        Write-Error "onedir present at $ExePath but inner executable not found"
        exit 1
    }
} else {
    Write-Error "executable_path does not exist: $ExePath"
    exit 1
}

Write-Host "==> Done. Sidecar ready for tauri-shell."
