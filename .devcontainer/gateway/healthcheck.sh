#!/usr/bin/env bash
set -euo pipefail

# Probe the first allow-listed host
HOST="$(awk '!/^[[:space:]]*(#|$)/ {print $1; exit}' /config/allowed-domains.txt)"
[ -n "$HOST" ] || { echo "healthcheck: allowlist is empty, no host to probe" >&2; exit 1; }

IP="$(nslookup "$HOST" 127.0.0.1 2>/dev/null \
      | awk '/^Name/{f=1} f && /Address/ && $NF ~ /^[0-9]+(\.[0-9]+){3}$/ {print $NF; exit}')" || true
[ -n "$IP" ] || { echo "healthcheck: dnsmasq did not resolve $HOST" >&2; exit 1; }

nc -w3 "$IP" 443 </dev/null >/dev/null 2>&1 \
  || { echo "healthcheck: no egress - TCP 443 to $HOST ($IP) failed" >&2; exit 1; }
