#!/usr/bin/env bash
#
# NAME
#        healthcheck.sh — report that the gateway carries allow-listed traffic
#
# DESCRIPTION
#        Resolves the first allow-listed host through the local resolver and opens a real
#        connection to it, so the cage starts only once egress works.
#
# SEE ALSO
#        compose.yaml, entrypoint.sh

set -euo pipefail

die() { echo "[healthcheck] ERROR: $*" >&2; exit 1; }

# Probe the first allow-listed host by connecting to its address on its first port.
read -r ADDR PORT < <(yq -p=toml -o=tsv '[ to_entries | .[0] | [.key, (.value.ports | .[0])] ]' /config/config.toml) || true
[ -n "$ADDR" ] && [ -n "$PORT" ] || die "config has no usable host"

# A wildcard entry probes its bare domain, which is what dnsmasq holds either way.
ADDR="${ADDR#\*.}"

# A domain resolves through dnsmasq, which also seeds the ipset, and an IP is used as-is.
case "$ADDR" in
  *[a-zA-Z]*) IP="$(nslookup "$ADDR" 127.0.0.1 2>/dev/null \
                    | awk '/^Name/{f=1} f && /Address/ && $NF ~ /^[0-9]+(\.[0-9]+){3}$/ {print $NF; exit}')" || true ;;
  *)          IP="$ADDR" ;;
esac
[ -n "$IP" ] || die "dnsmasq did not resolve $ADDR"

nc -w3 "$IP" "$PORT" </dev/null >/dev/null 2>&1 \
  || die "no egress to $ADDR ($IP) on TCP $PORT"
