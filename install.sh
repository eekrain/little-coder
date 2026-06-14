#!/usr/bin/env bash
# install.sh — installer for little-coder (bun-based)
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/itayinbarr/little-coder/main/install.sh | bash
#   ./install.sh        # run from a clone to link your local working-tree build
set -euo pipefail

say() { printf '\033[1;36m[little-coder]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[little-coder]\033[0m %s\n' "$*" >&2; }

# ---- 1. ensure bun is available ----
if ! command -v bun >/dev/null 2>&1; then
  say "bun not found — installing bun..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://bun.sh/install | bash
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- https://bun.sh/install | bash
  else
    err "Need curl or wget to install bun. See https://bun.sh."
    exit 1
  fi
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi
if ! command -v bun >/dev/null 2>&1; then
  err "bun is still not on PATH. Add '~/.bun/bin' to your PATH and re-run."
  exit 1
fi
say "bun $(bun --version) detected."

BUN_BIN_DIR="$(bun pm bin -g 2>/dev/null || printf '%s/.bun/bin' "$HOME")"

# ---- 2. local repo vs. registry ----
# When run from a clone (./install.sh), BASH_SOURCE resolves to the repo root
# and we link the working-tree build so local edits/commits are live. When piped
# from curl there is no local package, so install the published npm package.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || printf '%s' "$PWD")"
if [ -f "$SCRIPT_DIR/package.json" ] && grep -q '"name": "little-coder"' "$SCRIPT_DIR/package.json" 2>/dev/null; then
  say "Installing little-coder from local repo ($SCRIPT_DIR) via bun link..."
  (
    cd "$SCRIPT_DIR"
    bun install
    bun link
  )
else
  say "Installing little-coder from npm via bun..."
  bun add -g little-coder
fi

# ---- 3. PATH check ----
case ":$PATH:" in
  *":$BUN_BIN_DIR:"*) ;;
  *)
    err "Note: '$BUN_BIN_DIR' is not on your PATH."
    err "Add this to your shell profile (~/.zshrc / ~/.bashrc):"
    err "  export PATH=\"$BUN_BIN_DIR:\$PATH\""
    ;;
esac

say "Installed."
say "Run:    cd ~/your-project && little-coder --model llamacpp/qwen3.6-35b-a3b"
say "Models: little-coder --list-models"
