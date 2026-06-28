# OS Setup

Kastor works on Windows, macOS, and Linux when the same basics are available:

- Node.js `>=20.12 <27`
- npm
- Git
- Bash
- a public HTTPS URL for remote MCP clients

Run this first:

```bash
kastor setup-guide
kastor doctor
```

If you are running from a source checkout, you can use the helper script:

```bash
bash ./scripts/bootstrap-unix.sh --init
```

## Windows

Install:

- Node 22 LTS
- Git for Windows
- Git Bash

Use PowerShell for setup commands:

```powershell
npm install
npm run build
kastor init
kastor doctor
```

From a source checkout, this does the same checks and build:

```powershell
.\scripts\bootstrap-windows.ps1 -RunInit
```

Choose a narrow project folder such as:

```text
C:\Users\you\Projects
```

Avoid `C:\` unless this is a private machine and you intentionally want broad
access.

## macOS

Install Node and Git with your preferred package manager:

```bash
brew install node git
```

Then run:

```bash
npm install
npm run build
kastor init
kastor doctor
```

Choose a narrow project folder such as:

```text
~/Projects
```

## Linux

Install Node 22 LTS, Git, and bash using your distribution package manager or a
Node version manager.

Then run:

```bash
npm install
npm run build
kastor init
kastor doctor
```

Choose a narrow project folder such as:

```text
~/projects
```

## Permission Presets

- `project`: current project only. Safest default.
- `projects`: multiple project folders.
- `power`: broader private-machine access. Not for public/shared examples.
