#!/usr/bin/env bash
set -euo pipefail

# Fixed image contract: allowlist mount point and Docker's embedded resolver.
ALLOWLIST_FILE=/config/allowlist.txt
UPSTREAM_DNS=127.0.0.11

# Default expiry for dnsmasq-resolved ipset entries (seconds). dnsmasq re-adds an
# entry on each resolution, refreshing this timer, so an IP only expires once its
# domain stops being resolved. Static IP/CIDR seeds override this with timeout 0.
IPSET_TIMEOUT=3600

log() { echo "[gateway] $*"; }
die() { echo "[gateway] $*" >&2; exit 1; }

# An address is static when it is an IPv4 host or CIDR; everything else is a domain.
is_ipv4() { [[ "$1" =~ ^[0-9]+(\.[0-9]+){3}(/[0-9]+)?$ ]]; }

# First (link-scope) subnet on an interface, e.g. 10.10.0.0/24
link_subnet() {
  ip route show dev "$1" scope link | awk '{print $1; exit}'
}

[ -f "$ALLOWLIST_FILE" ] || die "allowlist not found: $ALLOWLIST_FILE"

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

# 2. parse the allowlist: one "address port [port...]" entry per line.
# Ports are mandatory and explicit - one ipset + FORWARD rule per distinct port.
# Static IPv4/CIDR addresses are seeded straight into their sets; domains are added
# by dnsmasq as it resolves them. Inline "# ..." comments are stripped.
PORTS=""                    # distinct ports across the whole file
declare -a STATIC_SEEDS=()  # "port address" for each IPv4/CIDR entry
declare -a DOMAIN_LINES=()  # dnsmasq server=/domain/ + ipset=/domain/allowed-pA,allowed-pB lines per domain
DOMAIN_COUNT=0              # distinct domains (DOMAIN_LINES holds two entries each)

while read -r addr ports; do
  [ -n "$addr" ] || continue
  [ -n "$ports" ] || die "allowlist: '$addr' has no port (format: address port...)"
  case "$addr" in *:*) die "allowlist: IPv6 unsupported (gateway is IPv4-only): $addr";; esac

  sets=""
  for p in $ports; do
    case "$p" in ''|*[!0-9]*) die "allowlist: invalid port '$p' for $addr";; esac
    { [ "$p" -ge 1 ] && [ "$p" -le 65535 ]; } || die "allowlist: port out of range '$p' for $addr"
    case " $PORTS " in *" $p "*) ;; *) PORTS="$PORTS $p";; esac
    if is_ipv4 "$addr"; then
      STATIC_SEEDS+=("$p $addr")
    else
      sets="${sets:+$sets,}allowed-p$p"
    fi
  done
  # Domains get a per-domain upstream (so they resolve at all now the catch-all is
  # gone) plus the ipset line that captures their resolved IPs. One server= line per
  # domain suffices for any number of ports; subdomains are covered automatically.
  if ! is_ipv4 "$addr"; then
    DOMAIN_LINES+=("server=/$addr/$UPSTREAM_DNS")
    DOMAIN_LINES+=("ipset=/$addr/$sets")
    DOMAIN_COUNT=$((DOMAIN_COUNT + 1))
  fi
done < <(grep -vhE '^[[:space:]]*(#|$)' "$ALLOWLIST_FILE" | sed 's/#.*//')

[ -n "$PORTS" ] || die "allowlist is empty: $ALLOWLIST_FILE"

# One ipset per distinct port. hash:net holds both dnsmasq's resolved host IPs
# (added as /32) and our static IPs/CIDRs in the same set, so a packet's
# destination matches whether it is a resolved host or inside an allowed subnet.
# A default timeout expires stale resolved IPs (CDN rotations, reassigned hosts);
# dnsmasq refreshes it on each resolution, and static seeds pin timeout 0 below.
for p in $PORTS; do
  ipset create "allowed-p$p" hash:net timeout "$IPSET_TIMEOUT" -exist
done

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
iptables -t mangle -F FORWARD
iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu

# INPUT: only DNS (from the cage) + loopback + return traffic reach the gateway.
iptables -F INPUT
iptables -P INPUT DROP
iptables -A INPUT -i lo -j ACCEPT
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -s "$CAGE_SUBNET" -p udp --dport 53 -j ACCEPT
iptables -A INPUT -s "$CAGE_SUBNET" -p tcp --dport 53 -j ACCEPT
iptables -A INPUT -p icmp -j ACCEPT

# FORWARD: default-deny; only allow-listed destinations leave the cage, each on the
# port(s) its entry declared.
iptables -F FORWARD
iptables -P FORWARD DROP
iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
for p in $PORTS; do
  iptables -A FORWARD -s "$CAGE_SUBNET" -p tcp -m set --match-set "allowed-p$p" dst --dport "$p" -j ACCEPT
done
# Fail fast instead of hanging on blocked connections.
iptables -A FORWARD -j REJECT --reject-with icmp-admin-prohibited

# No IPv6 leaves the cage.
ip6tables -P FORWARD DROP 2>/dev/null || true

# Seed static IP/CIDR entries directly (domains are populated by dnsmasq on resolve).
if [ ${#STATIC_SEEDS[@]} -gt 0 ]; then
  for seed in "${STATIC_SEEDS[@]}"; do
    read -r sp saddr <<<"$seed"
    # timeout 0 = never expire: nothing re-adds static entries to refresh them.
    ipset add -exist "allowed-p$sp" "$saddr" timeout 0
  done
fi

# 5. generate dnsmasq config: base template + one ipset= line per domain, joining
# all of that domain's port-sets (dnsmasq adds a resolved IP to every listed set).
CONF=/etc/dnsmasq.conf
sed -e "s#__GW_CAGE_IP__#${GW_CAGE_IP}#g" \
    /etc/dnsmasq.conf.template > "$CONF"

if [ ${#DOMAIN_LINES[@]} -gt 0 ]; then
  printf '%s\n' "${DOMAIN_LINES[@]}" >> "$CONF"
fi

log "allowlist: ${DOMAIN_COUNT} domain(s) + ${#STATIC_SEEDS[@]} static entry(ies) on port(s)${PORTS}"
log "starting dnsmasq on ${GW_CAGE_IP}:53 (upstream ${UPSTREAM_DNS})"

# 6. run dnsmasq as PID 1
exec dnsmasq --keep-in-foreground --conf-file="$CONF"
