param(
  [Parameter(Mandatory = $true)]
  [string]$FilePath,

  [string]$PfxPath = "",
  [string]$PfxPassword = "",
  [string]$TimestampUrl = "http://timestamp.digicert.com",
  [switch]$SkipIfMissing
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $FilePath)) {
  throw "File not found: $FilePath"
}

if ([string]::IsNullOrWhiteSpace($PfxPath)) {
  $PfxPath = $env:WIN_SIGN_CERT_PFX_PATH
}
if ([string]::IsNullOrWhiteSpace($PfxPassword)) {
  $PfxPassword = $env:WIN_SIGN_CERT_PASSWORD
}

$tempPfx = $null
if ([string]::IsNullOrWhiteSpace($PfxPath) -and -not [string]::IsNullOrWhiteSpace($env:WIN_SIGN_CERT_PFX_BASE64)) {
  $tempPfx = Join-Path $env:RUNNER_TEMP "agrafes_signing_cert.pfx"
  [IO.File]::WriteAllBytes($tempPfx, [Convert]::FromBase64String($env:WIN_SIGN_CERT_PFX_BASE64))
  $PfxPath = $tempPfx
}

if ([string]::IsNullOrWhiteSpace($PfxPath) -or -not (Test-Path -LiteralPath $PfxPath) -or [string]::IsNullOrWhiteSpace($PfxPassword)) {
  if ($SkipIfMissing) {
    Write-Host "warning: signing secrets missing; skipping Windows signing."
    exit 0
  }
  throw "Missing signing material. Provide PFX path/password or WIN_SIGN_CERT_PFX_BASE64 + WIN_SIGN_CERT_PASSWORD."
}

$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if (-not $signtool) {
  throw "signtool.exe not found. Install Windows SDK in the runner environment."
}

Write-Host "Signing $FilePath"
& signtool.exe sign `
  /fd SHA256 `
  /td SHA256 `
  /tr $TimestampUrl `
  /f $PfxPath `
  /p $PfxPassword `
  $FilePath

Write-Host "Verifying signature"
& signtool.exe verify /pa /v $FilePath

if ($tempPfx -and (Test-Path -LiteralPath $tempPfx)) {
  Remove-Item -LiteralPath $tempPfx -Force
}

Write-Host "Done: $FilePath"
