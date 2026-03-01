<#
.SYNOPSIS
    Build the multicorpus sidecar for tauri-app (Windows).

.DESCRIPTION
    Calls scripts/build_sidecar.py with the specified preset, then reads
    sidecar-manifest.json to locate the actual executable — works with both
    onefile and onedir outputs, without relying on target-triple heuristics.

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

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot   = (Resolve-Path (Join-Path $ScriptDir ".." "..")).Path
$BuildScript = Join-Path $RepoRoot "scripts\build_sidecar.py"

Write-Host "==> Building sidecar (preset=$Preset) ..."
python $BuildScript --preset $Preset

# ── Read manifest ──────────────────────────────────────────────────────────────
$PresetMap = @{
    "tauri"   = "tauri\src-tauri\binaries"
    "fixture" = "tauri-fixture\src-tauri\binaries"
    "shell"   = "tauri-shell\src-tauri\binaries"
}
if (-not $PresetMap.ContainsKey($Preset)) {
    Write-Error "Unknown preset: $Preset"
    exit 1
}

$ManifestPath = Join-Path $RepoRoot $PresetMap[$Preset] "sidecar-manifest.json"
if (-not (Test-Path $ManifestPath)) {
    Write-Error "Manifest not found at: $ManifestPath"
    exit 1
}

$Manifest    = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$ExePath     = $Manifest.executable_path

Write-Host "==> Manifest executable_path: $ExePath"

# ── Verify the executable exists ──────────────────────────────────────────────
if (Test-Path $ExePath -PathType Leaf) {
    Write-Host "==> ✓ Sidecar binary (onefile): $ExePath"
} elseif (Test-Path $ExePath -PathType Container) {
    # onedir: find inner executable (same basename or "multicorpus.exe")
    $BaseName  = Split-Path $ExePath -Leaf
    $InnerExe  = Join-Path $ExePath "$BaseName.exe"
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

Write-Host "==> Done. Sidecar ready."
