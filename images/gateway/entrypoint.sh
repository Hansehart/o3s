#!/usr/bin/env bash
#
# NAME
#        entrypoint.sh — build the gateway's egress policy and run its resolver
#
# DESCRIPTION
#        The gateway's PID 1: fails closed, locates the cage and egress interfaces, turns the
#        allowlist into ipsets and iptables rules, diverts cage HTTPS to the proxy, then execs
#        dnsmasq to resolve allowed domains and populate the sets.
#
# SEE ALSO
#        config.toml, dnsmasq.conf.template, healthcheck.sh

set -euo pipefail

# Fixed image contract for the allowlist mount, the upstream resolver and the generated config.
CONFIG_FILE=/config/config.toml
UPSTREAM_DNS=127.0.0.11
CONF=/etc/dnsmasq.conf

# Local port the proxy listens on
PROXY_PORT=8443

# Expiry for a resolved entry (seconds), refreshed on each resolution. Static seeds never expire.
IPSET_TIMEOUT=3600

# Filled by parse_allowlist and read by everything after it.
PORTS=""                    # distinct ports across the whole file
declare -a STATIC_SEEDS=()  # "port address" for each IPv4/CIDR entry
declare -a DOMAIN_LINES=()  # resolver config lines, an upstream and a set line per domain
# Set names per bare domain, unioned so an apex and its wildcard entry share one resolver record.
declare -A DOMAIN_SETS=()

log() { echo "[gateway] INFO: $*"; }
die() { echo "[gateway] ERROR: $*" >&2; exit 1; }

# An address is static when it is an IPv4 host or CIDR, otherwise a domain.
is_ipv4() { [[ "$1" =~ ^[0-9]+(\.[0-9]+){3}(/[0-9]+)?$ ]]; }
is_domain() { [[ "$1" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]]; }
# A wildcard "*." declares a name's subdomains, and the resolver works on the bare domain either way.
bare_domain() { printf '%s' "${1#\*.}"; }

# First (link-scope) subnet on an interface, e.g. 10.10.0.0/24
link_subnet() {
  ip route show dev "$1" scope link | awk '{print $1; exit}'
}

# Deny forwarding before the route and NAT come up, so the cage is denied from the first instruction.
fail_closed() {
  iptables -P FORWARD DROP
  iptables -P INPUT DROP
  ip6tables -P FORWARD DROP 2>/dev/null || true
}

# Key off GW_CAGE_IP, the one hint compose gives, since attach order and routes both mislead here.
locate_interfaces() {
  [ -n "${GW_CAGE_IP:-}" ] || die "GW_CAGE_IP not set (expected from docker-compose environment)"

  # The cage interface holds the known cage IP, and egress is the other non-loopback interface.
  ADDRS="$(ip -o -4 addr show)"
  CAGE_IF="$(echo "$ADDRS" | awk -v ip="$GW_CAGE_IP" '{split($4,a,"/"); if (a[1]==ip) {print $2; exit}}')"
  [ -n "$CAGE_IF" ] || die "no interface holds cage IP $GW_CAGE_IP"

  CAGE_SUBNET="$(link_subnet "$CAGE_IF")"
  [ -n "$CAGE_SUBNET" ] || die "cannot determine cage subnet on $CAGE_IF"

  EGRESS_IF="$(echo "$ADDRS" | awk -v c="$CAGE_IF" '$2 != "lo" && $2 != c {print $2; exit}')"
  [ -n "$EGRESS_IF" ] || die "cannot find egress interface (is the gateway attached to the egress network?)"

  # The gateway's own default route must exit via egress, at the .1 of that subnet.
  EGRESS_NET="$(link_subnet "$EGRESS_IF")"
  [ -n "$EGRESS_NET" ] || die "cannot determine egress subnet on $EGRESS_IF"
  EGRESS_GW="${EGRESS_NET%/*}"; EGRESS_GW="${EGRESS_GW%.*}.1"
  ip route replace default via "$EGRESS_GW" dev "$EGRESS_IF"

  log "egress=$EGRESS_IF (gw $EGRESS_GW)  cage=$CAGE_IF ($CAGE_SUBNET, gw $GW_CAGE_IP)"
}

# One set per distinct port, with static addresses seeding theirs directly and domains on resolve.
parse_allowlist() {
  # Read each host's ports and optional secret, failing on malformed config.
  local config_tsv
  config_tsv="$(yq -p=toml -o=tsv \
    '[ to_entries | .[] | [.key, (.value.ports | join(" ")), (.value.secret // "")] ]' \
    "$CONFIG_FILE")" || die "config file $CONFIG_FILE is not valid TOML"

  # Validate each entry and sort it into a static seed or a domain's set list.
  while IFS=$'\t' read -r addr ports secret; do
    [ -n "$addr" ] || continue
    [ -n "$ports" ] || die "host $addr has no port"
    case "$addr" in *:*) die "IPv6 address $addr unsupported (gateway is IPv4-only)";; esac
    domain="$(bare_domain "$addr")"
    is_ipv4 "$addr" || is_domain "$domain" \
      || die "invalid address $addr (a wildcard is written as *.example.com)"
    # Injection identifies the host by SNI, so an inject-host must be a domain.
    if [ -n "$secret" ] && is_ipv4 "$addr"; then
      die "inject-host $addr needs a hostname not an IP"
    fi

    # Each port contributes its own set, joined into the entry's domain.
    for p in $ports; do
      case "$p" in ''|*[!0-9]*) die "invalid port $p for $addr";; esac
      { [ "$p" -ge 1 ] && [ "$p" -le 65535 ]; } || die "port $p out of range for $addr"
      case " $PORTS " in *" $p "*) ;; *) PORTS="$PORTS $p";; esac
      if is_ipv4 "$addr"; then
        STATIC_SEEDS+=("$p $addr")
      else
        case ",${DOMAIN_SETS[$domain]:-}," in
          *",allowed-p$p,"*) ;;
          *) DOMAIN_SETS[$domain]="${DOMAIN_SETS[$domain]:+${DOMAIN_SETS[$domain]},}allowed-p$p" ;;
        esac
      fi
    done
  done <<< "$config_tsv"

  # Each domain gets its own upstream, plus the set line capturing what it resolves to.
  for domain in "${!DOMAIN_SETS[@]}"; do
    DOMAIN_LINES+=("server=/$domain/$UPSTREAM_DNS")
    DOMAIN_LINES+=("ipset=/$domain/${DOMAIN_SETS[$domain]}")
  done

  [ -n "$PORTS" ] || die "config file $CONFIG_FILE has no hosts"
}

