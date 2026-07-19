#!/usr/bin/env bash
set -euo pipefail

# Seed the editable config files from their templates on first run
cp -n .devcontainer/.env.template .devcontainer/.env
cp -n .devcontainer/config/allowlist.txt.template .devcontainer/config/allowlist.txt
