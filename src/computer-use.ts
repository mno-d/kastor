import { execFile } from "node:child_process";
import { platform } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ComputerUseAction =
  | "list_windows"
  | "screenshot"
  | "activate"
  | "click"
  | "type_text"
  | "press_key"
  | "launch_app";

export interface ComputerUseInput {
  action: ComputerUseAction;
  windowId?: number;
  app?: string;
  title?: string;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  includeImage?: boolean;
  purpose?: string;
  confirmed?: boolean;
}

export interface ComputerUseWindow {
  id: number;
  title: string;
  processName: string;
  processId: number;
  path?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComputerUseScreenshot {
  width: number;
  height: number;
  mimeType: "image/png";
  data?: string;
}

export interface ComputerUseResult {
  result: string;
  action: ComputerUseAction;
  ok: boolean;
  requiresConfirmation: boolean;
  windows?: ComputerUseWindow[];
  window?: ComputerUseWindow;
  screenshot?: ComputerUseScreenshot;
  blockedReasons: string[];
  warnings: string[];
}

export interface SafetyAssessment {
  allowed: boolean;
  requiresConfirmation: boolean;
  blockedReasons: string[];
  warnings: string[];
}

const TERMINAL_PROCESS_NAMES = new Set([
  "cmd",
  "conhost",
  "pwsh",
  "powershell",
  "powershell_ise",
  "wt",
  "windowsterminal",
]);

const SELF_CONTROL_PROCESS_PATTERNS = [
  /chatgpt/i,
  /codex/i,
];

const ALWAYS_CONFIRM_PATTERN =
  /\b(delete|remove|destroy|submit|send|post|publish|upload|install|uninstall|purchase|buy|pay|subscribe|unsubscribe|permission|share|invite|oauth|api key|password|credit card|payment|captcha|reservation|appointment|cancel)\b|削除|送信|投稿|公開|アップロード|インストール|購入|支払|購読|解除|権限|共有|招待|パスワード|クレジット|決済|予約|キャンセル|認証コード|APIキー/i;

const HANDOFF_PATTERN =
  /change password|password change|paywall|safety interstitial|security warning|security setting|privacy setting|windows security|antivirus|defender|パスワード変更|セキュリティ警告|安全警告|セキュリティ設定|プライバシー設定/i;

export function assessComputerUseSafety(input: ComputerUseInput, target?: {
  processName?: string;
  title?: string;
  path?: string;
}): SafetyAssessment {
  const blockedReasons: string[] = [];
  const warnings: string[] = [];
  const purpose = input.purpose ?? "";
  const processName = normalizeProcessName(target?.processName);
  const targetText = `${target?.processName ?? ""} ${target?.title ?? ""} ${target?.path ?? ""}`;

  if (platform() !== "win32") {
    blockedReasons.push("Computer Use is only available on Windows.");
  }

  if (input.action !== "list_windows" && input.action !== "launch_app" && input.windowId == null) {
    blockedReasons.push("windowId is required for this action.");
  }

  if (input.action === "click" && (input.x == null || input.y == null)) {
    blockedReasons.push("x and y are required for click.");
  }

  if (input.action === "type_text" && input.text == null) {
    blockedReasons.push("text is required for type_text.");
  }

  if (input.action === "press_key" && !input.key?.trim()) {
    blockedReasons.push("key is required for press_key.");
  }

  if (input.action === "launch_app" && !input.app?.trim()) {
    blockedReasons.push("app is required for launch_app.");
  }

  if (input.key && /\b(meta|windows|win|cmd|command|super|os)\b/i.test(input.key)) {
    blockedReasons.push("Windows-key and OS-key shortcuts are not allowed.");
  }

  if (TERMINAL_PROCESS_NAMES.has(processName)) {
    blockedReasons.push("Computer Use must not automate terminal applications.");
  }

  if (SELF_CONTROL_PROCESS_PATTERNS.some((pattern) => pattern.test(targetText))) {
    blockedReasons.push("Computer Use must not automate ChatGPT, Codex, or its own control surface.");
  }

  if (HANDOFF_PATTERN.test(purpose)) {
    blockedReasons.push("This Computer Use action requires the user to take over manually.");
  }

  const requiresConfirmation = isStateChangingAction(input.action)
    && ALWAYS_CONFIRM_PATTERN.test(`${purpose} ${input.text ?? ""}`)
    && !input.confirmed;

  if (requiresConfirmation) {
    warnings.push("This action appears to have external, destructive, credential, permission, or communication risk. Re-run only after explicit action-time user confirmation with confirmed=true.");
  }

  return {
    allowed: blockedReasons.length === 0 && !requiresConfirmation,
    requiresConfirmation,
    blockedReasons,
    warnings,
  };
}

export async function computerUse(input: ComputerUseInput): Promise<ComputerUseResult> {
  if (input.action === "list_windows") {
    const windows = await listWindows();
    const result: ComputerUseResult = {
      result: formatComputerUseResult(input.action, true, [], [], windows),
      action: input.action,
      ok: true,
      requiresConfirmation: false,
      windows,
      blockedReasons: [],
      warnings: [],
    };
    return result;
  }

  if (input.action === "launch_app") {
    const safety = assessComputerUseSafety(input);
    if (!safety.allowed) return blockedResult(input, safety);
    await runPowerShell(buildLaunchScript(input.app ?? ""));
    return {
      result: `Computer Use launch_app requested: ${input.app}`,
      action: input.action,
      ok: true,
      requiresConfirmation: false,
      blockedReasons: [],
      warnings: safety.warnings,
    };
  }

  const windows = await listWindows();
  const target = selectWindow(windows, input);
  const safety = assessComputerUseSafety(input, target);
  if (!safety.allowed) return blockedResult(input, safety, target);

  if (input.action === "screenshot") {
    const screenshot = await screenshotWindow(target.id, input.includeImage !== false);
    const result = `Computer Use screenshot captured for ${target.processName} "${target.title}" (${screenshot.width}x${screenshot.height}).`;
    return {
      result,
      action: input.action,
      ok: true,
      requiresConfirmation: false,
      window: target,
      screenshot,
      blockedReasons: [],
      warnings: safety.warnings,
    };
  }

  if (input.action === "activate") {
    await runPowerShell(buildActivateScript(target.id));
  } else if (input.action === "click") {
    await runPowerShell(buildClickScript(target.id, input.x ?? 0, input.y ?? 0));
  } else if (input.action === "type_text") {
    await runPowerShell(buildTypeTextScript(target.id, input.text ?? ""));
  } else if (input.action === "press_key") {
    await runPowerShell(buildPressKeyScript(target.id, input.key ?? ""));
  }

  const result = `Computer Use ${input.action} completed for ${target.processName} "${target.title}".`;
  return {
    result,
    action: input.action,
    ok: true,
    requiresConfirmation: false,
    window: target,
    blockedReasons: [],
    warnings: safety.warnings,
  };
}

function blockedResult(
  input: ComputerUseInput,
  safety: SafetyAssessment,
  window?: ComputerUseWindow,
): ComputerUseResult {
  return {
    result: formatComputerUseResult(input.action, false, safety.blockedReasons, safety.warnings, undefined, window),
    action: input.action,
    ok: false,
    requiresConfirmation: safety.requiresConfirmation,
    window,
    blockedReasons: safety.blockedReasons,
    warnings: safety.warnings,
  };
}

function formatComputerUseResult(
  action: ComputerUseAction,
  ok: boolean,
  blockedReasons: string[],
  warnings: string[],
  windows?: ComputerUseWindow[],
  window?: ComputerUseWindow,
): string {
  const lines = [
    `Computer Use ${action}.`,
    `OK: ${ok ? "yes" : "no"}`,
  ];
  if (window) lines.push(`Window: ${window.id} ${window.processName} "${window.title}"`);
  if (windows) {
    lines.push(
      `Windows: ${windows.length}`,
      ...windows.slice(0, 40).map((item) =>
        `- ${item.id} ${item.processName} "${item.title}" ${item.width}x${item.height}+${item.x}+${item.y}`,
      ),
    );
  }
  if (blockedReasons.length > 0) {
    lines.push("Blocked:", ...blockedReasons.map((reason) => `- ${reason}`));
  }
  if (warnings.length > 0) {
    lines.push("Warnings:", ...warnings.map((warning) => `- ${warning}`));
  }
  return lines.join("\n");
}

function isStateChangingAction(action: ComputerUseAction): boolean {
  return action === "click"
    || action === "type_text"
    || action === "press_key"
    || action === "launch_app";
}

function normalizeProcessName(name: string | undefined): string {
  return (name ?? "").trim().toLowerCase().replace(/\.exe$/, "");
}

function selectWindow(windows: ComputerUseWindow[], input: ComputerUseInput): ComputerUseWindow {
  if (input.windowId != null) {
    const target = windows.find((window) => window.id === input.windowId);
    if (!target) throw new Error(`Window not found: ${input.windowId}`);
    return target;
  }

  const title = input.title?.trim().toLowerCase();
  const app = input.app?.trim().toLowerCase();
  const matches = windows.filter((window) => {
    const titleMatch = title ? window.title.toLowerCase().includes(title) : true;
    const appMatch = app
      ? window.processName.toLowerCase().includes(app)
        || (window.path ?? "").toLowerCase().includes(app)
      : true;
    return titleMatch && appMatch;
  });
  if (matches.length !== 1) {
    throw new Error(`Expected one matching window, found ${matches.length}. Use list_windows and pass windowId.`);
  }
  return matches[0];
}

async function listWindows(): Promise<ComputerUseWindow[]> {
  const raw = await runPowerShell(LIST_WINDOWS_SCRIPT);
  return JSON.parse(raw) as ComputerUseWindow[];
}

async function screenshotWindow(windowId: number, includeImage: boolean): Promise<ComputerUseScreenshot> {
  const raw = await runPowerShell(buildScreenshotScript(windowId, includeImage));
  return JSON.parse(raw) as ComputerUseScreenshot;
}

async function runPowerShell(script: string): Promise<string> {
  const utf8Script = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$OutputEncoding = [System.Text.Encoding]::UTF8",
    script,
  ].join("\n");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    utf8Script,
  ], {
    windowsHide: true,
    timeout: 20000,
    maxBuffer: 25 * 1024 * 1024,
  });
  return stdout.trim();
}

