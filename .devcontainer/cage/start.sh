#!/usr/bin/env bash
set -euo pipefail

# This script's own directory, holding the helpers it calls
CAGE_DIR="$(dirname "$0")"

# Trust this host's proxy CA
update-ca-certificates >/dev/null 2>&1 || true

# Route egress through the gateway
ip route replace default via "$GATEWAY_IP" || true

# Export the markers the allowlist declares
bash "$CAGE_DIR/env.sh" || true

# Hold the container open for the dev container to attach to
exec sleep infinity
