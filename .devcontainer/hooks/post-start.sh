#!/usr/bin/env bash
set -euo pipefail

DENY_HOST=1.1.1.1
# deny check: a non-allow-listed public IP must stay blocked
if curl -k -s --connect-timeout 3 -o /dev/null "https://$DENY_HOST"; then
  echo "[post-start] WARNING: non-allow-listed $DENY_HOST:443 is reachable — egress policy is NOT enforced" >&2
else
  echo "[post-start] INFO: non-allow-listed egress blocked"
fi
