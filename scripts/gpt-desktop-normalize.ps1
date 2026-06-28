param(
  [int]$Width = 1200,
  [int]$Height = 900,
  [int]$Margin = 24
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class DpiTools {
  [DllImport("shcore.dll")]
  public static extern int SetProcessDpiAwareness(int value);
}

public static class Win32WindowTools {
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
}
"@

try {
  [DpiTools]::SetProcessDpiAwareness(2) | Out-Null
} catch {
  # The process may already have a DPI awareness context. Continue with the current context.
}

Add-Type -AssemblyName System.Windows.Forms

$screen = [System.Windows.Forms.Screen]::AllScreens |
  Sort-Object { $_.Bounds.Width * $_.Bounds.Height } |
  Select-Object -First 1

if (-not $screen) {
  throw "No display was found."
}

$process = Get-Process ChatGPT -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } |
  Sort-Object StartTime -Descending |
  Select-Object -First 1

if (-not $process) {
  $app = Get-StartApps | Where-Object { $_.Name -eq "ChatGPT" } | Select-Object -First 1
  if (-not $app) {
    throw "ChatGPT is not running and no Start menu app entry was found."
  }

  Start-Process "shell:AppsFolder\$($app.AppID)"
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $process = Get-Process ChatGPT -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne 0 } |
      Sort-Object StartTime -Descending |
      Select-Object -First 1
    if ($process) { break }
  }
}

if (-not $process) {
  throw "ChatGPT window was not found."
}

$working = $screen.WorkingArea
$targetWidth = [Math]::Min($Width, $working.Width - ($Margin * 2))
$targetHeight = [Math]::Min($Height, $working.Height - ($Margin * 2))
$targetX = $working.X + $Margin
$targetY = $working.Y + $Margin

# Restore before positioning. SetWindowPos does not reliably resize a maximized Electron window.
[Win32WindowTools]::ShowWindow($process.MainWindowHandle, 9) | Out-Null
Start-Sleep -Milliseconds 300

$SWP_NOZORDER = 0x0004
$SWP_SHOWWINDOW = 0x0040
[Win32WindowTools]::SetWindowPos(
  $process.MainWindowHandle,
  [IntPtr]::Zero,
  $targetX,
  $targetY,
  $targetWidth,
  $targetHeight,
  $SWP_NOZORDER -bor $SWP_SHOWWINDOW
) | Out-Null

Start-Sleep -Milliseconds 300
$rect = New-Object Win32WindowTools+RECT
[Win32WindowTools]::GetWindowRect($process.MainWindowHandle, [ref]$rect) | Out-Null

[pscustomobject]@{
  Display = $screen.DeviceName
  DisplayX = $screen.Bounds.X
  DisplayY = $screen.Bounds.Y
  DisplayWidth = $screen.Bounds.Width
  DisplayHeight = $screen.Bounds.Height
  WindowTitle = $process.MainWindowTitle
  WindowHandle = $process.MainWindowHandle
  WindowX = $rect.Left
  WindowY = $rect.Top
  WindowWidth = $rect.Right - $rect.Left
  WindowHeight = $rect.Bottom - $rect.Top
}
