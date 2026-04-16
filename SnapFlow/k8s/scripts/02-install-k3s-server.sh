#!/usr/bin/env bash
set -euo pipefail

NODE_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '/src/ {for(i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')"
if [[ -z "${NODE_IP}" ]]; then
  NODE_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
if [[ -z "${NODE_IP}" ]]; then
  echo "ERROR: failed to determine local node IP"
  exit 1
fi

PUBLIC_IP="$(curl -4 -s https://api.ipify.org || true)"

echo "Node IP: ${NODE_IP}"
if [[ -n "${PUBLIC_IP}" ]]; then
  echo "Public IP (TLS SAN): ${PUBLIC_IP}"
fi

EXTRA_TLS_SAN_ARGS=()
if [[ -n "${PUBLIC_IP}" ]]; then
  EXTRA_TLS_SAN_ARGS+=("--tls-san" "${PUBLIC_IP}")
fi

curl -sfL https://get.k3s.io | sudo INSTALL_K3S_VERSION="v1.32.13+k3s1" sh -s - server \
  --disable traefik \
  --node-ip "${NODE_IP}" \
  --tls-san "${NODE_IP}" \
  "${EXTRA_TLS_SAN_ARGS[@]}" \
  --write-kubeconfig-mode 644

echo "=== Waiting for k3s ==="
sleep 20
sudo k3s kubectl get nodes
sudo k3s kubectl get sc

echo "Copy kubeconfig if needed:"
echo "scp root@${NODE_IP}:/etc/rancher/k3s/k3s.yaml ~/.kube/config"
