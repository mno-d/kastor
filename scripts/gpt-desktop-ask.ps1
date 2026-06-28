param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Prompt,

  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$ScriptDir = $PSScriptRoot
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "gpt-desktop-normalize.ps1") | Out-Null

function Get-ChatGptWindow {
  $process = Get-Process ChatGPT -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Sort-Object StartTime -Descending |
    Select-Object -First 1

  if (-not $process) {
    throw "ChatGPT window was not found."
  }

  return [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
}

function Find-FirstElementByControlType {
  param(
    [System.Windows.Automation.AutomationElement]$Root,
    [System.Windows.Automation.ControlType]$ControlType,
    [string]$NamePattern = ".*"
  )

  $controlTypeCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    $ControlType
  )
  $all = $Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $controlTypeCondition)
  for ($i = 0; $i -lt $all.Count; $i++) {
    $element = $all.Item($i)
    if ($element.Current.Name -match $NamePattern) {
      return $element
    }
  }

  return $null
}

function Get-VisibleText {
  param([System.Windows.Automation.AutomationElement]$Root)

  $textCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Text
  )
  $texts = $Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textCondition)
  $values = New-Object System.Collections.Generic.List[string]
  for ($i = 0; $i -lt $texts.Count; $i++) {
    $name = $texts.Item($i).Current.Name
    if ([string]::IsNullOrWhiteSpace($name)) { continue }
    $values.Add($name.Trim())
  }
  return $values
}

function Has-StopButton {
  param([System.Windows.Automation.AutomationElement]$Root)

  $buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
  )
  $buttons = $Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
  for ($i = 0; $i -lt $buttons.Count; $i++) {
    if ($buttons.Item($i).Current.Name -match "停止|Stop") {
      return $true
    }
  }
  return $false
}

function Get-LastAnswerCandidate {
  param(
    [string[]]$BeforeTexts,
    [string[]]$AfterTexts
  )

  $beforeSet = New-Object "System.Collections.Generic.HashSet[string]"
  foreach ($text in $BeforeTexts) { [void]$beforeSet.Add($text) }

  $candidates = New-Object System.Collections.Generic.List[string]
  foreach ($text in $AfterTexts) {
    if ($beforeSet.Contains($text)) { continue }
    if ($text -match "ChatGPT の回答は必ずしも|質問してみましょう|メッセージをコピー|回答をコピー|共有する|モデルを切り替える|その他のアクション") { continue }
    if ($text -eq $Prompt) { continue }
    $candidates.Add($text)
  }

  if ($candidates.Count -eq 0) {
    return ""
  }

  return ($candidates | Select-Object -Last 8) -join "`n"
}

$root = Get-ChatGptWindow
$beforeTexts = @(Get-VisibleText $root)
$edit = Find-FirstElementByControlType $root ([System.Windows.Automation.ControlType]::Edit) "ChatGPT|チャット|質問|message|prompt"
if (-not $edit) {
  throw "ChatGPT input field was not found."
}

$edit.SetFocus()
Start-Sleep -Milliseconds 250
[System.Windows.Forms.Clipboard]::SetText($Prompt)
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 250
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$sawGenerating = $false
$stableCount = 0
$lastJoined = ""

while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  $root = Get-ChatGptWindow
  $texts = @(Get-VisibleText $root)
  $joined = $texts -join "`n"
  if (Has-StopButton $root) {
    $sawGenerating = $true
    $stableCount = 0
    $lastJoined = $joined
    continue
  }

  if ($sawGenerating) {
    if ($joined -eq $lastJoined) {
      $stableCount++
    } else {
      $stableCount = 0
      $lastJoined = $joined
    }
    if ($stableCount -ge 2) {
      $answer = Get-LastAnswerCandidate $beforeTexts $texts
      if ($answer) {
        Write-Output $answer
        exit 0
      }
    }
  }
}

$root = Get-ChatGptWindow
$finalTexts = @(Get-VisibleText $root)
$fallback = Get-LastAnswerCandidate $beforeTexts $finalTexts
if ($fallback) {
  Write-Output $fallback
  exit 0
}

throw "Timed out waiting for a ChatGPT answer."
