param(
  [string]$NgrokDomain = $env:KASTOR_NGROK_DOMAIN,
  [string]$PublicBaseUrl = $(if ($env:KASTOR_PUBLIC_BASE_URL) { $env:KASTOR_PUBLIC_BASE_URL } else { "" }),
  [string]$AllowedRoots = $env:KASTOR_ALLOWED_ROOTS,
  [string]$TaskName = "Kastor-Local"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$StartScript = Join-Path $PSScriptRoot "start-kastor-and-chatgpt.ps1"

if (-not (Test-Path -LiteralPath $StartScript)) {
  throw "Missing start script: $StartScript"
}

if (-not $NgrokDomain -and -not $PublicBaseUrl) {
  throw "Set -NgrokDomain or -PublicBaseUrl. Refusing to install autostart with a personal/default tunnel."
}

if (-not $PublicBaseUrl) {
  $PublicBaseUrl = "https://$NgrokDomain"
}

$arguments = @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  "`"$StartScript`"",
  "-NgrokDomain",
  "`"$NgrokDomain`"",
  "-PublicBaseUrl",
  "`"$PublicBaseUrl`""
) -join " "

if ($AllowedRoots) {
  $arguments = "$arguments -AllowedRoots `"$AllowedRoots`""
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument $arguments `
  -WorkingDirectory $RepoRoot

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Start Kastor MCP server, fixed ngrok tunnel, and ChatGPT client startup at user logon." `
  -Force | Out-Null

Enable-ScheduledTask -TaskName $TaskName | Out-Null

$legacy = Get-ScheduledTask -TaskName "DevSpace-Local" -ErrorAction SilentlyContinue
if ($legacy) {
  Disable-ScheduledTask -TaskName "DevSpace-Local" | Out-Null
}

Get-ScheduledTask -TaskName $TaskName |
  Select-Object TaskName, State, Actions, Triggers |
  Format-List
