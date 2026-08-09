#!/usr/bin/env bash
set -euo pipefail

# Seed the editable config files from templates
cp -n .devcontainer/templates/.env .devcontainer/.env
cp -n .devcontainer/templates/config.toml .devcontainer/config.toml
cp -n .devcontainer/templates/o3s.code-workspace .devcontainer/o3s.code-workspace

# Where this host's secrets live
SECRETS_DIR="${O3S_SECRETS_DIR:-$HOME/.config/o3s}"
install -d -m 700 "$SECRETS_DIR"

# This host's egress-proxy CA (idempotent)
bash .devcontainer/mitm/gen-ca.sh

# Seed the real-token file from its template (idempotent)
[ -f "$SECRETS_DIR/secrets.env" ] || install -m 600 .devcontainer/templates/secrets.env "$SECRETS_DIR/secrets.env"

# Generate and apply the injection marker (idempotent)
sed -i "s|__O3S_MARKER__|o3s-$(openssl rand -hex 32)|g" .devcontainer/.env
