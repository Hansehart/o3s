#!/usr/bin/env python3
"""
Firewall allowlist manager.

Resolves domains from the allowlist, builds a single ipset, and configures iptables.
"""

import ipaddress
import json
import re
import socket
import subprocess
import sys
import urllib.request
from pathlib import Path

CHAIN = "DEVCONTAINER-OUTPUT"


def run(cmd: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, shell=True, check=check, capture_output=True, text=True)


def to_network(ip: str, prefix: int) -> str:
    return str(ipaddress.ip_network(f"{ip}/{prefix}", strict=False))


def resolve(domain: str) -> list[str]:
    try:
        return list({str(r[4][0]) for r in socket.getaddrinfo(domain, None, socket.AF_INET)})
    except socket.gaierror:
        print(f"WARNING: Failed to resolve {domain}, skipping")
        return []


def parse_allowlist(path: Path) -> list[tuple[str, int]]:
    entries = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if m := re.fullmatch(r"([A-Za-z0-9.-]+)/(\d{1,2})", line):
            domain = m.group(1)
            prefix = int(m.group(2))
            if not (1 <= prefix <= 32):
                print(f"ERROR: Invalid prefix length in: {line}", file=sys.stderr)
                sys.exit(1)
            entries.append((domain, prefix))
        else:
            print(f"ERROR: Invalid entry (expected domain/prefix): {line}", file=sys.stderr)
            sys.exit(1)
    return entries


def fetch_github_ranges() -> list[str]:
    try:
        with urllib.request.urlopen("https://api.github.com/meta", timeout=10) as r:
            meta = json.loads(r.read())
        return [cidr for key in ("git", "api") for cidr in meta.get(key, []) if ":" not in cidr]
    except Exception as e:
        print(f"WARNING: Failed to fetch GitHub IP ranges: {e}", file=sys.stderr)
        return []


def build_ipset(allowlist_path: Path) -> None:
    run("ipset create allowed-domains-shadow hash:net -exist")
    run("ipset flush allowed-domains-shadow")

    for cidr in fetch_github_ranges():
        print(f"Adding {cidr} for github (meta)")
        run(f"ipset add allowed-domains-shadow {cidr} -exist")

    for domain, prefix in parse_allowlist(allowlist_path):
        for ip in resolve(domain):
            cidr = to_network(ip, prefix)
            print(f"Adding {cidr} for {domain}")
            run(f"ipset add allowed-domains-shadow {cidr} -exist")

    run("ipset create allowed-domains hash:net -exist")
    run("ipset swap allowed-domains-shadow allowed-domains")
    run("ipset destroy allowed-domains-shadow")


def build_iptables() -> None:
    route_tokens = run("ip route show default").stdout.split()
    try:
        host_ip = route_tokens[route_tokens.index("via") + 1]
    except (ValueError, IndexError):
        print("ERROR: Failed to detect host IP", file=sys.stderr)
        sys.exit(1)

    run(f"iptables -N {CHAIN}", check=False)
    run(f"iptables -F {CHAIN}")

    for rule in [
        f"-A {CHAIN} -o lo -j ACCEPT",
        f"-A {CHAIN} -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT",
        f"-A {CHAIN} -p udp -d 127.0.0.11 --dport 53 -j ACCEPT",
        f"-A {CHAIN} -p tcp -d 127.0.0.11 --dport 53 -j ACCEPT",
        f"-A {CHAIN} -d {to_network(host_ip, 24)} -j ACCEPT",
        f"-A {CHAIN} -o docker0 -j ACCEPT",
        f"-A {CHAIN} -o br+ -j ACCEPT",
        f"-A {CHAIN} -p tcp -m set --match-set allowed-domains dst --dport 443 -j ACCEPT",
        f"-A {CHAIN} -p tcp -m set --match-set allowed-domains dst --dport 22 -j ACCEPT",
        f"-A {CHAIN} -j REJECT --reject-with icmp-admin-prohibited",
    ]:
        run(f"iptables {rule}")

    while run(f"iptables -C OUTPUT -j {CHAIN}", check=False).returncode == 0:
        run(f"iptables -D OUTPUT -j {CHAIN}")
    run(f"iptables -I OUTPUT 1 -j {CHAIN}")


def build_ip6tables() -> None:
    run(f"ip6tables -N {CHAIN}", check=False)
    run(f"ip6tables -F {CHAIN}")

    for rule in [
        f"-A {CHAIN} -o lo -j ACCEPT",
        f"-A {CHAIN} -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT",
        f"-A {CHAIN} -p udp --dport 53 -j ACCEPT",
        f"-A {CHAIN} -p tcp --dport 53 -j ACCEPT",
        f"-A {CHAIN} -j REJECT --reject-with icmp6-adm-prohibited",
    ]:
        run(f"ip6tables {rule}")

    while run(f"ip6tables -C OUTPUT -j {CHAIN}", check=False).returncode == 0:
        run(f"ip6tables -D OUTPUT -j {CHAIN}")
    run(f"ip6tables -I OUTPUT 1 -j {CHAIN}")


def verify() -> None:
    if run("curl --connect-timeout 5 https://example.com", check=False).returncode == 0:
        print("ERROR: Firewall verification failed — able to reach https://example.com", file=sys.stderr)
        sys.exit(1)
    if run("curl --connect-timeout 5 https://github.com", check=False).returncode != 0:
        print("ERROR: Firewall verification failed — unable to reach https://github.com", file=sys.stderr)
        sys.exit(1)
    print("Firewall configured and verified")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <path-to-allowed-domains-file>", file=sys.stderr)
        sys.exit(1)
    allowlist_path = Path(sys.argv[1])
    if not allowlist_path.exists():
        print(f"ERROR: Allowlist file not found: {allowlist_path}", file=sys.stderr)
        sys.exit(1)

    build_ipset(allowlist_path)
    build_iptables()
    build_ip6tables()
    verify()
