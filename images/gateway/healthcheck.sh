#!/usr/bin/env bash
set -euo pipefail

die() { echo "[healthcheck] ERROR: $*" >&2; exit 1; }

# Probe the first allow-listed host: connect to its address on its first port.
read -r ADDR PORT < <(yq -p=toml -o=tsv '[ to_entries | .[0] | [.key, (.value.ports | .[0])] ]' /config/config.toml) || true
[ -n "$ADDR" ] && [ -n "$PORT" ] || die "config has no usable host"

# A domain resolves through dnsmasq (which also seeds the ipset); an IP is used as-is.
case "$ADDR" in
  *[a-zA-Z]*) IP="$(nslookup "$ADDR" 127.0.0.1 2>/dev/null \
                    | awk '/^Name/{f=1} f && /Address/ && $NF ~ /^[0-9]+(\.[0-9]+){3}$/ {print $NF; exit}')" || true ;;
  *)          IP="$ADDR" ;;
esac
[ -n "$IP" ] || die "dnsmasq did not resolve $ADDR"

nc -w3 "$IP" "$PORT" </dev/null >/dev/null 2>&1 \
  || die "no egress to $ADDR ($IP) on TCP $PORT"
