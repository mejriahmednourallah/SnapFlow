#!/usr/bin/env bash
set -euo pipefail

KUBECTL="${KUBECTL:-kubectl}"

echo "=== Adding Helm repos ==="
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx >/dev/null
helm repo add jetstack https://charts.jetstack.io >/dev/null
helm repo add kedacore https://kedacore.github.io/charts >/dev/null
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null
helm repo update >/dev/null

echo "=== [1/4] nginx-ingress 4.11.3 ==="
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --version 4.11.3 \
  --set controller.service.type=LoadBalancer \
  --wait --timeout=180s

echo "=== [2/4] cert-manager 1.19.4 ==="
helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --version 1.19.4 \
  --set installCRDs=true \
  --wait --timeout=180s

echo "=== [3/4] KEDA 2.18.2 ==="
helm upgrade --install keda kedacore/keda \
  --namespace keda --create-namespace \
  --version 2.18.2 \
  --wait --timeout=180s

echo "=== [4/4] kube-prometheus-stack 68.3.0 ==="
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace \
  --version 68.3.0 \
  --set prometheus.prometheusSpec.retention=15d \
  --set prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.storageClassName=local-path \
  --set prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.resources.requests.storage=20Gi \
  --set grafana.persistence.enabled=true \
  --set grafana.persistence.storageClassName=local-path \
  --set grafana.persistence.size=5Gi \
  --wait --timeout=420s

${KUBECTL} get pods -n ingress-nginx
${KUBECTL} get pods -n cert-manager
${KUBECTL} get pods -n keda
${KUBECTL} get pods -n monitoring
