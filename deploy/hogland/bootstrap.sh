#!/bin/sh
# Runs as root on the hogbox BEFORE sshd comes up (passed as the `bootstrap`
# field to POST /v1/hogboxes). Capped at 32 KiB; a non-zero exit aborts the box.
# Installs everything the bot needs that isn't in the devbox baseline rootfs.
set -eu
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
# rsync: not in the baseline rootfs, needed to receive the code.
# python3: fallback for better-sqlite3 if no prebuilt binary is available
# (build-essential is already in the baseline).
apt-get install -y -qq rsync python3

# Node 20 (Ubuntu 22.04) via NodeSource.
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y -qq nodejs
