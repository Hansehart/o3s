#!/usr/bin/env bash
set -euo pipefail

# Fixed image contract: config mount point and Docker's embedded resolver.
CONFIG_FILE=/config/config.toml
UPSTREAM_DNS=127.0.0.11

# Local port the proxy listens on
PROXY_PORT=8443

# Default expiry for dnsmasq-resolved ipset entries (seconds). dnsmasq re-adds an
# entry on each resolution, refreshing this timer, so an IP only expires once its
# domain stops being resolved. Static IP/CIDR seeds override this with timeout 0.
IPSET_TIMEOUT=3600

log() { echo "[gateway] INFO: $*"; }
die() { echo "[gateway] ERROR: $*" >&2; exit 1; }

# An address is static when it is an IPv4 host or CIDR, otherwise a domain.
is_ipv4() { [[ "$1" =~ ^[0-9]+(\.[0-9]+){3}(/[0-9]+)?$ ]]; }
is_domain() { [[ "$1" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]]; }

# First (link-scope) subnet on an interface, e.g. 10.10.0.0/24
link_subnet() {
  ip route show dev "$1" scope link | awk '{print $1; exit}'
}

[ -f "$CONFIG_FILE" ] || die "config file $CONFIG_FILE not found"

# 0. fail closed first: default-deny forwarding before the route and NAT come up below,
# so the cage is denied from the first instruction (a fresh netns starts the built-in
# chains at policy ACCEPT). The rules below open allow-listed traffic on top. OUTPUT
# stays ACCEPT so the gateway resolves upstream and runs its healthcheck.
iptables -P FORWARD DROP
iptables -P INPUT DROP
ip6tables -P FORWARD DROP 2>/dev/null || true

# 1. locate the cage vs egress interfaces from the one hint docker-compose gives:
# GW_CAGE_IP, the gateway's own IP on the cage. Interface names (eth0/eth1) follow
# Docker's attach order, and route-based detection is unreliable (busybox
# `ip route show default` prints every route, and the non-internal cage also
# offers a default route), so we key off the known cage IP instead.
[ -n "${GW_CAGE_IP:-}" ] || die "GW_CAGE_IP not set (expected from docker-compose environment)"

# The cage interface holds our known cage IP, and its subnet comes from that interface.
# Egress is the other (non-loopback) interface.
ADDRS="$(ip -o -4 addr show)"
CAGE_IF="$(echo "$ADDRS" | awk -v ip="$GW_CAGE_IP" '{split($4,a,"/"); if (a[1]==ip) {print $2; exit}}')"
[ -n "$CAGE_IF" ] || die "no interface holds cage IP $GW_CAGE_IP"

CAGE_SUBNET="$(link_subnet "$CAGE_IF")"
[ -n "$CAGE_SUBNET" ] || die "cannot determine cage subnet on $CAGE_IF"

EGRESS_IF="$(echo "$ADDRS" | awk -v c="$CAGE_IF" '$2 != "lo" && $2 != c {print $2; exit}')"
[ -n "$EGRESS_IF" ] || die "cannot find egress interface (is the gateway attached to the egress network?)"

# The gateway's own default route must exit via egress: the cage NATs only via this gateway,
# and Docker may hand the gateway a cage default route (which would black-hole both
# the gateway's own traffic and everything it forwards). Point it at the egress
# bridge gateway (.1 of the egress subnet, Docker's convention for bridges).
EGRESS_NET="$(link_subnet "$EGRESS_IF")"
[ -n "$EGRESS_NET" ] || die "cannot determine egress subnet on $EGRESS_IF"
EGRESS_GW="${EGRESS_NET%/*}"; EGRESS_GW="${EGRESS_GW%.*}.1"
ip route replace default via "$EGRESS_GW" dev "$EGRESS_IF"

log "egress=$EGRESS_IF (gw $EGRESS_GW)  cage=$CAGE_IF ($CAGE_SUBNET, gw $GW_CAGE_IP)"

