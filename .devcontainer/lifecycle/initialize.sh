#!/usr/bin/env bash
#
# NAME
#        initialize.sh — prepare this host before the cage is created
#
# DESCRIPTION
#        Seeds each editable config file from its template, creates this host's egress-proxy
#        CA and secret slots, and regenerates the values compose reads at create time.
#
# SEE ALSO
#        devcontainer.json, gen-ca.sh, post-start.sh

set -euo pipefail

log() { echo "[o3s] INFO: $*"; }

ENV_FILE=.devcontainer/.env
CONFIG_FILE=.devcontainer/config.toml

# Seed each editable config file from its template if missing
[ -f "$CONFIG_FILE" ]                   || cp .devcontainer/templates/config.toml "$CONFIG_FILE"
[ -f .devcontainer/o3s.code-workspace ] || cp .devcontainer/templates/o3s.code-workspace .devcontainer/o3s.code-workspace

# Hold this host's secrets in a directory only this account reads
SECRETS_DIR="${O3S_SECRETS_DIR:-$HOME/.config/o3s}"
install -d -m 700 "$SECRETS_DIR"

# Generate this host's egress-proxy CA
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
EMPTY=""
for name in $SECRETS; do
  grep -q "^$name=" "$SECRETS_DIR/secrets.env" \
    || echo "$name=" >> "$SECRETS_DIR/secrets.env"
  # Report every slot still waiting for its token, on this run and each one after
  grep -q "^$name=." "$SECRETS_DIR/secrets.env" \
    || EMPTY="${EMPTY:+$EMPTY, }$name"
done
if [ -n "$EMPTY" ]; then
  log "add real tokens to $SECRETS_DIR/secrets.env: $EMPTY"
fi
