#!/usr/bin/env bash
set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this firewall script as root." >&2
  exit 1
fi

database_host="${1:?Usage: firewall.sh DATABASE_HOST [DATABASE_PORT]}"
database_port="${2:-5432}"
if [[ ! "$database_port" =~ ^[1-9][0-9]{0,4}$ || "$database_port" -gt 65535 ]]; then
  echo "DATABASE_PORT must be from 1 to 65535." >&2
  exit 1
fi

mapfile -t database_ips < <(getent ahostsv4 "$database_host" | awk '{print $1}' | sort -u)
if (( ${#database_ips[@]} == 0 )); then
  echo "DATABASE_HOST did not resolve to an IPv4 address: $database_host" >&2
  exit 1
fi

chain=PAXTH_QA_EGRESS
iptables -N "$chain" 2>/dev/null || true
iptables -F "$chain"
iptables -A "$chain" -o paxthqa0 -j RETURN

for range in \
  0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 \
  172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.168.0.0/16 \
  198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do
  iptables -A "$chain" -d "$range" -j REJECT
done

iptables -A "$chain" -p tcp --dport 443 -j RETURN
iptables -A "$chain" -p udp --dport 443 -j RETURN
for database_ip in "${database_ips[@]}"; do
  iptables -A "$chain" -d "$database_ip/32" -p tcp --dport "$database_port" -j RETURN
done
iptables -A "$chain" -j REJECT

iptables -C DOCKER-USER -i paxthqa0 -j "$chain" 2>/dev/null || \
  iptables -I DOCKER-USER 1 -i paxthqa0 -j "$chain"

echo "Restricted paxthqa0 egress to public HTTPS and $database_host:$database_port (${database_ips[*]})."
