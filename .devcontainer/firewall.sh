#!/bin/bash
set -euo pipefail  # Exit on error, undefined vars, and pipeline failures
IFS=$'\n\t'       # Stricter word splitting

CHAIN="DEVCONTAINER-OUTPUT"

# Create or reset the ipsets used by the outbound allowlist.
ipset create allowed-domains hash:net -exist
ipset create github-git hash:net -exist
ipset flush allowed-domains
ipset flush github-git

# Fetch GitHub meta information and aggregate + add their IP ranges
echo "Fetching GitHub IP ranges..."
gh_ranges=$(curl -s https://api.github.com/meta)
if [ -z "$gh_ranges" ]; then
    echo "ERROR: Failed to fetch GitHub IP ranges"
    exit 1
fi

if ! echo "$gh_ranges" | jq -e '.api and .git' >/dev/null; then
    echo "ERROR: GitHub API response missing required fields"
    exit 1
fi

echo "Processing GitHub api+git IPs (HTTPS)..."
while read -r cidr; do
    if [[ ! "$cidr" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$ ]]; then
        echo "ERROR: Invalid CIDR range from GitHub meta: $cidr"
        exit 1
    fi
    echo "Adding GitHub range $cidr"
    ipset add allowed-domains "$cidr" -exist
done < <(echo "$gh_ranges" | jq -r '(.api + .git)[]' | aggregate -q)

echo "Processing GitHub git IPs (SSH)..."
while read -r cidr; do
    if [[ ! "$cidr" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$ ]]; then
        echo "ERROR: Invalid CIDR range from GitHub meta: $cidr"
        exit 1
    fi
    echo "Adding GitHub git range $cidr"
    ipset add github-git "$cidr" -exist
done < <(echo "$gh_ranges" | jq -r '.git[]' | aggregate -q)

# Load allowed domains from a plain text allowlist file (path passed as first argument)
ALLOWLIST_FILE="${1:?Usage: firewall.sh <path-to-allowed-domains-file>}"
if [ ! -f "$ALLOWLIST_FILE" ]; then
    echo "ERROR: Allowlist file not found: $ALLOWLIST_FILE"
    exit 1
fi

# Resolve and add allowed domains
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
        ipset add allowed-domains "$ip" -exist
    done < <(echo "$ips")
done < "$ALLOWLIST_FILE"

# Get host IP from default route
HOST_IP=$(ip route | grep default | cut -d" " -f3)
if [ -z "$HOST_IP" ]; then
    echo "ERROR: Failed to detect host IP"
    exit 1
fi

HOST_NETWORK=$(echo "$HOST_IP" | sed "s/\.[0-9]*$/.0\/24/")
echo "Host network detected as: $HOST_NETWORK"

# Manage our own chain only
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

echo "Firewall configuration complete"
echo "Verifying firewall rules..."
if curl --connect-timeout 5 https://example.com >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - was able to reach https://example.com"
    exit 1
else
    echo "Firewall verification passed - unable to reach https://example.com as expected"
fi

# Verify GitHub API access
if ! curl --connect-timeout 5 https://api.github.com/zen >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - unable to reach https://api.github.com"
    exit 1
else
    echo "Firewall verification passed - able to reach https://api.github.com as expected"
fi
