#!/usr/bin/env bash
set -euo pipefail

# Seed the editable config files from templates
cp -n .devcontainer/templates/.env .devcontainer/.env
cp -n .devcontainer/templates/allowlist.txt .devcontainer/allowlist.txt
cp -n .devcontainer/templates/o3s.code-workspace .devcontainer/o3s.code-workspace

# Where this host's secrets live
SECRETS_DIR="${O3S_SECRETS_DIR:-$HOME/.config/o3s}"
# Provision this host's per-machine secrets outside the repo
bash .devcontainer/mitm/gen-ca.sh
# Seed the token map from its template, first run only
[ -f "$SECRETS_DIR/inject.env" ] || install -m 600 .devcontainer/templates/inject.env "$SECRETS_DIR/inject.env"
