#!/usr/bin/env bash
set -euo pipefail
# Shared SnapFlow/frontend + legacy API certificate only.
[[ ${RENEWED_LINEAGE:-} == /etc/letsencrypt/live/snapflow.medianet.space ]] || exit 0
apache2ctl -t
systemctl reload apache2
