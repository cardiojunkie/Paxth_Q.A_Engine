#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
deploy_env="${1:-$project_dir/deploy.env}"

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this deployment script as root so it can read root-owned secrets and backups." >&2
  exit 1
fi

if [[ ! -f "$deploy_env" ]]; then
  echo "Deployment env file not found: $deploy_env" >&2
  exit 1
fi

env_value() {
  sed -n "s/^$1=//p" "$deploy_env" | tail -n 1
}

runtime_env="$(env_value RUNTIME_ENV_FILE)"
migrate_env="$(env_value MIGRATE_ENV_FILE)"
runtime_env="${runtime_env:-/etc/paxth-qa/runtime.env}"
migrate_env="${migrate_env:-/etc/paxth-qa/migrate.env}"

image="$(env_value APP_IMAGE)"
if [[ ! "$image" =~ ^ghcr\.io/cardiojunkie/paxth-qa-engine@sha256:[0-9a-f]{64}$ ]]; then
  echo "APP_IMAGE must be an immutable ghcr.io/cardiojunkie/paxth-qa-engine digest." >&2
  exit 1
fi

domain="$(env_value APP_DOMAIN)"
if [[ "$domain" != "enzqm.aiccloud.online" ]]; then
  echo "APP_DOMAIN must be enzqm.aiccloud.online in $deploy_env" >&2
  exit 1
fi

for secret_file in "$runtime_env" "$migrate_env"; do
  if [[ ! -f "$secret_file" ]]; then
    echo "Required secret file not found: $secret_file" >&2
    exit 1
  fi
  mode="$(stat -c '%a' "$secret_file")"
  if [[ "$mode" != "600" && "$mode" != "400" ]]; then
    echo "Secret file must have mode 600 or 400: $secret_file (currently $mode)" >&2
    exit 1
  fi
  if [[ "$(stat -c '%u' "$secret_file")" != "0" ]]; then
    echo "Secret file must be owned by root: $secret_file" >&2
    exit 1
  fi
done

for name in DATABASE_URL PUBLIC_ORIGIN ADMIN_USERNAME ADMIN_PASSWORD_SCRYPT SESSION_SECRET SETTINGS_ENCRYPTION_KEY CLOAKBROWSER_LICENSE_KEY CLOAKBROWSER_VERSION; do
  if ! grep -q "^${name}=." "$runtime_env"; then
    echo "Missing $name in $runtime_env" >&2
    exit 1
  fi
done
if ! grep -q '^DATABASE_MIGRATION_URL=.' "$migrate_env"; then
  echo "Missing DATABASE_MIGRATION_URL in $migrate_env" >&2
  exit 1
fi
if grep -Ev '^([[:space:]]*#|[[:space:]]*$|DATABASE_MIGRATION_URL=)' "$migrate_env" | grep -q .; then
  echo "$migrate_env must contain only DATABASE_MIGRATION_URL." >&2
  exit 1
fi
if ! grep -qx "PUBLIC_ORIGIN=https://$domain" "$runtime_env"; then
  echo "PUBLIC_ORIGIN must exactly equal https://$domain in $runtime_env" >&2
  exit 1
fi
if ! grep -qx 'CLOAKBROWSER_VERSION=146.0.7680.177.5' "$runtime_env"; then
  echo "CLOAKBROWSER_VERSION must match the version tested by CI: 146.0.7680.177.5" >&2
  exit 1
fi

compose=(docker compose --project-directory "$project_dir" --env-file "$deploy_env" --file "$project_dir/compose.yaml")
"${compose[@]}" config --quiet

if [[ "${SKIP_BACKUP:-0}" != "1" ]]; then
  "$project_dir/scripts/backup.sh" "$migrate_env" "${BACKUP_DIR:-/var/backups/paxth-qa}"
fi

"${compose[@]}" pull
"${compose[@]}" up --force-recreate --no-deps --abort-on-container-exit --exit-code-from migrate migrate
"${compose[@]}" up --force-recreate --no-deps --abort-on-container-exit --exit-code-from browser-init browser-init
"${compose[@]}" up --detach --force-recreate --no-deps app

app_id="$("${compose[@]}" ps --quiet app)"
for attempt in $(seq 1 60); do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$app_id")"
  if [[ "$health" == "healthy" ]]; then
    break
  fi
  if [[ "$health" == "unhealthy" || "$attempt" == "60" ]]; then
    "${compose[@]}" logs --tail 100 app >&2
    exit 1
  fi
  sleep 3
done

"${compose[@]}" up --detach --force-recreate --no-deps caddy

for attempt in $(seq 1 12); do
  if curl --fail --silent --show-error --max-time 10 "https://$domain/healthz" >/dev/null; then
    "${compose[@]}" ps
    echo "Deployment healthy: https://$domain"
    exit 0
  fi
  sleep 5
done

"${compose[@]}" logs --tail 100 caddy app >&2
exit 1