# 2. parse config.toml and build the rule sets.
# Ports are mandatory and explicit, one ipset + FORWARD rule per distinct port. Static
# IPv4/CIDR addresses are seeded straight into their sets. Domains are added by dnsmasq as it
# resolves them. A non-empty `secret` column (from `secret = "..."` in config.toml) marks an
# inject-host: its resolved IPs also land in the inject-hosts set for the PREROUTING REDIRECT.
PORTS=""                    # distinct ports across the whole file
declare -a STATIC_SEEDS=()  # "port address" for each IPv4/CIDR entry
declare -a DOMAIN_LINES=()  # dnsmasq server=/domain/ + ipset=/domain/allowed-pA,allowed-pB lines per domain
DOMAIN_COUNT=0              # distinct domains (DOMAIN_LINES holds two entries each)
HAS_INJECT=""               # set once any host carries a secret (inject-hosts exist)

# Read each host's ports and optional secret, failing on malformed config.
CONFIG_TSV="$(yq -p=toml -o=tsv \
  '[ to_entries | .[] | [.key, (.value.ports | join(" ")), (.value.secret // "")] ]' \
  "$CONFIG_FILE")" || die "config file $CONFIG_FILE is not valid TOML"

while IFS=$'\t' read -r addr ports secret; do
  [ -n "$addr" ] || continue
  [ -n "$ports" ] || die "host $addr has no port"
  case "$addr" in *:*) die "IPv6 address $addr unsupported (gateway is IPv4-only)";; esac
  is_ipv4 "$addr" || is_domain "$addr" || die "invalid address $addr"
  # Injection identifies the host by SNI, so an inject-host must be a domain.
  if [ -n "$secret" ]; then
    if is_ipv4 "$addr"; then die "inject-host $addr needs a hostname not an IP"; fi
    HAS_INJECT=1
  fi

  sets=""
  for p in $ports; do
    case "$p" in ''|*[!0-9]*) die "invalid port $p for $addr";; esac
    { [ "$p" -ge 1 ] && [ "$p" -le 65535 ]; } || die "port $p out of range for $addr"
    case " $PORTS " in *" $p "*) ;; *) PORTS="$PORTS $p";; esac
    if is_ipv4 "$addr"; then
      STATIC_SEEDS+=("$p $addr")
    else
      sets="${sets:+$sets,}allowed-p$p"
    fi
  done
  # Domains get a per-domain upstream (so they resolve now the catch-all is gone) plus the
  # ipset line capturing their resolved IPs. One server= line per domain covers all its ports
  # and subdomains.
  if ! is_ipv4 "$addr"; then
    if [ -n "$secret" ]; then sets="${sets:+$sets,}inject-hosts"; fi
    DOMAIN_LINES+=("server=/$addr/$UPSTREAM_DNS")
    DOMAIN_LINES+=("ipset=/$addr/$sets")
    DOMAIN_COUNT=$((DOMAIN_COUNT + 1))
  fi
done <<< "$CONFIG_TSV"

[ -n "$PORTS" ] || die "config file $CONFIG_FILE has no hosts"

# One ipset per distinct port. hash:net holds both dnsmasq's resolved host IPs
# (added as /32) and our static IPs/CIDRs in the same set, so a packet's
# destination matches whether it is a resolved host or inside an allowed subnet.
# A default timeout expires stale resolved IPs (CDN rotations, reassigned hosts).
# dnsmasq refreshes it on each resolution, and static seeds pin timeout 0 below.
for p in $PORTS; do
  ipset create "allowed-p$p" hash:net timeout "$IPSET_TIMEOUT" -exist
done

# Resolved IPs of inject-hosts, matched by the nat PREROUTING REDIRECT below.
if [ -n "$HAS_INJECT" ]; then
  ipset create inject-hosts hash:net timeout "$IPSET_TIMEOUT" -exist
fi

# 3. routing sysctls
# ip_forward is enabled by docker-compose (sysctls:). /proc/sys is read-only in the
# container, so the entrypoint verifies it is on. (IPv6 forwarding is blocked by the
# ip6tables FORWARD DROP above.)
[ "$(cat /proc/sys/net/ipv4/ip_forward)" = 1 ] || die "net.ipv4.ip_forward is not enabled (set it via docker-compose sysctls)"

