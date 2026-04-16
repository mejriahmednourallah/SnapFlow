#!/usr/bin/env bash
set -euo pipefail

echo "=== Updating system ==="
sudo apt-get update -qq
sudo apt-get upgrade -y -qq

echo "=== Installing packages ==="
sudo apt-get install -y -qq \
  curl wget git jq htop \
  net-tools iputils-ping netcat-openbsd \
  apt-transport-https ca-certificates gnupg

echo "=== Disabling swap ==="
sudo swapoff -a
sudo sed -i '/ swap / s/^/#/' /etc/fstab

echo "=== Kernel parameters ==="
cat <<'EOF' | sudo tee /etc/sysctl.d/99-kubernetes.conf >/dev/null
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward = 1
fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 512
EOF
sudo sysctl --system >/dev/null

echo "=== Bootstrap complete ==="
free -h
sysctl net.ipv4.ip_forward
