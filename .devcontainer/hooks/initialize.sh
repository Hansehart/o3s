#!/usr/bin/env bash
set -euo pipefail

log() { echo "[o3s] INFO: $*"; }

# Seed each editable config file from its template if missing
[ -f .devcontainer/.env ]               || cp .devcontainer/templates/.env .devcontainer/.env
[ -f .devcontainer/config.toml ]        || cp .devcontainer/templates/config.toml .devcontainer/config.toml
[ -f .devcontainer/o3s.code-workspace ] || cp .devcontainer/templates/o3s.code-workspace .devcontainer/o3s.code-workspace

# Where this host's secrets live
SECRETS_DIR="${O3S_SECRETS_DIR:-$HOME/.config/o3s}"
install -d -m 700 "$SECRETS_DIR"

# This host's egress-proxy CA (idempotent)
bash .devcontainer/mitm/gen-ca.sh

# Seed the real-token file from its template
if [ ! -f "$SECRETS_DIR/secrets.env" ]; then
  install -m 600 .devcontainer/templates/secrets.env "$SECRETS_DIR/secrets.env"
  log "add real tokens to $SECRETS_DIR/secrets.env"
fi

# Generate and apply the injection marker (idempotent)
sed -i "s|__O3S_MARKER__|o3s-$(openssl rand -hex 32)|g" .devcontainer/.env
