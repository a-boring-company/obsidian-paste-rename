#!/usr/bin/env bash
set -euo pipefail

: "${OBSIDIAN_PLUGINS_DIR:?Set OBSIDIAN_PLUGINS_DIR to the vault .obsidian/plugins directory}"

plugin_dir="$OBSIDIAN_PLUGINS_DIR/obsidian-paste-image-rename"

mkdir -p "$plugin_dir"
cp build/main.js build/styles.css manifest.json "$plugin_dir/"
touch "$plugin_dir/.hotreload"
