# Running the bot on Hogland

Hogland is a **dev-sandbox** service, not a 24/7 service runtime. A bot box runs fine, but be aware:

- **Boxes can be reaped** by Karpenter consolidation / EC2 termination (the hogplane reconciler GCs boxes whose pin Pod disappears).
- **There is no auto-restart or auto-resume** — that's deferred work. systemd keeps the bot alive *within* a box; snapshots let you restore a *reaped* box, but nothing does that automatically.

If you want true hands-off 24/7, run it as a Kubernetes Deployment on the same EKS cluster instead (you already have a `Dockerfile`). Use Hogland for development, or for "good enough" hosting with the snapshot safety net below.

## Durable-ish run (systemd + snapshot)

Run the bot under systemd so it survives crashes and in-box reboots, and snapshot the box so you can restore it if it gets reaped.

Target setup: the bot runs as a dedicated, unprivileged `discordbot` user — a system account with no sudo and no login shell — from `/opt/discord-bot`, under `discord-bot.service` (`Restart=always`), **not as `hog`**, so a compromise of the bot process doesn't inherit `hog`'s passwordless sudo. Per-guild config (settings + triggers) lives in `/opt/discord-bot/data`, which should be preserved across redeploys.

> **Step-by-step deploy instructions: TBD.**

### Operating it

```bash
# tail logs
ssh ... -- 'journalctl -u discord-bot -f'
# restart after a code/config change
ssh ... -- 'sudo systemctl restart discord-bot'
```

### If the box gets reaped

Restore from a snapshot you took of the box:

```bash
curl -X POST -H "Authorization: Bearer $HOG_TOKEN" -H 'Content-Type: application/json' \
  -d '{"snapshot_id":"<snap>","cpus":2,"memory_mib":1024,"disk_gib":10,"disk_class":"mirrored","ssh_public_key":"<pubkey>"}' \
  "$HOG_HOST/v1/hogboxes"
```

A restored box resumes with full memory state; discord.js will notice the stale gateway socket and reconnect on its own. Re-snapshot periodically (or after any config change made via slash commands, since per-guild config lives in the box's SQLite file) so your restore point stays current.

## Files

- `discord-bot.service` — systemd unit (`Restart=always`, runs as the dedicated non-root `discordbot` user, with `NoNewPrivileges` + `ProtectSystem` hardening).
