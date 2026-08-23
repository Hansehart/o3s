#!/usr/bin/env bash
#
# NAME
#        gen-ca.sh — create this host's egress-proxy CA
#
# DESCRIPTION
#        Generates the self-signed root the proxy signs per-host leaf certs with, the public
#        cert the cage trusts, and the DH parameters the proxy loads at startup. Material
#        that already exists is kept.
#
# SEE ALSO
#        initialize.sh, inject.py

set -euo pipefail

log() { echo "[o3s] INFO: $*"; }
die() { echo "[o3s] ERROR: $*" >&2; exit 1; }

# This host's per-machine CA
SECRETS_DIR="${O3S_SECRETS_DIR:-$HOME/.config/o3s}"
CA_PEM="$SECRETS_DIR/mitmproxy-ca.pem"
PUBLIC_CRT="$SECRETS_DIR/mitmproxy-ca.crt"
DH_PEM="$SECRETS_DIR/mitmproxy-dhparam.pem"

# Create the secrets dir with owner-only perms
umask 077
install -d -m 700 "$SECRETS_DIR"

# Create the self-signed root CA once; mitmproxy signs per-host leaf certs with it.
if [ ! -f "$CA_PEM" ]; then
  if ! out="$(openssl req -x509 -newkey rsa:4096 -nodes -days 3650 \
    -keyout "$CA_PEM" -out "$PUBLIC_CRT" \
    -subj "/O=o3s/CN=Egress Proxy CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2>&1)"; then
    echo "$out" >&2
    die "could not generate CA"
  fi
  cat "$PUBLIC_CRT" >> "$CA_PEM"   # mitmproxy reads one PEM: key then cert
  log "generated egress-proxy CA"
fi

# Ensure the cage-trusted public cert exists and is world-readable.
[ -f "$PUBLIC_CRT" ] || openssl x509 -in "$CA_PEM" -out "$PUBLIC_CRT"
chmod 644 "$PUBLIC_CRT"

# Supply the DH parameters the proxy loads at startup, keeping its config dir read-only.
if [ ! -f "$DH_PEM" ]; then
  if ! out="$(openssl dhparam -out "$DH_PEM" 2048 2>&1)"; then
    echo "$out" >&2
    die "could not generate DH parameters"
  fi
  log "generated DH parameters"
fi
