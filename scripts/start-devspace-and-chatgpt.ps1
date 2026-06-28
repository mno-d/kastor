param(
  [string]$NgrokDomain = $(if ($env:KASTOR_NGROK_DOMAIN) { $env:KASTOR_NGROK_DOMAIN } else { $env:DEVSPACE_NGROK_DOMAIN }),
  [string]$PublicBaseUrl = $(if ($env:KASTOR_PUBLIC_BASE_URL) { $env:KASTOR_PUBLIC_BASE_URL } else { $env:DEVSPACE_PUBLIC_BASE_URL }),
  [string]$AllowedRoots = $(if ($env:KASTOR_ALLOWED_ROOTS) { $env:KASTOR_ALLOWED_ROOTS } else { $env:DEVSPACE_ALLOWED_ROOTS }),
  [ValidateSet("desktop", "chrome", "none")]
  [string]$ChatGptClient = $(if ($env:KASTOR_CHATGPT_CLIENT) { $env:KASTOR_CHATGPT_CLIENT } else { "desktop" }),
  [string]$ChromeProfileDir = $(if ($env:KASTOR_CHATGPT_CHROME_PROFILE) { $env:KASTOR_CHATGPT_CHROME_PROFILE } else { Join-Path $env:LOCALAPPDATA "KastorChatGPTChrome" })
)

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$LogDir = Join-Path $HOME ".kastor"
$ClientOutLog = Join-Path $LogDir "chatgpt-client.out.log"
$ClientErrLog = Join-Path $LogDir "chatgpt-client.err.log"

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

$startArgs = @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  (Join-Path $ScriptDir "start-devspace-local.ps1")
)

if ($NgrokDomain) {
  $startArgs += @("-NgrokDomain", $NgrokDomain)
}

if ($PublicBaseUrl) {
  $startArgs += @("-PublicBaseUrl", $PublicBaseUrl)
}

if ($AllowedRoots) {
  $startArgs += @("-AllowedRoots", $AllowedRoots)
}

& powershell.exe @startArgs

Start-Sleep -Seconds 5

if ($ChatGptClient -eq "none") {
  Write-Output "Started Kastor. ChatGPT client launch was skipped."
  exit 0
}

Remove-Item -LiteralPath $ClientOutLog,$ClientErrLog -ErrorAction SilentlyContinue

if ($ChatGptClient -eq "desktop") {
  Start-Process -FilePath powershell.exe `
    -ArgumentList @(
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      (Join-Path $ScriptDir "gpt-desktop-normalize.ps1")
    ) `
    -WindowStyle Hidden `
    -RedirectStandardOutput $ClientOutLog `
    -RedirectStandardError $ClientErrLog `
    -PassThru | Out-Null

  Write-Output "Started Kastor and requested ChatGPT Desktop normalization."
  exit 0
}

$chromeCandidates = @(
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe")
)
$chrome = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $chrome) {
  throw "Google Chrome was not found. Install Chrome or use -ChatGptClient desktop."
}

New-Item -ItemType Directory -Path $ChromeProfileDir -Force | Out-Null
Start-Process -FilePath $chrome `
  -ArgumentList @(
    "--user-data-dir=$ChromeProfileDir",
    "--app=https://chatgpt.com"
  ) `
  -WindowStyle Normal `
  -RedirectStandardOutput $ClientOutLog `
  -RedirectStandardError $ClientErrLog `
  -PassThru | Out-Null

Write-Output "Started Kastor and opened ChatGPT web in a dedicated Chrome app window."
