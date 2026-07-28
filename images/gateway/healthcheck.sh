#!/usr/bin/env bash
set -euo pipefail

die() { echo "[healthcheck] ERROR: $*" >&2; exit 1; }

# Probe the first allow-listed entry: connect to its address on its first port.
first="$(grep -vhE '^[[:space:]]*(#|$)' /config/allowlist.txt | sed 's/#.*//' | grep -m1 .)" || true
read -r ADDR PORT _ <<<"$first"
[ -n "$ADDR" ] && [ -n "$PORT" ] || die "allowlist has no usable entry"

# A domain resolves through dnsmasq (which also seeds the ipset); an IP is used as-is.
case "$ADDR" in
  *[a-zA-Z]*) IP="$(nslookup "$ADDR" 127.0.0.1 2>/dev/null \
                    | awk '/^Name/{f=1} f && /Address/ && $NF ~ /^[0-9]+(\.[0-9]+){3}$/ {print $NF; exit}')" || true ;;
  *)          IP="$ADDR" ;;
esac
[ -n "$IP" ] || die "dnsmasq did not resolve $ADDR"

nc -w3 "$IP" "$PORT" </dev/null >/dev/null 2>&1 \
  || die "no egress - TCP $PORT to $ADDR ($IP) failed"
