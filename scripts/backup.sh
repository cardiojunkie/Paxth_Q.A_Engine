#!/usr/bin/env bash
set -euo pipefail

umask 077

migration_env="${1:-/etc/paxth-qa/migrate.env}"
backup_dir="${2:-${BACKUP_DIR:-/var/backups/paxth-qa}}"
daily_keep="${BACKUP_DAILY_KEEP:-7}"
weekly_keep="${BACKUP_WEEKLY_KEEP:-4}"

if [[ ! -f "$migration_env" ]] || ! grep -q '^DATABASE_MIGRATION_URL=.' "$migration_env"; then
  echo "A migration env file containing DATABASE_MIGRATION_URL is required: $migration_env" >&2
  exit 1
fi

if [[ "$backup_dir" != /* || "$backup_dir" == "/" ]]; then
  echo "Backup directory must be an explicit absolute path below root." >&2
  exit 1
fi

if [[ ! "$daily_keep" =~ ^[1-9][0-9]*$ || ! "$weekly_keep" =~ ^[1-9][0-9]*$ ]]; then
  echo "BACKUP_DAILY_KEEP and BACKUP_WEEKLY_KEEP must be positive integers." >&2
  exit 1
fi

daily_dir="$backup_dir/daily"
weekly_dir="$backup_dir/weekly"
mkdir -p -- "$daily_dir" "$weekly_dir"
exec 9>"$backup_dir/.backup.lock"
if ! flock --nonblock 9; then
  echo "Another database backup is already running." >&2
  exit 1
fi

backup_path="$daily_dir/paxth-$(date -u +%Y%m%d).dump"
temporary_path="$backup_path.partial"
trap 'rm -f -- "$temporary_path"' EXIT

docker run --rm \
  --env-file "$migration_env" \
  postgres:17-alpine \
  sh -euc 'exec pg_dump --dbname="$DATABASE_MIGRATION_URL" --format=custom --no-owner --no-acl' \
  > "$temporary_path"

[[ -s "$temporary_path" ]]
docker run --rm \
  --volume "$temporary_path:/backup.dump:ro" \
  postgres:17-alpine \
  pg_restore --list /backup.dump >/dev/null

mv -- "$temporary_path" "$backup_path"
trap - EXIT

weekly_path="$weekly_dir/paxth-$(date -u +%G-W%V).dump"
if [[ ! -e "$weekly_path" ]]; then
  ln -- "$backup_path" "$weekly_path"
fi

prune() {
  local directory="$1" keep="$2" index files=()
  mapfile -t files < <(find "$directory" -maxdepth 1 -type f -name 'paxth-*.dump' -printf '%f\n' | sort -r)
  for ((index = keep; index < ${#files[@]}; index++)); do
    rm -- "$directory/${files[$index]}"
  done
}

prune "$daily_dir" "$daily_keep"
prune "$weekly_dir" "$weekly_keep"
echo "Verified database backup: $backup_path"
