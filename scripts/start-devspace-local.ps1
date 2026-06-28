param(
  [string]$NgrokDomain = $(if ($env:KASTOR_NGROK_DOMAIN) { $env:KASTOR_NGROK_DOMAIN } else { $env:DEVSPACE_NGROK_DOMAIN }),
  [string]$PublicBaseUrl = $(if ($env:KASTOR_PUBLIC_BASE_URL) { $env:KASTOR_PUBLIC_BASE_URL } else { $env:DEVSPACE_PUBLIC_BASE_URL }),
  [string]$AllowedRoots = $(if ($env:KASTOR_ALLOWED_ROOTS) { $env:KASTOR_ALLOWED_ROOTS } else { $env:DEVSPACE_ALLOWED_ROOTS })
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $HOME ".devspace"
$NgrokLog = Join-Path $LogDir "ngrok-7678.log"
$NgrokErrLog = Join-Path $LogDir "ngrok-7678.err.log"
$DevspaceOutLog = Join-Path $LogDir "devspace-7678-local.out.log"
$DevspaceErrLog = Join-Path $LogDir "devspace-7678-local.err.log"
$UrlFile = Join-Path $LogDir "devspace-public-url.txt"
$Port = 7678
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

function Get-ConfiguredAllowedRoots {
  if ($AllowedRoots) { return $AllowedRoots }

  $configPath = Join-Path $HOME ".devspace\config.json"
  if (-not (Test-Path -LiteralPath $configPath)) { return "" }

  try {
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($config.allowedRoots) {
      return ($config.allowedRoots -join ",")
    }
  } catch {
    return ""
  }

  return ""
}

function Get-NgrokPath {
  $command = Get-Command ngrok -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $wingetNgrok = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" `
    -Filter ngrok.exe `
    -Recurse `
    -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
  if ($wingetNgrok) { return $wingetNgrok }

  throw "ngrok.exe was not found. Install ngrok and try again."
}

function Stop-MatchingProcess {
  param(
    [string]$Name,
    [string]$Pattern
  )

  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.Name -ieq $Name -and
      $_.CommandLine -and
      $_.CommandLine -match $Pattern
    } |
    ForEach-Object {
      $process = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
      if ($process) { Stop-Process -Id $process.Id -Force }
    }
}

function Wait-HttpOk {
  param(
    [string]$Url,
    [int]$Seconds = 45
  )

  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $response
      }
    } catch {
      Start-Sleep -Milliseconds 500
      continue
    }
    Start-Sleep -Milliseconds 500
  }

  throw "Timed out waiting for $Url"
}

function Start-Kastor {
  param(
    [string]$Url,
    [string]$Roots
  )

  Remove-Item -LiteralPath $DevspaceOutLog,$DevspaceErrLog -ErrorAction SilentlyContinue
  $isWholePc = $Roots -match '^[A-Za-z]:\\?$' -or $Roots -eq '/'
  $toolMode = if ($env:KASTOR_TOOL_MODE) { $env:KASTOR_TOOL_MODE } elseif ($isWholePc) { "full" } else { "minimal" }
  $widgets = if ($env:KASTOR_WIDGETS) { $env:KASTOR_WIDGETS } elseif ($isWholePc) { "changes" } else { "off" }
  $cmd = '/c set "PORT=' + $Port + '" && ' +
    'set "KASTOR_PUBLIC_BASE_URL=' + $Url + '" && ' +
    'set "KASTOR_ALLOWED_ROOTS=' + $Roots + '" && ' +
    'set "KASTOR_TOOL_MODE=' + $toolMode + '" && ' +
    'set "KASTOR_WIDGETS=' + $widgets + '" && ' +
    'set "KASTOR_TRUST_PROXY=true" && ' +
    'node dist\cli.js serve'

  Start-Process -FilePath cmd.exe `
    -ArgumentList $cmd `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $DevspaceOutLog `
    -RedirectStandardError $DevspaceErrLog `
    -PassThru | Out-Null
}

$AllowedRoots = Get-ConfiguredAllowedRoots
if (-not $AllowedRoots) {
  throw "Set KASTOR_ALLOWED_ROOTS to a narrow project folder before starting Kastor."
}

if (-not $NgrokDomain) {
  if ($PublicBaseUrl -match "^https?://([^/]+)") {
    $NgrokDomain = $Matches[1]
  } else {
    throw "Set DEVSPACE_NGROK_DOMAIN or pass -NgrokDomain."
  }
}

if (-not $PublicBaseUrl) {
  $PublicBaseUrl = "https://$NgrokDomain"
}

$NgrokPath = Get-NgrokPath

Stop-MatchingProcess "node.exe" "node .*dist\\cli\.js serve"
Stop-MatchingProcess "ngrok.exe" "ngrok.*(http|start).*$Port"
Stop-MatchingProcess "ngrok.exe" "ngrok.*$([regex]::Escape($NgrokDomain))"
Start-Sleep -Seconds 1

Start-Kastor $PublicBaseUrl $AllowedRoots
Wait-HttpOk "http://127.0.0.1:$Port/healthz" 45 | Out-Null

Remove-Item -LiteralPath $NgrokLog,$NgrokErrLog -ErrorAction SilentlyContinue
Start-Process -FilePath $NgrokPath `
  -ArgumentList @("http", "--domain=$NgrokDomain", "$Port", "--log=stdout", "--log-format=logfmt") `
  -WindowStyle Hidden `
  -RedirectStandardOutput $NgrokLog `
  -RedirectStandardError $NgrokErrLog `
  -PassThru | Out-Null

$deadline = (Get-Date).AddSeconds(45)
$startedUrl = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  try {
    $tunnels = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 5
    $startedUrl = ($tunnels.tunnels | Where-Object { $_.public_url -eq $PublicBaseUrl } | Select-Object -First 1).public_url
    if ($startedUrl) { break }
  } catch {
    $logText = @(
      if (Test-Path -LiteralPath $NgrokLog) { Get-Content -LiteralPath $NgrokLog -Raw -ErrorAction SilentlyContinue }
      if (Test-Path -LiteralPath $NgrokErrLog) { Get-Content -LiteralPath $NgrokErrLog -Raw -ErrorAction SilentlyContinue }
    ) -join "`n"
    if ($logText -match "ERR_NGROK|ERROR:") {
      throw $logText
    }
  }
}

if (-not $startedUrl) {
  throw "ngrok did not expose $PublicBaseUrl. See $NgrokLog and $NgrokErrLog."
}

Set-Content -LiteralPath $UrlFile -Value $PublicBaseUrl -Encoding UTF8
Write-Output "Kastor local: http://127.0.0.1:$Port"
Write-Output "Kastor public: $PublicBaseUrl"

