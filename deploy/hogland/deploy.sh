#!/usr/bin/env bash
# Deploy the bot to a fresh hogbox and run it under systemd.
#
# Prereqs on your machine: curl, jq, ssh, rsync, and a filled-in .env at the
# repo root. Auth is the same as the hogland CLI:
#   HOG_HOST   e.g. https://hogland.<tailnet>.ts.net   (required)
#   HOG_TOKEN  your hogland bearer token               (required off-tailnet)
#   PUBKEY_FILE  ssh pubkey to install (default ~/.ssh/id_ed25519.pub)
#
# Usage:  HOG_HOST=... HOG_TOKEN=... ./deploy/hogland/deploy.sh
set -euo pipefail

HOST="${HOG_HOST:?set HOG_HOST to your hogland host}"
AUTH=()
if [ -n "${HOG_TOKEN:-}" ]; then AUTH=(-H "Authorization: Bearer ${HOG_TOKEN}"); fi
PUBKEY_FILE="${PUBKEY_FILE:-$HOME/.ssh/id_ed25519.pub}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ ! -f "$REPO_ROOT/.env" ]; then
  echo "ERROR: $REPO_ROOT/.env not found. Copy .env.example to .env and fill it in." >&2
  exit 1
fi

PUB="$(cat "$PUBKEY_FILE")"

echo "==> Creating hogbox (2 cpu / 1 GiB / 10 GiB)…"
RESP="$(curl -sS -X POST "${AUTH[@]}" -H "Content-Type: application/json" \
  -d "$(jq -n --arg pub "$PUB" --rawfile bs "$SCRIPT_DIR/bootstrap.sh" \
    '{cpus:2,memory_mib:1024,disk_gib:10,disk_class:"mirrored",ssh_public_key:$pub,bootstrap:$bs}')" \
  "$HOST/v1/hogboxes")"

BOXID="$(echo "$RESP" | jq -r '.id')"
SSH_CMD="$(echo "$RESP" | jq -r '.ssh_command')"
if [ "$BOXID" = "null" ] || [ -z "$BOXID" ]; then
  echo "Box creation failed:" >&2; echo "$RESP" | jq . >&2; exit 1
fi
echo "    box=$BOXID"
echo "    ssh=$SSH_CMD"

# Derive an rsync/ssh transport from ssh_command, which looks like
#   ssh -A -p <port> hog@<ip>
# Adjust these two lines if your hogland prints a different shape.
SSH_OPTS="$(echo "$SSH_CMD" | sed -E 's/^ssh //; s/ +hog@[^ ]+ *$//')"
TARGET="$(echo "$SSH_CMD" | grep -oE 'hog@[^ ]+')"
SSH=(ssh $SSH_OPTS -o StrictHostKeyChecking=accept-new "$TARGET")

echo "==> Syncing code to $TARGET:~/discord-bot …"
# NB: .env IS included (it carries the secrets the bot needs).
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude .git --exclude data \
  -e "ssh $SSH_OPTS -o StrictHostKeyChecking=accept-new" \
  "$REPO_ROOT"/ "$TARGET:discord-bot/"

echo "==> Installing deps, building, registering commands, starting service…"
"${SSH[@]}" '
  set -eu
  cd ~/discord-bot
  npm ci
  npm run build
  npm run deploy-commands            # register slash commands globally (once)
  sudo cp deploy/hogland/discord-bot.service /etc/systemd/system/discord-bot.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now discord-bot
  sleep 2
  sudo systemctl --no-pager status discord-bot | head -n 12
'

echo "==> Snapshotting the box so you can restore it if it gets reaped…"
SNAP="$(curl -sS -X POST "${AUTH[@]}" "$HOST/v1/hogboxes/$BOXID/snapshots" | jq -r '.id')"
echo "    snapshot=$SNAP"

cat <<EOF

Done.
  box id:      $BOXID
  snapshot id: $SNAP

Tail logs:   $SSH_CMD -- 'journalctl -u discord-bot -f'
Restart:     $SSH_CMD -- 'sudo systemctl restart discord-bot'
If the box gets reaped, restore with:
  curl -X POST ${HOG_TOKEN:+-H "Authorization: Bearer \$HOG_TOKEN"} -H 'Content-Type: application/json' \\
    -d '{"snapshot_id":"$SNAP","cpus":2,"memory_mib":1024,"disk_gib":10,"disk_class":"mirrored","ssh_public_key":"<your pubkey>"}' \\
    $HOST/v1/hogboxes
EOF
