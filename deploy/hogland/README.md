# Running the bot on Hogland

Hogland is a **dev-sandbox** service, not a 24/7 service runtime. A bot box runs fine, but be aware:

- **Boxes can be reaped** by Karpenter consolidation / EC2 termination (the hogplane reconciler GCs boxes whose pin Pod disappears).
- **There is no auto-restart or auto-resume** — that's deferred work. systemd keeps the bot alive *within* a box; snapshots let you restore a *reaped* box, but nothing does that automatically.

If you want true hands-off 24/7, run it as a Kubernetes Deployment on the same EKS cluster instead (you already have a `Dockerfile`). Use Hogland for development, or for "good enough" hosting with the snapshot safety net below.

## Durable-ish run (systemd + snapshot)

1. Fill in `.env` at the repo root (`cp .env.example .env`, set `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`).
2. Deploy:
   ```bash
   export HOG_HOST=https://hogland.<tailnet>.ts.net
   export HOG_TOKEN=...        # omit if you're on the trusted tailnet
   ./deploy/hogland/deploy.sh
   ```

The script creates a box, installs Node 20 + rsync over SSH, syncs the code, and builds it in the `hog` home (which has the toolchain and your forwarded GitHub key). It then **creates a dedicated, unprivileged `discordbot` user** — a system account with no sudo and no login shell — installs the app to `/opt/discord-bot` owned by that user, and runs `discord-bot.service` under systemd (`Restart=always`) **as `discordbot`, not as `hog`**. So a compromise of the bot process doesn't inherit `hog`'s passwordless sudo. Finally it snapshots the box.

Per-guild config (settings + triggers) lives in `/opt/discord-bot/data` and is **preserved across redeploys** — re-running `deploy.sh` rsyncs new code but leaves the SQLite file in place.

It assumes `ssh_command` looks like `ssh -A -p <port> hog@<ip>` — tweak the two `SSH_OPTS`/`TARGET` lines if your hogland prints a different shape.

### Operating it

```bash
# tail logs
ssh ... -- 'journalctl -u discord-bot -f'
# restart after a config/code change (re-run deploy.sh to push new code)
ssh ... -- 'sudo systemctl restart discord-bot'
```

### If the box gets reaped

Restore from the snapshot the deploy script printed:

```bash
curl -X POST -H "Authorization: Bearer $HOG_TOKEN" -H 'Content-Type: application/json' \
  -d '{"snapshot_id":"<snap>","cpus":2,"memory_mib":1024,"disk_gib":10,"disk_class":"mirrored","ssh_public_key":"<pubkey>"}' \
  "$HOG_HOST/v1/hogboxes"
```

A restored box resumes with full memory state; discord.js will notice the stale gateway socket and reconnect on its own. Re-snapshot periodically (or after any config change made via slash commands, since per-guild config lives in the box's SQLite file) so your restore point stays current.

## Files

- `discord-bot.service` — systemd unit (`Restart=always`, runs as the dedicated non-root `discordbot` user, with `NoNewPrivileges` + `ProtectSystem` hardening).
- `deploy.sh` — one-shot create → sync → build → install-as-discordbot → enable → snapshot.
