#!/usr/bin/env bash
#
# NAME
#        env.sh — expose the allowlist's secret markers to every shell
#
# DESCRIPTION
#        Reads the secret name each credential-inject host declares and writes a profile
#        script pointing that variable at the marker, which the proxy swaps for the real
#        token on egress.
#
# SEE ALSO
#        config.toml, start.sh

set -euo pipefail

die() { echo "[o3s] ERROR: $*" >&2; exit 1; }

# Read the allowlist from the repo mount and expose the markers where every shell picks them up
CONFIG_FILE="${O3S_CONFIG_FILE:-/home/ubuntu/o3s/.devcontainer/config.toml}"
PROFILE_FILE="${O3S_PROFILE_FILE:-/etc/profile.d/o3s-secrets.sh}"

# Collect the secret name each credential-inject host declares
ROWS="$(yq -p=toml -o=tsv '[ to_entries | .[] | [(.value.secret // "")] ]' "$CONFIG_FILE")" \
  || die "$CONFIG_FILE is not valid TOML, markers not updated"
SECRETS="$(printf '%s\n' "$ROWS" | grep -v '^$' || true)"

# Point each provider variable at the marker, which the proxy swaps for the real token on egress
{
  echo "# Generated from config.toml on every container start"
  for name in $SECRETS; do
    echo "export $name=\"\$O3S_MARKER\""
  done
} > "$PROFILE_FILE"
