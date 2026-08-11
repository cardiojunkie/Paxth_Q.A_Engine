# VPS operations

This runbook deploys one operator and one concurrent browser session at `https://enzqm.aiccloud.online`.

## Host baseline

Use an amd64 Ubuntu 24.04 LTS VPS with 2 vCPU, 4 GiB RAM, 40 GiB NVMe storage, 2 GiB swap, a static IPv4 address, and at least 100 GB monthly transfer. No GPU is needed. Upgrade to 4 vCPU, 8 GiB RAM, and 80 GiB storage after any sustained CPU above 80%, RAM above 75%, repeated swap use/OOM, more than 100 SKUs per day, or a deliberate increase above one browser.

Install Docker Engine and the Compose plugin from Docker's official Ubuntu repository. Install `curl`, `openssl`, and `flock` from `util-linux` on the host. Enable unattended security updates.

If the provider has not already configured at least 2 GiB of swap, create one explicit swap file once:

```bash
sudo test ! -e /swapfile
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
printf '/swapfile none swap sw 0 0\n' | sudo tee -a /etc/fstab
```

Point the domain's `A` record to the VPS. Add `AAAA` only after IPv6 routing and filtering are configured. At both the provider firewall and host, allow:

- TCP 22 only from the administrator IP or private VPN.
- TCP 80 and 443 from the internet.
- UDP 443 from the internet for HTTP/3.

Do not expose ports 3000 or 5432. Keep a provider-console session available while changing firewall or SSH rules. Disable SSH password login after key-based access is verified.

With `ADMIN_IPV4` replaced by the actual fixed administration address, the matching host rules are:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from ADMIN_IPV4 to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
```

Docker can bypass ordinary UFW forwarding rules. The Compose network uses the stable bridge name `paxthqa0`. After Docker has created its `DOCKER-USER` chain, restrict the bridge to public HTTPS and every current IPv4 address of the managed PostgreSQL host:

```bash
sudo ./scripts/firewall.sh DB_HOST 5432
sudo netfilter-persistent save
```

Install `iptables-persistent` before saving. Re-run and save the script before a provider DNS/IP change. It preserves same-bridge traffic so Caddy can reach the app, rejects private/reserved/metadata destinations, permits public TCP/UDP 443, permits the resolved database addresses on the selected port, and rejects other new egress. Docker's embedded DNS remains available inside the bridge. Validate the rules and the application from a second SSH session before persisting them.

Application URL validation and browser request interception are still required; host rules are defense in depth, not a replacement.

## Files and secrets

Use these locations:

```text
/opt/paxth-qa/                 repository checkout and deploy.env
/etc/paxth-qa/runtime.env     runtime secrets, root:root 0600
/etc/paxth-qa/migrate.env     migration/backup URL only, root:root 0600
/var/backups/paxth-qa/        verified PostgreSQL dumps, root-only
```

Create the protected directories:

```bash
sudo install -d -o root -g root -m 0700 /etc/paxth-qa /var/backups/paxth-qa
```

Use [.env.example](../.env.example) as the field list, not as a production env file. Put only Compose inputs in `/opt/paxth-qa/deploy.env`. Set `APP_IMAGE` to the exact digest emitted by the release workflow, never `main`, `latest`, or another mutable tag.

Generate the two independent server secrets and the admin hash locally:

```bash
openssl rand -base64 48
openssl rand -base64 32
read -rsp 'Admin password: ' PAXTH_ADMIN_PASSWORD; printf '\n'
printf '%s\n' "$PAXTH_ADMIN_PASSWORD" | npm run auth:hash
unset PAXTH_ADMIN_PASSWORD
```

- The first output is `SESSION_SECRET`.
- The second is `SETTINGS_ENCRYPTION_KEY` and must decode to exactly 32 bytes.
- Put the scrypt record in single quotes in `runtime.env` so its dollar signs remain literal.
- `PUBLIC_ORIGIN` must be exactly `https://enzqm.aiccloud.online`.
- `CLOAKBROWSER_VERSION` must remain the tested exact version until CI passes an upgrade.
- Use a least-privilege `DATABASE_URL` for normal DML and a separate `DATABASE_MIGRATION_URL` role for DDL and dumps. Both URLs require verified TLS, such as `sslmode=verify-full`.

Finish with:

```bash
sudo chown root:root /etc/paxth-qa/runtime.env /etc/paxth-qa/migrate.env
sudo chmod 600 /etc/paxth-qa/runtime.env /etc/paxth-qa/migrate.env
```

