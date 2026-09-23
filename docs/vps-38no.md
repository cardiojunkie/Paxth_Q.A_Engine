# vps-38no deployment

Installed on 2026-09-22. Connect with `ssh root@162.19.81.122 -p 20083`.

| App | Public URL | Service / local listener |
| --- | --- | --- |
| QA Engine | https://vps-38no.tail608e42.ts.net/ | `paxth-qa`, `127.0.0.1:3200` |
| OpenMausBot | https://openmausbot-38no.tail608e42.ts.net/ | `openmausbot`, `127.0.0.1:8799` |

QA uses the existing Supabase database and existing administrator account. OpenMausBot requires the unchanged Caddy gateway credentials supplied at handoff, followed by its own device pairing. QA now uses the existing AICredits API key; OpenMausBot's AI provider remains unconfigured.

Initial deployment verification covered public HTTPS, real browser sign-in, existing catalog/rules, OpenMausBot pairing and session revocation, anonymous API rejection, forged forwarding headers, and service/Funnel persistence after restart. QA's build, unit/API/database/browser checks and Python scraper checks passed on this host. After configuring QA's existing key, one live test of the saved `deepseek/deepseek-v4-flash` model passed (2,029 tokens; provider-reported cost approximately INR 0.1563). Test sessions were revoked.

The previous OpenMausBot URL on port 8443 timed out on the user's network while working from the deployment environment. The new hostname uses standard HTTPS 443 to avoid that port dependency. The old `https://vps-38no.tail608e42.ts.net:8443/` route now returns a 308 redirect, preserving the path and query. New-host verification passed for the public password gate, the actual browser pairing form and workspace, protected APIs, session revocation, and persistence after restarting both OpenMausBot and its dedicated Tailscale service. The user's original network restriction was not independently identified.

## Files and services

- QA: `/opt/paxth-qa/current` points to a versioned release. Private environment: `/opt/paxth-qa/.env`, owned by `paxth`, mode `0600`. Python environment: `/opt/paxth-qa/venv`. Browser cache and writable state: `/home/paxth`.
- OpenMausBot: published npm package `openmausbot@0.1.85`, installed under `/home/maus/.local`; persistent data in `/home/maus/.openmausbot`. Runs as `maus`.
- Both systemd services restart automatically and have a 1,536 MiB memory ceiling and one CPU quota. Unit files are in `/etc/systemd/system/`.
- Node 24 is installed under `/opt/node`; the exact patch version and source archive hash are recorded in `/opt/paxth-qa/DEPLOYMENT.txt`.
- Caddy: `/etc/caddy/Caddyfile`, loopback listeners `8082` and `8083`, admin API disabled. The OpenMausBot gateway stores a password hash. Forwarded traffic remains subject to the apps' own authentication.
- Tailscale: persistent userspace networking because this LXC host has no TUN device. The original `tailscaled` service maps the QA hostname's HTTPS 443 to Caddy 8082. The separate `tailscaled-openmausbot` service maps OpenMausBot's hostname on HTTPS 443 to Caddy 8083; its socket is `/run/tailscale-openmausbot/tailscaled.sock`, state/certificates are in `/var/lib/tailscale-openmausbot`, and UDP port is 41642. Its unit explicitly sets `--statedir`, required for certificate storage. Do not run OpenMausBot's `--tailscale` option: it would manage Serve independently of this Funnel setup.

## Daily operations

```bash
systemctl status paxth-qa openmausbot caddy tailscaled tailscaled-openmausbot --no-pager
tailscale funnel status
tailscale --socket=/run/tailscale-openmausbot/tailscaled.sock funnel status
journalctl -u paxth-qa -u openmausbot --since '15 minutes ago' --no-pager
systemctl restart paxth-qa
systemctl restart openmausbot
```

Create a new **five-minute, single-use** administrator pairing invitation:

```bash
sudo -u maus -H /home/maus/.local/bin/openmausbot pair \
  --label 'My browser' --public-url https://openmausbot-38no.tail608e42.ts.net
```

After pairing, OpenMausBot's Remote access settings can pair additional devices and revoke sessions. The extra gateway password remains required in the browser.

The new hostname needs its own browser pairing. A link expires after five minutes; generate a fresh one with the command above if needed. A runnable browser verification is retained at `/root/check-openmausbot-https.mjs`; it accepts `OPENMAUSBOT_GATEWAY_PASSWORD` through the environment, creates and revokes its own temporary paired session, and requires the installed Chromium and QA dependencies.

Change the QA password in its Users module. To change the OpenMausBot gateway password, run `caddy hash-password` interactively, replace the hash beside `Aswath` in the Caddyfile, validate with `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`, then `systemctl restart caddy`.

QA's server-only `/opt/paxth-qa/.env` has `LLM_BASE_URL=https://api.aicredits.in/v1` and `LLM_API_KEY` copied securely from the workstation's `AICREDITS_API_KEY`. To rotate it, update this private file and restart `paxth-qa`; the key is never displayed in the app. Use **LLM Settings** to change the model and **Test saved settings** to verify it. The saved DeepSeek model and other settings were preserved. OpenMausBot provider connections are separate; configure its Settings or run its setup command as `maus` while the service is stopped. API-only connections initially support chat; agent CLI sign-in and browser-engine installation are separate setup steps.

## Backups and updates

The initial backup is `/var/backups/paxth-qa/20260922-before-deploy.dump`: a PostgreSQL custom-format backup of the **public application schema**, not Supabase-managed auth/storage schemas. All 12 public tables were restored and their row hashes checked. Startup migrations and database tests passed against the disposable restored database. A second private copy is kept outside this repository on the deployment workstation.

Before QA upgrades, wait for active runs to finish and use PostgreSQL 17+ `pg_dump --format=custom --schema=public --no-owner --no-privileges` against the server's database connection. Keep credentials out of command arguments, make the backup owner-readable only, and copy it to separate storage. Restore into an empty disposable database and run startup checks before promotion.

For a QA release, transfer a clean source archive excluding `.env`, `.git`, dependencies, caches, and `dist`; extract into a new `/opt/paxth-qa/releases/<release>` directory. As `paxth`, run `npm ci`, `npm test`, and `npm run build`. Retain the old release, repoint `current`, restart `paxth-qa`, and verify `/healthz` and login. Roll back code by restoring the previous symlink and restarting. Do not restore an old shared database over newer data automatically.

Back up OpenMausBot with the service stopped, including `.openmausbot`, any provider credential directories, and workspaces under `/home/maus`. For a pinned update:

```bash
systemctl stop openmausbot
sudo -u maus -H npm install --global --prefix /home/maus/.local openmausbot@VERSION
systemctl start openmausbot
```

Retain the previous version and private data backup. Do not restart after a failed install. No automatic application updates or changes to the other VPS deployments are configured.

Gateway and OpenMausBot unit backups from before the HTTPS hostname change are in `/var/backups/paxth-qa/https-fix-20260922/`. Restoring those files reverts the bot's public address to port 8443; validate the restored Caddyfile before restarting Caddy. Do not reset the original Tailscale node, which still serves QA.
