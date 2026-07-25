#!/usr/bin/env bash
set -euo pipefail

# Seed the editable config files from templates
cp -n .devcontainer/templates/.env .devcontainer/.env
cp -n .devcontainer/templates/allowlist.txt .devcontainer/allowlist.txt
cp -n .devcontainer/templates/o3s.code-workspace .devcontainer/o3s.code-workspace
