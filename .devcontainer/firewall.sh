#!/bin/bash

# Exit on error, undefined vars, and pipeline failures
set -euo pipefail
# Stricter word splitting
IFS=$'\n\t'

CHAIN="DEVCONTAINER-OUTPUT"
ALLOWLIST_FILE="${1:?Usage: firewall.sh <path-to-allowed-domains-file>}"

if [ ! -f "$ALLOWLIST_FILE" ]; then
    echo "ERROR: Allowlist file not found: $ALLOWLIST_FILE"
    exit 1
fi

# ── Phase 1: Build shadow ipsets ─────────────────────────────────────────────
# Shadow sets are populated while live sets remain intact, then swapped
# atomically so the live sets are never empty during a refresh.

ipset create allowed-domains-shadow hash:net -exist
ipset create github-git-shadow hash:net -exist
ipset flush allowed-domains-shadow
ipset flush github-git-shadow

echo "Fetching GitHub IP ranges..."
gh_ranges=$(curl -s https://api.github.com/meta)
if [ -z "$gh_ranges" ] || ! echo "$gh_ranges" | jq -e '.api and .git' >/dev/null; then
    echo "ERROR: Failed to fetch GitHub IP ranges"
    exit 1
fi

echo "$gh_ranges" | jq -r '(.api + .git)[]' | aggregate -q | while read -r cidr; do
    echo "Adding GitHub HTTPS range $cidr"
    ipset add allowed-domains-shadow "$cidr" -exist
done

echo "$gh_ranges" | jq -r '.git[]' | aggregate -q | while read -r cidr; do
    echo "Adding GitHub SSH range $cidr"
    ipset add github-git-shadow "$cidr" -exist
done

while IFS= read -r domain || [ -n "$domain" ]; do
    domain="${domain%$'\r'}"
    [ -z "$domain" ] && continue
    [[ "$domain" =~ ^[[:space:]]*# ]] && continue

    if [[ ! "$domain" =~ ^[A-Za-z0-9.-]+$ ]]; then
        echo "ERROR: Invalid domain in allowlist: $domain"
        exit 1
    fi

    echo "Resolving $domain..."
    ips=$(dig +noall +answer A "$domain" | awk '$4 == "A" {print $5}')
    if [ -z "$ips" ]; then
        echo "WARNING: Failed to resolve $domain, skipping"
        continue
    fi
    while read -r ip; do
        if [[ ! "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
            echo "ERROR: Invalid IP from DNS for $domain: $ip"
            exit 1
        fi
        echo "Adding $ip for $domain"
        ipset add allowed-domains-shadow "$ip" -exist
    done < <(echo "$ips")
done < "$ALLOWLIST_FILE"

# ── Phase 2: Swap shadow into live ───────────────────────────────────────────

ipset create allowed-domains hash:net -exist
ipset create github-git hash:net -exist
ipset swap allowed-domains-shadow allowed-domains
ipset swap github-git-shadow github-git
ipset destroy allowed-domains-shadow
ipset destroy github-git-shadow

# ── Phase 3: Rebuild iptables chain ──────────────────────────────────────────
# Always rebuild so the script self-heals if the chain or OUTPUT jump was
# disrupted by a restart or manual intervention. The brief fail-open window
# during the flush+rebuild is an accepted tradeoff for a devcontainer.

HOST_IP=$(ip route | grep default | cut -d" " -f3)
if [ -z "$HOST_IP" ]; then
    echo "ERROR: Failed to detect host IP"
    exit 1
fi
HOST_NETWORK=$(echo "$HOST_IP" | sed "s/\.[0-9]*$/.0\/24/")

iptables -N "$CHAIN" 2>/dev/null || true
iptables -F "$CHAIN"

# Allow localhost and replies for approved traffic
iptables -A "$CHAIN" -o lo -j ACCEPT
iptables -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# Allow DNS only to Docker's internal resolver to prevent generic DNS tunneling
iptables -A "$CHAIN" -p udp -d 127.0.0.11 --dport 53 -j ACCEPT
iptables -A "$CHAIN" -p tcp -d 127.0.0.11 --dport 53 -j ACCEPT

# Allow access to the host network and inner Docker bridges for local development workflows
iptables -A "$CHAIN" -d "$HOST_NETWORK" -j ACCEPT
iptables -A "$CHAIN" -o docker0 -j ACCEPT
iptables -A "$CHAIN" -o br+ -j ACCEPT

# Allow only specific outbound traffic to approved destinations
iptables -A "$CHAIN" -p tcp -m set --match-set allowed-domains dst --dport 443 -j ACCEPT
iptables -A "$CHAIN" -p tcp -m set --match-set github-git dst --dport 22 -j ACCEPT

# Explicitly reject everything else from this container
iptables -A "$CHAIN" -j REJECT --reject-with icmp-admin-prohibited

# Ensure our chain is first in OUTPUT so later ACCEPT rules cannot bypass the policy
while iptables -C OUTPUT -j "$CHAIN" 2>/dev/null; do
    iptables -D OUTPUT -j "$CHAIN"
done
iptables -I OUTPUT 1 -j "$CHAIN"

# ── Phase 4: Verify ───────────────────────────────────────────────────────────

if curl --connect-timeout 5 https://example.com >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - was able to reach https://example.com"
    exit 1
fi
if ! curl --connect-timeout 5 https://api.github.com/zen >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - unable to reach https://api.github.com"
    exit 1
fi
echo "Firewall configured and verified"
