#!/usr/bin/env bash
# Run as the normal Docker-enabled VPS user; sudo is used for Apache/Certbot.
set -euo pipefail
umask 077
release_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
for file in apache-vps.py reload-apache.sh; do
  [[ -f "$release_dir/$file" ]] || { printf 'STOP: missing release file %s\n' "$file" >&2; exit 1; }
done
wetty_signature() {
  docker inspect wetty_wetty_1 --format \
    '{{.Id}} {{.Image}} {{.State.Running}} {{.State.StartedAt}} {{json .Mounts}} {{json .NetworkSettings.Networks}}' |
    sha256sum | cut -d ' ' -f 1
}
[[ $(docker inspect wetty_wetty_1 --format '{{.State.Running}}') == true ]]
wetty_before=$(wetty_signature)
sudo python3 "$release_dir/apache-vps.py" acme
sudo python3 "$release_dir/apache-vps.py" probe
sudo certbot renew --cert-name snapflow.medianet.space --dry-run
sudo certbot renew --cert-name snapflow.medianet.space
sudo apache2ctl -t
sudo systemctl reload apache2
sudo openssl x509 -in /etc/letsencrypt/live/snapflow.medianet.space/fullchain.pem -noout -dates -ext subjectAltName
sudo openssl x509 -in /etc/letsencrypt/live/snapflow.medianet.space/fullchain.pem -noout -checkend 0
for domain in snapflow.medianet.space snapflow-api.medianet.space; do
  curl --noproxy '*' --resolve "$domain:443:127.0.0.1" \
    --connect-timeout 5 --max-time 20 -sS -o /dev/null \
    -w "$domain TLS verified; HTTP=%{http_code}\n" "https://$domain/"
done
hook=/etc/letsencrypt/renewal-hooks/deploy/50-snapflow-apache-reload
if sudo test -e "$hook"; then
  sudo cmp -s "$release_dir/reload-apache.sh" "$hook" || {
    printf 'STOP: existing renewal hook differs; preserve it for review.\n' >&2
    exit 1
  }
else
  sudo install -m 755 "$release_dir/reload-apache.sh" "$hook"
fi
# Test the hook explicitly; compatible with the deployed Certbot 2.1.0.
sudo env RENEWED_LINEAGE=/etc/letsencrypt/live/snapflow.medianet.space "$hook"
sudo certbot renew --cert-name snapflow.medianet.space --dry-run
systemctl is-active certbot.timer
[[ $(wetty_signature) == "$wetty_before" ]] || {
  printf 'STOP: protected terminal runtime changed; inspect before continuing.\n' >&2
  exit 1
}
printf 'Certificate phase passed; Wetty runtime unchanged.\n'
