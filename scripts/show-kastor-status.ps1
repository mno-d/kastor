param(
  [int]$Tail = 80,
  [switch]$RawCloudflared
)

$ErrorActionPreference = "Stop"

$LogDir = Join-Path $HOME ".kastor"
$KastorOutLog = Join-Path $LogDir "kastor-7678-local.out.log"
$KastorErrLog = Join-Path $LogDir "kastor-7678-local.err.log"
$CloudflaredLog = Join-Path $LogDir "cloudflared-kastor.log"
$CloudflareOutLog = Join-Path $LogDir "kastor-cloudflare.out.log"
$CloudflareErrLog = Join-Path $LogDir "kastor-cloudflare.err.log"

function Read-TailLines {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return @() }
  Get-Content -LiteralPath $Path -Tail $Tail -Encoding UTF8 -ErrorAction SilentlyContinue
}

function Is-BenignCloudflaredLine {
  param([string]$Line)
  return $Line -match "canceled by remote with error code 0" -or
    $Line -match "context canceled" -or
    $Line -match "http2: stream closed"
}

Write-Output "== Kastor health =="
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:7678/healthz" -TimeoutSec 5 | ConvertTo-Json -Compress
} catch {
  Write-Output ("health failed: " + $_.Exception.Message)
}

Write-Output ""
Write-Output "== Processes =="
Get-CimInstance Win32_Process |
  Where-Object {
    ($_.Name -eq "node.exe" -and $_.CommandLine -match "dist\\cli\.js serve") -or
    $_.Name -eq "cloudflared.exe" -or
    $_.Name -eq "ngrok.exe"
  } |
  Select-Object ProcessId,Name,CommandLine |
  Format-Table -AutoSize |
  Out-String |
  Write-Output

Write-Output "== Kastor logs =="
foreach ($path in @($KastorOutLog, $KastorErrLog, $CloudflareOutLog, $CloudflareErrLog)) {
  if (-not (Test-Path -LiteralPath $path)) { continue }
  Write-Output ("-- " + $path)
  Read-TailLines $path | Write-Output
}

Write-Output "== Cloudflared log =="
if (-not (Test-Path -LiteralPath $CloudflaredLog)) {
  Write-Output "cloudflared log not found"
} else {
  $lines = Read-TailLines $CloudflaredLog
  if ($RawCloudflared) {
    $lines | Write-Output
  } else {
    $noise = @($lines | Where-Object { Is-BenignCloudflaredLine $_ }).Count
    $useful = @($lines | Where-Object { -not (Is-BenignCloudflaredLine $_) })
    Write-Output ("filtered benign cloudflared connection-cancel lines: " + $noise)
    $useful | Write-Output
  }
}
