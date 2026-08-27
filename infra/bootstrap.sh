#!/usr/bin/env bash
#
# Prepare a fresh Oracle Ubuntu host to run the particle-wave service.
# Uploaded and executed by configure.py. Safe to re-run.

set -euo pipefail

log() { printf '\n=== %s\n' "$1"; }

# ── Firewall ────────────────────────────────────────────────────────
#
# Oracle's Ubuntu images ship an iptables INPUT chain that REJECTs everything
# except SSH, *in addition to* the cloud security list. Opening the ports in
# the OCI console alone is the classic Oracle trap: the security list permits
# the traffic and the host then rejects it, so the port looks open from the
# API and dead from a browser.
log "opening ports 80 and 443 on the host firewall"
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
    echo "  opened $port"
  else
    echo "  $port already open"
  fi
done

# Persist across reboots, installing the helper if the image lacks it.
if ! command -v netfilter-persistent >/dev/null 2>&1; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent >/dev/null
fi
sudo netfilter-persistent save >/dev/null 2>&1 || true

# ufw is usually inactive on these images, but if someone enabled it the rules
# above would be bypassed by its own chain.
if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q "Status: active"; then
  sudo ufw allow 80/tcp >/dev/null
  sudo ufw allow 443/tcp >/dev/null
  echo "  ufw rules added"
fi

# ── Docker ──────────────────────────────────────────────────────────
log "installing Docker"
if command -v docker >/dev/null 2>&1; then
  echo "  already installed: $(docker --version)"
else
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sudo sh /tmp/get-docker.sh >/dev/null
  rm -f /tmp/get-docker.sh
  echo "  installed: $(docker --version)"
fi

sudo usermod -aG docker "$USER" || true
sudo systemctl enable --now docker >/dev/null 2>&1 || true

# ── Swap ────────────────────────────────────────────────────────────
#
# The ARM instance has plenty of RAM, but the micro fallback has 1 GB and a
# docker build of scipy/opencv will be OOM-killed without swap. Cheap
# insurance, and doubled to 4G when the host dropped from 24 GB to 12:
# the build peak did not change, the headroom above it halved.
# insurance either way, and it costs nothing when unused.
if ! sudo swapon --show | grep -q '/swapfile'; then
  log "adding 4G swap"
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

log "host ready"
docker --version
free -h | head -2
