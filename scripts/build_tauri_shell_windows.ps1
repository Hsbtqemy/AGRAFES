<#
.SYNOPSIS
    Reproducible Windows release build for AGRAFES tauri-shell.

.DESCRIPTION
    1) Installs Python packaging deps (editable project + PyInstaller).
    2) Builds Windows sidecar in onefile mode.
    3) Installs npm dependencies for tauri-app / tauri-prep / tauri-shell.
    4) Builds the NSIS installer using tauri.windows.conf.json.
#>

param(
    [switch]$SkipPythonInstall,
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ShellDir = Join-Path $RepoRoot "tauri-shell"
$NsisDir = Join-Path $ShellDir "src-tauri\target\release\bundle\nsis"
$ManifestPath = Join-Path $ShellDir "src-tauri\binaries\sidecar-manifest.json"

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Label,
        [Parameter(Mandatory = $true)]
        [ScriptBlock]$Command
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

Push-Location $RepoRoot
try {
    if (-not $SkipPythonInstall) {
        Write-Host "==> Installing Python packaging dependencies..."
        Invoke-Step -Label "pip install -e .[packaging]" -Command {
            python -m pip install -e ".[packaging]"
        }
    }

    Write-Host "==> Building Windows sidecar (onefile)..."
    Invoke-Step -Label "build_sidecar.py (windows onefile)" -Command {
        python scripts/build_sidecar.py --preset shell --format onefile
    }

    if (-not $SkipNpmInstall) {
        Write-Host "==> Installing npm dependencies (tauri-app, tauri-prep, tauri-shell)..."
        Invoke-Step -Label "npm ci tauri-app" -Command {
            npm --prefix tauri-app ci --prefer-offline
        }
        Invoke-Step -Label "npm ci tauri-prep" -Command {
            npm --prefix tauri-prep ci --prefer-offline
        }
        Invoke-Step -Label "npm ci tauri-shell" -Command {
            npm --prefix tauri-shell ci --prefer-offline
        }
    }

    Write-Host "==> Building Tauri Shell NSIS installer..."
    Invoke-Step -Label "tauri:build:windows" -Command {
        npm --prefix tauri-shell run tauri:build:windows
    }

    if (Test-Path $ManifestPath) {
        Write-Host "==> Sidecar manifest: $ManifestPath"
    } else {
        Write-Warning "Sidecar manifest not found: $ManifestPath"
    }

    $installer = Get-ChildItem $NsisDir -Filter "*setup.exe" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime |
        Select-Object -Last 1
    if ($installer) {
        Write-Host "==> NSIS installer: $($installer.FullName)"
        Write-Host "==> Size (bytes): $($installer.Length)"
    } else {
        throw "NSIS installer not found under $NsisDir"
    }
}
finally {
    Pop-Location
}
