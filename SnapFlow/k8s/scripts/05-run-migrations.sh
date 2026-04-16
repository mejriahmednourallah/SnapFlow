#!/usr/bin/env bash
set -euo pipefail

KUBECTL="${KUBECTL:-kubectl}"
DB_PASS="${DB_PASS:-REPLACE_WITH_STRONG_PASSWORD}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INIT_SQL="${ROOT_DIR}/../V3-Microservices/db/init.sql"

if [[ ! -f "${INIT_SQL}" ]]; then
  echo "ERROR: init SQL not found at ${INIT_SQL}"
  exit 1
fi

echo "=== Creating/refreshing SQL ConfigMap from ${INIT_SQL} ==="
${KUBECTL} -n snapflow-infra create configmap v3-init-sql \
  --from-file=init.sql="${INIT_SQL}" \
  --dry-run=client -o yaml | ${KUBECTL} apply -f -

echo "=== Running DB init job against pgbouncer ==="
${KUBECTL} -n snapflow-infra delete job v3-db-init --ignore-not-found

cat <<EOF | ${KUBECTL} apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: v3-db-init
  namespace: snapflow-infra
spec:
  backoffLimit: 1
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: psql
        image: postgres:16-alpine
        env:
        - name: PGPASSWORD
          value: "${DB_PASS}"
        command: ["/bin/sh", "-c"]
        args:
        - |
          psql \
            -h pgbouncer.snapflow-infra.svc.cluster.local \
            -p 5432 \
            -U snapflow \
            -d snapflow \
            -v ON_ERROR_STOP=1 \
            -f /sql/init.sql
        volumeMounts:
        - name: init-sql
          mountPath: /sql
      volumes:
      - name: init-sql
        configMap:
          name: v3-init-sql
EOF

${KUBECTL} wait --for=condition=complete job/v3-db-init -n snapflow-infra --timeout=180s || \
${KUBECTL} logs -n snapflow-infra job/v3-db-init

echo "=== DB init completed ==="
