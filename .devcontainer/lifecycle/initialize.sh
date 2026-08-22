#!/usr/bin/env bash
set -euo pipefail

log() { echo "[o3s] INFO: $*"; }

ENV_FILE=.devcontainer/.env
CONFIG_FILE=.devcontainer/config.toml

# Seed each editable config file from its template if missing
[ -f "$CONFIG_FILE" ]                   || cp .devcontainer/templates/config.toml "$CONFIG_FILE"
[ -f .devcontainer/o3s.code-workspace ] || cp .devcontainer/templates/o3s.code-workspace .devcontainer/o3s.code-workspace

# Where this host's secrets live
SECRETS_DIR="${O3S_SECRETS_DIR:-$HOME/.config/o3s}"
install -d -m 700 "$SECRETS_DIR"

# This host's egress-proxy CA
bash .devcontainer/proxy/gen-ca.sh

# Seed the real-token file from its template
[ -f "$SECRETS_DIR/secrets.env" ] \
  || install -m 600 .devcontainer/templates/secrets.env "$SECRETS_DIR/secrets.env"

# Collect the secret name each credential-inject host declares
SECRETS="$(grep -oE '^[[:space:]]*secret[[:space:]]*=[[:space:]]*"[^"]+"' "$CONFIG_FILE" \
           | sed -E 's/.*"([^"]+)"/\1/' || true)"

# Carry the marker across runs so a rebuild keeps the value the cage already holds
MARKER="$(sed -n 's/^O3S_MARKER=//p' "$ENV_FILE" 2>/dev/null || true)"
MARKER="${MARKER:-o3s-$(openssl rand -hex 32)}"

# Regenerate the values compose needs at create time
{
  echo "# Generated on every start. Put your own variables in devcontainer.json."
  echo
  echo "O3S_MARKER=$MARKER"
  echo "O3S_UID=$(id -u)"
  echo "O3S_GID=$(id -g)"
} > "$ENV_FILE.new"
mv "$ENV_FILE.new" "$ENV_FILE"

# Give each declared secret a slot to hold its real token, leaving filled-in lines untouched
ADDED=""
for name in $SECRETS; do
  grep -q "^$name=" "$SECRETS_DIR/secrets.env" || {
    echo "$name=" >> "$SECRETS_DIR/secrets.env"
    ADDED="${ADDED:+$ADDED }$name"
  }
done
if [ -n "$ADDED" ]; then
  log "add real tokens for $ADDED to $SECRETS_DIR/secrets.env"
fi
