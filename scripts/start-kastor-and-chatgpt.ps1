param(
  [string]$NgrokDomain = $env:KASTOR_NGROK_DOMAIN,
  [string]$PublicBaseUrl = $env:KASTOR_PUBLIC_BASE_URL,
  [string]$AllowedRoots = $env:KASTOR_ALLOWED_ROOTS,
  [ValidateSet("desktop", "chrome", "none")]
  [string]$ChatGptClient = $(if ($env:KASTOR_CHATGPT_CLIENT) { $env:KASTOR_CHATGPT_CLIENT } else { "desktop" }),
  [string]$ChromeProfileDir = $(if ($env:KASTOR_CHATGPT_CHROME_PROFILE) { $env:KASTOR_CHATGPT_CHROME_PROFILE } else { Join-Path $env:LOCALAPPDATA "KastorChatGPTChrome" })
)

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$targetScript = if ($ChatGptClient -eq "none") {
  "start-kastor-local.ps1"
} else {
  "start-devspace-and-chatgpt.ps1"
}

$args = @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  (Join-Path $ScriptDir $targetScript)
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

if ($targetScript -eq "start-devspace-and-chatgpt.ps1") {
  $args += @("-ChatGptClient", $ChatGptClient)
  if ($ChatGptClient -eq "chrome") {
    $args += @("-ChromeProfileDir", $ChromeProfileDir)
  }
}

& powershell.exe @args