const USER32_TYPES = String.raw`
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
  public const int SW_RESTORE = 9;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint INPUT_KEYBOARD = 1;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const uint KEYEVENTF_UNICODE = 0x0004;
}
`;

const LIST_WINDOWS_SCRIPT = String.raw`
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Win32List {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@
$items = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object {
  $rect = New-Object Win32List+RECT
  [void][Win32List]::GetWindowRect($_.MainWindowHandle, [ref]$rect)
  $processPath = $null
  try { $processPath = [string]$_.Path } catch { $processPath = $null }
  [pscustomobject]@{
    id = [int64]$_.MainWindowHandle
    title = [string]$_.MainWindowTitle
    processName = [string]$_.ProcessName
    processId = [int]$_.Id
    path = $processPath
    x = [int]$rect.Left
    y = [int]$rect.Top
    width = [int]($rect.Right - $rect.Left)
    height = [int]($rect.Bottom - $rect.Top)
  }
}
@($items) | ConvertTo-Json -Depth 4 -Compress
`;

function buildLaunchScript(app: string): string {
  return `$target = ${psString(app)}; Start-Process -FilePath $target`;
}

function buildActivateScript(windowId: number): string {
  return `
Add-Type @'
${USER32_TYPES}
'@
$hwnd = [IntPtr]${windowId}
[void][Win32]::ShowWindow($hwnd, [Win32]::SW_RESTORE)
[void][Win32]::SetForegroundWindow($hwnd)
"OK"
`;
}

