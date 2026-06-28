param(
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$RunInit
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

function Require-Command {
  param(
    [string]$Name,
    [string]$InstallHint
  )

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name was not found. $InstallHint"
  }
}

function Run-Step {
  param(
    [string]$Title,
    [scriptblock]$Body
  )

  Write-Host ""
  Write-Host "== $Title =="
  & $Body
}

Set-Location -LiteralPath $RepoRoot

Run-Step "Checking required programs" {
  Require-Command "node" "Install Node 22 LTS, then open a new PowerShell window."
  Require-Command "npm" "Install Node 22 LTS, then open a new PowerShell window."
  Require-Command "git" "Install Git for Windows."
  Require-Command "bash" "Install Git for Windows and include Git Bash in PATH."
  node --version
  npm --version
  git --version
}

if (-not $SkipInstall) {
  Run-Step "Installing packages" {
    npm install
  }
}

if (-not $SkipBuild) {
  Run-Step "Building Kastor" {
    npm run build
  }
}

Run-Step "Showing setup guide" {
  node .\dist\cli.js setup-guide
}

if ($RunInit) {
  Run-Step "Creating local Kastor config" {
    node .\dist\cli.js init
  }
} else {
  Write-Host ""
  Write-Host "Skipped interactive config. Run this when you are ready:"
  Write-Host "  node .\dist\cli.js init"
}

Run-Step "Running doctor" {
  node .\dist\cli.js doctor
}

Write-Host ""
Write-Host "Bootstrap finished."
Write-Host "Next: start a public HTTPS tunnel, then run 'node .\dist\cli.js serve'."