# 4. firewall
# NAT the cage out to the internet. Add the rule idempotently: Docker keeps its
# embedded-DNS (127.0.0.11) DNAT/SNAT rules in this table, so flushing it would
# break upstream resolution and the healthcheck with it.
iptables -t nat -C POSTROUTING -s "$CAGE_SUBNET" -o "$EGRESS_IF" -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -s "$CAGE_SUBNET" -o "$EGRESS_IF" -j MASQUERADE

# Divert cage traffic to inject-hosts on :443 to the local proxy sidecar, which injects the
# upstream credential. Scoped to the inject-hosts set, so all other egress stays on the
# FORWARD/ipset path. Redirected packets land on INPUT (local), admitted by the INPUT accept
# below. Append only, preserving Docker's 127.0.0.11 rules that live here too.
if [ -n "$HAS_INJECT" ]; then
  iptables -t nat -C PREROUTING -s "$CAGE_SUBNET" -p tcp --dport 443 -m set --match-set inject-hosts dst -j REDIRECT --to-ports "$PROXY_PORT" 2>/dev/null \
    || iptables -t nat -A PREROUTING -s "$CAGE_SUBNET" -p tcp --dport 443 -m set --match-set inject-hosts dst -j REDIRECT --to-ports "$PROXY_PORT"
fi

# Clamp MSS to path MTU on SYN to avoid TLS stalls through the DinD double-NAT.
iptables -t mangle -F FORWARD
iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu

# INPUT: only DNS (from the cage) + loopback + return traffic reach the gateway.
iptables -F INPUT
iptables -A INPUT -i lo -j ACCEPT
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -s "$CAGE_SUBNET" -p udp --dport 53 -j ACCEPT
iptables -A INPUT -s "$CAGE_SUBNET" -p tcp --dport 53 -j ACCEPT
# Admit cage traffic REDIRECTed to the proxy sidecar. The REDIRECT rewrites the dst to a
# local address, so the packet arrives on INPUT, where this rule admits it.
if [ -n "$HAS_INJECT" ]; then
  iptables -A INPUT -s "$CAGE_SUBNET" -p tcp --dport "$PROXY_PORT" -j ACCEPT
fi
iptables -A INPUT -p icmp -j ACCEPT

# FORWARD: default-deny, so only allow-listed destinations leave the cage, each on the
# port(s) its entry declared.
iptables -F FORWARD
iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
for p in $PORTS; do
  iptables -A FORWARD -s "$CAGE_SUBNET" -p tcp -m set --match-set "allowed-p$p" dst --dport "$p" -j ACCEPT
done
# Deny cage QUIC/HTTP-3: transparent interception is TCP-only, so open UDP 80/443 would let an
# inject-host be reached over HTTP/3, bypassing the proxy. (The catch-all below also covers it.)
iptables -A FORWARD -s "$CAGE_SUBNET" -p udp -m multiport --dports 80,443 -j REJECT --reject-with icmp-port-unreachable
# Fail fast instead of hanging on blocked connections.
iptables -A FORWARD -j REJECT --reject-with icmp-admin-prohibited

# Seed static IP/CIDR entries directly (domains are populated by dnsmasq on resolve).
if [ ${#STATIC_SEEDS[@]} -gt 0 ]; then
  for seed in "${STATIC_SEEDS[@]}"; do
    read -r sp saddr <<<"$seed"
    # timeout 0 = keep permanently: static seeds are added once.
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

log "loaded ${DOMAIN_COUNT} domain(s) + ${#STATIC_SEEDS[@]} static entry(ies) on port(s)${PORTS}"
log "starting dnsmasq on ${GW_CAGE_IP} port 53 (upstream ${UPSTREAM_DNS})"

# 6. run dnsmasq as PID 1
exec dnsmasq --keep-in-foreground --conf-file="$CONF"
