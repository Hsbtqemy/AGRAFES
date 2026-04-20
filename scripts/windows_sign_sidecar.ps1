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

# Import PFX into the Current User / My store so signtool can sign without
# the /p flag (which would expose the password in the process argument list
# and CI logs).  The certificate is removed immediately after signing.
$securePassword = ConvertTo-SecureString -String $PfxPassword -AsPlainText -Force
$cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
  $PfxPath,
  $securePassword,
  [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable -bor
  [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::PersistKeySet
)
$thumbprint = $cert.Thumbprint
$store = [System.Security.Cryptography.X509Certificates.X509Store]::new(
  [System.Security.Cryptography.X509Certificates.StoreName]::My,
  [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
)
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
$store.Add($cert)
$store.Close()

try {
  & signtool.exe sign `
    /fd SHA256 `
    /td SHA256 `
    /tr $TimestampUrl `
    /sha1 $thumbprint `
    $FilePath
  if ($LASTEXITCODE -ne 0) { throw "signtool sign failed (exit $LASTEXITCODE)" }

  Write-Host "Verifying signature"
  & signtool.exe verify /pa /v $FilePath
  if ($LASTEXITCODE -ne 0) { throw "signtool verify failed (exit $LASTEXITCODE)" }
} finally {
  # Always remove the cert from the store, even if signing failed.
  $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
  $removeCert = $store.Certificates | Where-Object { $_.Thumbprint -eq $thumbprint }
  if ($removeCert) { $store.Remove($removeCert) }
  $store.Close()
}

if ($tempPfx -and (Test-Path -LiteralPath $tempPfx)) {
  Remove-Item -LiteralPath $tempPfx -Force
}

Write-Host "Done: $FilePath"
