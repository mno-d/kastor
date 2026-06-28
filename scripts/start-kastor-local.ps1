param(
  [string]$NgrokDomain = $env:KASTOR_NGROK_DOMAIN,
  [string]$PublicBaseUrl = $env:KASTOR_PUBLIC_BASE_URL,
  [string]$AllowedRoots = $env:KASTOR_ALLOWED_ROOTS
)

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$args = @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  (Join-Path $ScriptDir "start-devspace-local.ps1")
)

if ($NgrokDomain) {
  $args += @("-NgrokDomain", $NgrokDomain)
}

if ($PublicBaseUrl) {
  $args += @("-PublicBaseUrl", $PublicBaseUrl)
}

if ($AllowedRoots) {
  $args += @("-AllowedRoots", $AllowedRoots)
}

& powershell.exe @args
