#!/usr/bin/env bash
set -euo pipefail


# Probe the first allow-listed host so the check tracks the configured allowlist
PROBE_HOST="$(grep -vE '^[[:space:]]*#' .devcontainer/allowlist.txt | awk 'NF{print $1; exit}')"
if curl -s --connect-timeout 5 -o /dev/null "https://$PROBE_HOST"; then
  echo "[post-start] INFO: egress OK, $PROBE_HOST reachable through gateway"
else
  echo "[post-start] WARNING: $PROBE_HOST not reachable through gateway" >&2
  set +e
  echo "---- egress diagnostics ----" >&2
  echo "routes:" >&2;      ip route show >&2
  echo "resolv.conf:" >&2; cat /etc/resolv.conf >&2
  echo "dns:" >&2;         getent hosts "$PROBE_HOST" >&2 || echo "  cannot resolve $PROBE_HOST" >&2
  echo "curl:" >&2;        curl -sS --connect-timeout 5 -o /dev/null "https://$PROBE_HOST" >&2
  echo "----------------------------" >&2
fi

DENY_HOST=1.1.1.1
# deny check: a non-allow-listed public IP must stay blocked
if curl -k -s --connect-timeout 3 -o /dev/null "https://$DENY_HOST"; then
  echo "[post-start] WARNING: non-allow-listed $DENY_HOST:443 is reachable — egress policy is NOT enforced" >&2
else
  echo "[post-start] INFO: non-allow-listed egress blocked"
fi
