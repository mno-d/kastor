import assert from "node:assert/strict";
import { assessComputerUseSafety } from "./computer-use.js";

{
  const safe = assessComputerUseSafety({
    action: "screenshot",
    windowId: 123,
    purpose: "Inspect app window before UI verification.",
  }, {
    processName: "notepad",
    title: "Untitled - Notepad",
  });
  assert.equal(safe.allowed, true);
  assert.equal(safe.requiresConfirmation, false);
}

{
  const risky = assessComputerUseSafety({
    action: "click",
    windowId: 123,
    x: 10,
    y: 10,
    purpose: "Submit this public form.",
  }, {
    processName: "msedge",
    title: "Example",
  });
  assert.equal(risky.allowed, false);
  assert.equal(risky.requiresConfirmation, true);
  assert.equal(risky.warnings.length > 0, true);
}

{
  const confirmed = assessComputerUseSafety({
    action: "click",
    windowId: 123,
    x: 10,
    y: 10,
    purpose: "Submit this public form after explicit confirmation.",
    confirmed: true,
  }, {
    processName: "msedge",
    title: "Example",
  });
  assert.equal(confirmed.allowed, true);
  assert.equal(confirmed.requiresConfirmation, false);
}

{
  const terminal = assessComputerUseSafety({
    action: "type_text",
    windowId: 123,
    text: "dir",
    purpose: "Type into terminal.",
  }, {
    processName: "powershell",
    title: "Windows PowerShell",
  });
  assert.equal(terminal.allowed, false);
  assert.equal(terminal.blockedReasons.some((reason) => reason.includes("terminal")), true);
}

{
  const selfControl = assessComputerUseSafety({
    action: "click",
    windowId: 123,
    x: 10,
    y: 10,
    purpose: "Click the ChatGPT window.",
  }, {
    processName: "ChatGPT",
    title: "ChatGPT",
  });
  assert.equal(selfControl.allowed, false);
  assert.equal(selfControl.blockedReasons.some((reason) => reason.includes("ChatGPT")), true);
}

{
  const windowsKey = assessComputerUseSafety({
    action: "press_key",
    windowId: 123,
    key: "Windows+r",
    purpose: "Open run dialog.",
  }, {
    processName: "notepad",
    title: "Untitled - Notepad",
  });
  assert.equal(windowsKey.allowed, false);
  assert.equal(windowsKey.blockedReasons.some((reason) => reason.includes("Windows-key")), true);
}
