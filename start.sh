#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"
for required_command in node npm lsof readlink sleep; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Missing required command: $required_command. Install it or rebuild the development container." >&2
    exit 1
  fi
done

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd -- "$project_root"
ports=("${PORT:-3000}")
pids=()
alive=()

for port in "${ports[@]}"; do
  while IFS= read -r pid; do
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    if [[ "$cwd" != "$project_root" ]]; then
      echo "Port $port is in use by another process; refusing to stop it." >&2
      exit 1
    fi
    [[ " ${pids[*]} " == *" $pid "* ]] || pids+=("$pid")
  done < <(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
done

for pid in "${pids[@]}"; do
  kill -TERM "$pid" 2>/dev/null || true
done

for _ in {1..100}; do
  alive=()
  for pid in "${pids[@]}"; do
    kill -0 "$pid" 2>/dev/null && alive+=("$pid")
  done
  ((${#alive[@]})) || break
  sleep 0.1
done

for pid in "${alive[@]}"; do
  if [[ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)" == "$project_root" ]]; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
done

for port in "${ports[@]}"; do
  if lsof -nP -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is in use by another process; refusing to stop it." >&2
    exit 1
  fi
done

if [[ -n "${CODESPACE_NAME:-}" && -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
  echo "Frontend: https://${CODESPACE_NAME}-${ports[0]}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
else
  echo "Frontend: http://localhost:${ports[0]}"
fi

exec npm run dev
