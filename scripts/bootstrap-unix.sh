#!/usr/bin/env bash
set -euo pipefail

skip_install=0
skip_build=0
run_init=0

for arg in "$@"; do
  case "$arg" in
    --skip-install) skip_install=1 ;;
    --skip-build) skip_build=1 ;;
    --init) run_init=1 ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

require_command() {
  local name="$1"
  local hint="$2"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "$name was not found. $hint" >&2
    exit 1
  fi
}

run_step() {
  local title="$1"
  shift
  echo
  echo "== $title =="
  "$@"
}

run_step "Checking required programs" bash -c '
  command -v node >/dev/null || { echo "Install Node 22 LTS."; exit 1; }
  command -v npm >/dev/null || { echo "Install npm."; exit 1; }
  command -v git >/dev/null || { echo "Install Git."; exit 1; }
  node --version
  npm --version
  git --version
'

require_command bash "Install bash."

if [ "$skip_install" -eq 0 ]; then
  run_step "Installing packages" npm install
fi

if [ "$skip_build" -eq 0 ]; then
  run_step "Building Kastor" npm run build
fi

run_step "Showing setup guide" node ./dist/cli.js setup-guide

if [ "$run_init" -eq 1 ]; then
  run_step "Creating local Kastor config" node ./dist/cli.js init
else
  echo
  echo "Skipped interactive config. Run this when you are ready:"
  echo "  node ./dist/cli.js init"
fi

run_step "Running doctor" node ./dist/cli.js doctor

echo
echo "Bootstrap finished."
echo "Next: start a public HTTPS tunnel, then run 'node ./dist/cli.js serve'."