# One set per port, holding resolved hosts and static subnets alike so either matches a packet.
create_sets() {
  for p in $PORTS; do
    ipset create "allowed-p$p" hash:net timeout "$IPSET_TIMEOUT" -exist
  done

  # Addresses named directly, which carry no name to check and so keep the address-only path.
  ipset create static-hosts hash:net timeout 0 -exist
}

# Forwarding is set from outside this container, so verify it rather than write it.
require_forwarding() {
  [ "$(cat /proc/sys/net/ipv4/ip_forward)" = 1 ] || die "net.ipv4.ip_forward is not enabled (set it via docker-compose sysctls)"
}

# Turn the parsed sets into NAT, INPUT and FORWARD rules.
apply_firewall() {
  # NAT the cage out, added idempotently so the rules already in this table survive.
  iptables -t nat -C POSTROUTING -s "$CAGE_SUBNET" -o "$EGRESS_IF" -j MASQUERADE 2>/dev/null \
    || iptables -t nat -A POSTROUTING -s "$CAGE_SUBNET" -o "$EGRESS_IF" -j MASQUERADE

  # Divert cage HTTPS to the proxy, which decides the name once the address is already allowed.
  if ipset list -n allowed-p443 >/dev/null 2>&1; then
    iptables -t nat -C PREROUTING -s "$CAGE_SUBNET" -p tcp --dport 443 -m set --match-set allowed-p443 dst -m set ! --match-set static-hosts dst -j REDIRECT --to-ports "$PROXY_PORT" 2>/dev/null \
      || iptables -t nat -A PREROUTING -s "$CAGE_SUBNET" -p tcp --dport 443 -m set --match-set allowed-p443 dst -m set ! --match-set static-hosts dst -j REDIRECT --to-ports "$PROXY_PORT"
  fi

  # Clamp MSS to path MTU on SYN to avoid stalls through nested NAT.
  iptables -t mangle -F FORWARD
  iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu

  # Only cage DNS, loopback and return traffic reach the gateway itself.
  iptables -F INPUT
  iptables -A INPUT -i lo -j ACCEPT
  iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  iptables -A INPUT -s "$CAGE_SUBNET" -p udp --dport 53 -j ACCEPT
  iptables -A INPUT -s "$CAGE_SUBNET" -p tcp --dport 53 -j ACCEPT
  # A diverted packet arrives locally, so admit it here.
  iptables -A INPUT -s "$CAGE_SUBNET" -p tcp --dport "$PROXY_PORT" -j ACCEPT
  iptables -A INPUT -p icmp -j ACCEPT

  # Default-deny, so only allow-listed destinations leave the cage on their declared ports.
  iptables -F FORWARD
  iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  # One rule per port, pairing it with the set of addresses allowed on it.
  for p in $PORTS; do
    iptables -A FORWARD -s "$CAGE_SUBNET" -p tcp -m set --match-set "allowed-p$p" dst --dport "$p" -j ACCEPT
  done
  # Deny cage QUIC/HTTP-3, since interception is TCP-only and UDP would bypass the proxy.
  iptables -A FORWARD -s "$CAGE_SUBNET" -p udp -m multiport --dports 80,443 -j REJECT --reject-with icmp-port-unreachable
  # Fail fast instead of hanging on blocked connections.
  iptables -A FORWARD -j REJECT --reject-with icmp-admin-prohibited
}

# Seed static entries directly, since no resolution will ever fill them.
seed_static() {
  if [ ${#STATIC_SEEDS[@]} -gt 0 ]; then
    for seed in "${STATIC_SEEDS[@]}"; do
      read -r sp saddr <<<"$seed"
      # A zero timeout keeps the entry permanently, since static seeds are added once.
      ipset add -exist "allowed-p$sp" "$saddr" timeout 0
      ipset add -exist static-hosts "$saddr" timeout 0
    done
  fi
}

# Base template plus the generated lines, which point each domain at its upstream and its sets.
write_resolver_conf() {
  sed -e "s#__GW_CAGE_IP__#${GW_CAGE_IP}#g" \
      /etc/dnsmasq.conf.template > "$CONF"

  if [ ${#DOMAIN_LINES[@]} -gt 0 ]; then
    printf '%s\n' "${DOMAIN_LINES[@]}" >> "$CONF"
  fi
}

[ -f "$CONFIG_FILE" ] || die "config file $CONFIG_FILE not found"

fail_closed
locate_interfaces
parse_allowlist
create_sets
require_forwarding
apply_firewall
seed_static
write_resolver_conf

log "loaded ${#DOMAIN_SETS[@]} domain(s) + ${#STATIC_SEEDS[@]} static entry(ies) on port(s)${PORTS}"
log "starting dnsmasq on ${GW_CAGE_IP} port 53 (upstream ${UPSTREAM_DNS})"

# Run the resolver as PID 1.
exec dnsmasq --keep-in-foreground --conf-file="$CONF"
