#!/usr/bin/env bash
set -euo pipefail

# Fixed image contract: allowlist mount points and Docker's embedded resolver.
DOMAINS_FILE=/config/allowed-domains.txt
SSH_FILE=/config/allowed-ssh.txt
UPSTREAM_DNS=127.0.0.11

log() { echo "[gateway] $*"; }
die() { echo "[gateway] $*" >&2; exit 1; }

# Read one or more allowlist files and drop noise
domains_of() {
  grep -vhE '^[[:space:]]*(#|$)' "$@" | awk '{print $1}' | sort -u
}

# First (link-scope) subnet on an interface, e.g. 10.10.0.0/24
link_subnet() {
  ip route show dev "$1" scope link | awk '{print $1; exit}'
}

[ -f "$DOMAINS_FILE" ] || die "allowlist not found: $DOMAINS_FILE"
[ -f "$SSH_FILE" ]     || die "ssh allowlist not found: $SSH_FILE"

# 1. locate the cage vs egress interfaces from the one hint docker-compose gives:
# GW_CAGE_IP, the gateway's own IP on the cage. Interface names (eth0/eth1) follow
# Docker's attach order, and route-based detection is unreliable (busybox
# `ip route show default` prints every route, and the non-internal cage also
# offers a default route), so we key off the known cage IP instead.
[ -n "${GW_CAGE_IP:-}" ] || die "GW_CAGE_IP not set (expected from docker-compose environment)"

# The cage interface holds our known cage IP; its subnet comes from that interface.
# Egress is the other (non-loopback) interface.
ADDRS="$(ip -o -4 addr show)"
CAGE_IF="$(echo "$ADDRS" | awk -v ip="$GW_CAGE_IP" '{split($4,a,"/"); if (a[1]==ip) {print $2; exit}}')"
[ -n "$CAGE_IF" ] || die "no interface holds cage IP $GW_CAGE_IP"

CAGE_SUBNET="$(link_subnet "$CAGE_IF")"
[ -n "$CAGE_SUBNET" ] || die "cannot determine cage subnet on $CAGE_IF"

EGRESS_IF="$(echo "$ADDRS" | awk -v c="$CAGE_IF" '$2 != "lo" && $2 != c {print $2; exit}')"
[ -n "$EGRESS_IF" ] || die "cannot find egress interface (is the gateway attached to the egress network?)"

# The gateway's own default route must exit via egress: the cage has no host NAT,
# and Docker may hand the gateway a cage default route (which would black-hole both
# the gateway's own traffic and everything it forwards). Point it at the egress
# bridge gateway (.1 of the egress subnet - Docker's convention for bridges).
EGRESS_NET="$(link_subnet "$EGRESS_IF")"
[ -n "$EGRESS_NET" ] || die "cannot determine egress subnet on $EGRESS_IF"
EGRESS_GW="${EGRESS_NET%/*}"; EGRESS_GW="${EGRESS_GW%.*}.1"
ip route replace default via "$EGRESS_GW" dev "$EGRESS_IF"

log "egress=$EGRESS_IF (gw $EGRESS_GW)  cage=$CAGE_IF ($CAGE_SUBNET, gw $GW_CAGE_IP)"

# 2. ipsets: allowed-domains (port 443) and allowed-ssh (port 22).
# dnsmasq fills these with the current IP of each allow-listed domain as it is
# resolved, so IP rotation is handled automatically.
# Created if absent and kept across runs so resolved IPs persist.
ipset create allowed-domains hash:ip -exist
ipset create allowed-ssh     hash:ip -exist

# 3. routing sysctls
# ip_forward is enabled by docker-compose (sysctls:); /proc/sys is read-only in
# the container, so we can't set it here — just enforce that it is on. (IPv6
# forwarding is blocked unconditionally by the ip6tables FORWARD DROP below.)
[ "$(cat /proc/sys/net/ipv4/ip_forward)" = 1 ] || die "net.ipv4.ip_forward is not enabled (set it via docker-compose sysctls)"

# 4. firewall
# NAT the cage out to the internet. Add the rule idempotently: Docker keeps its
# embedded-DNS (127.0.0.11) DNAT/SNAT rules in this table, so flushing it would
# break upstream resolution and the healthcheck with it.
iptables -t nat -C POSTROUTING -s "$CAGE_SUBNET" -o "$EGRESS_IF" -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -s "$CAGE_SUBNET" -o "$EGRESS_IF" -j MASQUERADE

# Clamp MSS to path MTU on SYN to avoid TLS stalls through the DinD double-NAT.
iptables -t mangle -F
iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu

# INPUT: only DNS (from the cage) + loopback + return traffic reach the gateway.
iptables -F INPUT
iptables -P INPUT DROP
iptables -A INPUT -i lo -j ACCEPT
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -s "$CAGE_SUBNET" -p udp --dport 53 -j ACCEPT
iptables -A INPUT -s "$CAGE_SUBNET" -p tcp --dport 53 -j ACCEPT
iptables -A INPUT -p icmp -j ACCEPT

# FORWARD: default-deny; only allow-listed destinations on 443/22 leave the cage.
iptables -F FORWARD
iptables -P FORWARD DROP
iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A FORWARD -s "$CAGE_SUBNET" -p tcp -m set --match-set allowed-domains dst --dport 443 -j ACCEPT
iptables -A FORWARD -s "$CAGE_SUBNET" -p tcp -m set --match-set allowed-ssh     dst --dport 22  -j ACCEPT
# Fail fast instead of hanging on blocked connections.
iptables -A FORWARD -j REJECT --reject-with icmp-admin-prohibited

# No IPv6 leaves the cage.
ip6tables -P FORWARD DROP 2>/dev/null || true

# 5. generate dnsmasq allowlist
CONF=/etc/dnsmasq.conf
sed -e "s#__GW_CAGE_IP__#${GW_CAGE_IP}#g" \
    -e "s#__UPSTREAM_DNS__#${UPSTREAM_DNS}#g" \
    /etc/dnsmasq.conf.template > "$CONF"

SSH_DOMAINS="$(domains_of "$SSH_FILE" || true)"
HTTPS_ONLY="$(comm -23 <(domains_of "$DOMAINS_FILE" || true) <(echo "$SSH_DOMAINS") || true)"

# One ipset= line per domain (dnsmasq has a config line-length limit). SSH hosts
# go into both sets (443 + 22); everything else into allowed-domains only.
if [ -n "$SSH_DOMAINS" ]; then
  sed 's#.*#ipset=/&/allowed-domains,allowed-ssh#' <<<"$SSH_DOMAINS" >> "$CONF"
fi
if [ -n "$HTTPS_ONLY" ]; then
  sed 's#.*#ipset=/&/allowed-domains#' <<<"$HTTPS_ONLY" >> "$CONF"
fi

log "allowlist: $(echo "$HTTPS_ONLY" | grep -c . || true) https-only + $(echo "$SSH_DOMAINS" | grep -c . || true) ssh domains"
log "starting dnsmasq on ${GW_CAGE_IP}:53 (upstream ${UPSTREAM_DNS})"

# 6. run dnsmasq as PID 1
exec dnsmasq --keep-in-foreground --conf-file="$CONF"
