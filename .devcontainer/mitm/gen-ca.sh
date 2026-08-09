#!/usr/bin/env bash
set -euo pipefail

# This host's per-machine CA
SECRETS_DIR="${O3S_SECRETS_DIR:-$HOME/.config/o3s}"
CA_PEM="$SECRETS_DIR/mitmproxy-ca.pem"
PUBLIC_CRT="$SECRETS_DIR/mitmproxy-ca.crt"

# Create the secrets dir with owner-only perms
umask 077
install -d -m 700 "$SECRETS_DIR"

# Create the self-signed root CA once; mitmproxy signs per-host leaf certs with it.
if [ ! -f "$CA_PEM" ]; then
  openssl req -x509 -newkey rsa:4096 -nodes -days 3650 \
    -keyout "$CA_PEM" -out "$PUBLIC_CRT" \
    -subj "/O=o3s/CN=Egress Proxy CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"
  cat "$PUBLIC_CRT" >> "$CA_PEM"   # mitmproxy reads one PEM: key then cert
fi

# Ensure the cage-trusted public cert exists and is world-readable.
[ -f "$PUBLIC_CRT" ] || openssl x509 -in "$CA_PEM" -out "$PUBLIC_CRT"
chmod 644 "$PUBLIC_CRT"