Restrict the database provider to the VPS IP when supported. Rotate the database password previously committed to Git and verify the old URL can no longer connect before rewriting history. Then coordinate a maintenance window from a disposable mirror clone:

```bash
git filter-repo --path .env --invert-paths --force
git push --force --all origin
git push --force --tags origin
```

Protect the rewritten default branch immediately and require every collaborator and deployment checkout to re-clone; do not merge commits from an old clone. Confirm with `git log --all -- .env` that no revision remains. Rotate any old browser-stored LLM key after the server-side Settings screen is working.

## Release and deployment

Protect `main` and release tags in GitHub. Add `CLOAKBROWSER_LICENSE_KEY` as an Actions secret. Pull requests run all unlicensed checks; protected `main` and `v*.*.*` release runs additionally download the pinned binary and open `about:blank`. A release tag publishes the semantic tag and `sha-<commit>` tag to `ghcr.io/cardiojunkie/paxth-qa-engine`, then records its immutable digest in a `release.env` artifact.

On the VPS, log in as root to GHCR using a token with only `read:packages`:

```bash
sudo docker login ghcr.io -u cardiojunkie
cd /opt/paxth-qa
sudo ./scripts/deploy.sh /opt/paxth-qa/deploy.env
```

The deployment script:

1. Validates the fixed GHCR digest, domain, root ownership, `0600` secret files, and exact public origin.
2. Creates and verifies a PostgreSQL custom-format dump.
3. Pulls Caddy and the release image.
4. Runs the checked-in migration as a one-shot service.
5. Warms the named browser cache and launches an `about:blank` page with the licensed binary.
6. Starts the app, waits for internal readiness, then replaces Caddy and checks public HTTPS health.

The app filesystem is read-only, capabilities are dropped, `/tmp` is size-bounded, browser concurrency is one, shutdown grace is 180 seconds, and each service retains five 10 MiB local log files. Caddy alone publishes ports; `/readyz` is internal while `/healthz` is public.

Use `SKIP_BACKUP=1` only when a fresh verified backup already exists and the reason is recorded. The deploy deliberately leaves the previous image available. To roll back code, restore the previous digest in `deploy.env` and rerun the same command. Migrations must remain compatible with the previous release; restore the database only when the migration itself damaged data.

## Backups and restore drills

Enable provider-managed point-in-time recovery in addition to the VPS dumps. Install the daily timer:

```bash
sudo install -m 0644 deploy/systemd/paxth-backup.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/paxth-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now paxth-backup.timer
sudo systemctl start paxth-backup.service
sudo systemctl status paxth-backup.service
```

Each dump is verified with `pg_restore --list`. The script retains the 7 newest daily dumps and one dump from each of the 4 newest ISO weeks under `/var/backups/paxth-qa/{daily,weekly}`. Send that directory to encrypted storage outside both the VPS and database provider. Alert if the timer fails or no daily dump appears within 26 hours.

At least quarterly, restore the newest dump into a separate empty database. Never test restoration over production:

```bash
sudo docker run --rm \
  --env-file /etc/paxth-qa/restore.env \
  --volume /var/backups/paxth-qa/daily/SELECTED.dump:/backup.dump:ro \
  postgres:17-alpine \
  sh -euc 'pg_restore --dbname="$DATABASE_MIGRATION_URL" --no-owner --no-acl /backup.dump'
```

Run migrations and application smoke tests against the restored database, then destroy only that disposable target.

## Monitoring and maintenance

Routine checks:

```bash
cd /opt/paxth-qa
sudo docker compose --env-file deploy.env ps
sudo docker compose --env-file deploy.env logs --tail 100 app caddy
curl --fail --silent --show-error https://enzqm.aiccloud.online/healthz
df -h
sudo docker system df
systemctl --failed
```

Configure an external HTTPS uptime check and provider alerts at 70%/85% disk, 75% RAM for 15 minutes, 80% CPU for 15 minutes, and any OOM or restart loop. Logs may contain request/job/SKU identifiers, phases, durations, and sanitized errors only—never credentials, authorization headers, full prompts, scraped pages, or uploaded rows.

Review Ubuntu updates, the Node base image, Caddy pin, PostgreSQL client image, npm audit, and CloakBrowser version monthly through a tested release. Back up PostgreSQL and secrets; Caddy state is persistent and the browser cache is replaceable.