function buildClickScript(windowId: number, x: number, y: number): string {
  return `
Add-Type @'
${USER32_TYPES}
'@
$hwnd = [IntPtr]${windowId}
$rect = New-Object Win32+RECT
[void][Win32]::GetWindowRect($hwnd, [ref]$rect)
[void][Win32]::ShowWindow($hwnd, [Win32]::SW_RESTORE)
[void][Win32]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 120
$sx = [int]($rect.Left + ${Math.round(x)})
$sy = [int]($rect.Top + ${Math.round(y)})
[void][Win32]::SetCursorPos($sx, $sy)
[Win32]::mouse_event([Win32]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
[Win32]::mouse_event([Win32]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
"OK"
`;
}

function buildTypeTextScript(windowId: number, text: string): string {
  return `
Add-Type @'
${USER32_TYPES}
'@
$hwnd = [IntPtr]${windowId}
[void][Win32]::ShowWindow($hwnd, [Win32]::SW_RESTORE)
[void][Win32]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 120
$text = ${psString(text)}
foreach ($ch in $text.ToCharArray()) {
  $down = New-Object Win32+INPUT
  $down.type = [Win32]::INPUT_KEYBOARD
  $down.U.ki.wScan = [uint16][char]$ch
  $down.U.ki.dwFlags = [Win32]::KEYEVENTF_UNICODE
  $up = New-Object Win32+INPUT
  $up.type = [Win32]::INPUT_KEYBOARD
  $up.U.ki.wScan = [uint16][char]$ch
  $up.U.ki.dwFlags = [Win32]::KEYEVENTF_UNICODE -bor [Win32]::KEYEVENTF_KEYUP
  [void][Win32]::SendInput(1, @($down), [Runtime.InteropServices.Marshal]::SizeOf([type][Win32+INPUT]))
  [void][Win32]::SendInput(1, @($up), [Runtime.InteropServices.Marshal]::SizeOf([type][Win32+INPUT]))
}
"OK"
`;
}

