#!/usr/bin/env bash
set -euo pipefail

DENY_HOST=1.1.1.1
# A non-allow-listed public IP must stay blocked
if curl -k -s --connect-timeout 3 -o /dev/null "https://$DENY_HOST"; then
  echo "[o3s] WARNING: egress policy not enforced ($DENY_HOST is reachable)" >&2
else
  echo "[o3s] INFO: egress firewall active (non-allowlisted traffic blocked)"
fi
