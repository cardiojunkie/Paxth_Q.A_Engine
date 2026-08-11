#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
ports=(3000 24678)
pids=()

for port in "${ports[@]}"; do
  while IFS= read -r pid; do
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    [[ "$cwd" == "$project_root" ]] || continue
    [[ " ${pids[*]} " == *" $pid "* ]] || pids+=("$pid")
  done < <(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
done

for pid in "${pids[@]}"; do
  kill -TERM "$pid" 2>/dev/null || true
done

for _ in {1..20}; do
  alive=()
  for pid in "${pids[@]}"; do
    kill -0 "$pid" 2>/dev/null && alive+=("$pid")
  done
  ((${#alive[@]})) || break
  sleep 0.1
done

for pid in "${alive[@]}"; do
  kill -KILL "$pid" 2>/dev/null || true
done

for port in "${ports[@]}"; do
  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is in use by another process; refusing to stop it." >&2
    exit 1
  fi
done

exec npm run dev
