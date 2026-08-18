#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$HOME/.prime/agent/extensions"

mkdir -p "$TARGET_DIR"

# Symlink src/index.ts to ~/.prime/agent/extensions/openai.ts
ln -sf "$SCRIPT_DIR/src/index.ts" "$TARGET_DIR/openai.ts"

# Also update chatgpt-cache-status.ts symlink for backwards compatibility
ln -sf "$SCRIPT_DIR/src/index.ts" "$TARGET_DIR/chatgpt-cache-status.ts"

echo "Installed prime-agent-cache-hit extension -> $TARGET_DIR/openai.ts & $TARGET_DIR/chatgpt-cache-status.ts"