function buildPressKeyScript(windowId: number, key: string): string {
  const parts = key.split("+").map((part) => part.trim()).filter(Boolean);
  const press = parts.map(keyToVirtualKey);
  const down = press.map((vk) => sendVk(vk, false)).join("\n");
  const up = [...press].reverse().map((vk) => sendVk(vk, true)).join("\n");
  return `
Add-Type @'
${USER32_TYPES}
'@
$hwnd = [IntPtr]${windowId}
[void][Win32]::ShowWindow($hwnd, [Win32]::SW_RESTORE)
[void][Win32]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 120
function Send-Vk([uint16]$vk, [bool]$keyup) {
  $input = New-Object Win32+INPUT
  $input.type = [Win32]::INPUT_KEYBOARD
  $input.U.ki.wVk = $vk
  if ($keyup) { $input.U.ki.dwFlags = [Win32]::KEYEVENTF_KEYUP }
  [void][Win32]::SendInput(1, @($input), [Runtime.InteropServices.Marshal]::SizeOf([type][Win32+INPUT]))
}
${down}
${up}
"OK"
`;
}

function buildScreenshotScript(windowId: number, includeImage: boolean): string {
  return `
Add-Type -AssemblyName System.Drawing
Add-Type @'
${USER32_TYPES}
'@
$hwnd = [IntPtr]${windowId}
$rect = New-Object Win32+RECT
[void][Win32]::GetWindowRect($hwnd, [ref]$rect)
$width = [Math]::Max(1, [int]($rect.Right - $rect.Left))
$height = [Math]::Max(1, [int]($rect.Bottom - $rect.Top))
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
$stream = New-Object System.IO.MemoryStream
$bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
$bytes = $stream.ToArray()
$graphics.Dispose()
$bitmap.Dispose()
$stream.Dispose()
$data = if (${includeImage ? "$true" : "$false"}) { [Convert]::ToBase64String($bytes) } else { $null }
[pscustomobject]@{ width = $width; height = $height; mimeType = "image/png"; data = $data } | ConvertTo-Json -Compress
`;
}

function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function keyToVirtualKey(key: string): number {
  const normalized = key.trim().toLowerCase();
  const table: Record<string, number> = {
    alt: 0x12,
    alt_l: 0x12,
    backspace: 0x08,
    control: 0x11,
    control_l: 0x11,
    ctrl: 0x11,
    delete: 0x2e,
    down: 0x28,
    end: 0x23,
    escape: 0x1b,
    home: 0x24,
    left: 0x25,
    pagedown: 0x22,
    pageup: 0x21,
    return: 0x0d,
    right: 0x27,
    shift: 0x10,
    shift_l: 0x10,
    space: 0x20,
    tab: 0x09,
    up: 0x26,
  };
  if (table[normalized] != null) return table[normalized];
  if (/^[a-z]$/.test(normalized)) return normalized.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(normalized)) return normalized.charCodeAt(0);
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(normalized)) {
    return 0x70 + Number(normalized.slice(1)) - 1;
  }
  throw new Error(`Unsupported key: ${key}`);
}

function sendVk(vk: number, keyUp: boolean): string {
  return `Send-Vk ${vk} $${keyUp ? "true" : "false"}`;
}
