#!/usr/bin/env bash
#
# NAME
#        post-start.sh — probe that the egress policy holds
#
# DESCRIPTION
#        Reports on every container start whether a non-allow-listed address stays refused.
#
# SEE ALSO
#        devcontainer.json, initialize.sh

set -euo pipefail

DENY_HOST=1.1.1.1
# A non-allow-listed public IP must stay blocked
if curl -k -s --connect-timeout 3 -o /dev/null "https://$DENY_HOST"; then
  echo "[o3s] WARNING: egress policy not enforced ($DENY_HOST is reachable)" >&2
else
  echo "[o3s] INFO: egress firewall active (non-allowlisted traffic blocked)"
fi
