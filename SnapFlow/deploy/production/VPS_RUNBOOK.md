# VPS Apache repair and replacement

Updated 2026-10-06. Run server commands in the existing Wetty terminal.
The user explicitly deferred SMTP. Password login for imported users remains
the target; delivery/confirmation/reset-email acceptance is pending. No automatic
email confirmation is enabled to conceal the missing SMTP service.

## Release validation

- VPS and rehearsal profiles: three checks pass, including credential reuse,
  rejection of a profile switch in an existing runtime, HTTPS origin validation
  and both generated Compose configurations.
- Real Apache container checks pass for both HTTP/HTTPS vhost directives in
  both phases: owned challenge bytes, missing-file 404, Digest 401 and successful
  authenticated terminal proxy. Stack mode also checks six Supabase routes,
  an actual WebSocket 101 handshake, forwarded HTTPS scheme, seed-function 403
  and HTTP redirects that exempt the terminal/challenge paths.
- Three scoped Apache checks pass in Linux, including rollback of both vhost
  files on a simulated syntax failure. Four cleanup scope/abort checks pass.
- Test containers/networks are removed. These tests do not establish real VPS
  TLS trust, certificate renewal, application acceptance or scan capacity.

The Apache repair only edits the two identified enabled vhosts (resolving their
symlinks within `/etc/apache2`). It keeps SSL and WSGI settings, backs up originals
privately, preserves permissions/owners, checks syntax, reloads gracefully and
rolls back failed activation. It fingerprints Wetty's authentication/config
files and container identity/runtime. The existing terminal route is discovered
on the server and never written into Git or printed by the repair script.

The supplied legacy root Location can override the global terminal proxy even
after Digest succeeds. ACME mode adds a specific terminal Location after it,
without replacing the inherited Digest authentication. It leaves application
proxies in place. Stack mode replaces the two known legacy application proxy
blocks with ordered vhost-level routes and explicitly includes the existing
protected terminal config before the frontend catch-all. Unknown proxy contents
abort preparation before writes. See [Apache ordering](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html#proxypass).

## 1. Fetch and repair challenges/certificate

This deliberately fetches scripts without pulling over the running checkout.
It does not stop containers. If any step fails, the shell stops before proceeding.
No terminal credentials are needed by the script.

The same sequence is packaged in `repair-certificate.sh`. Fetch and extract it,
`apache-vps.py` and `reload-apache.sh` together, then run the shell script as the
normal Docker-enabled VPS user. Keep its output in a private log. It stops on
failure and checks Wetty's runtime again after the complete certificate phase.

```bash
bash <<'SH'
set -euo pipefail
umask 077
cd "$HOME/snapflowv2.medianet.tn/SnapFlow/SnapFlow"
git fetch origin main
release_dir="$HOME/.local/share/snapflow-release"
mkdir -p "$release_dir"
git show origin/main:SnapFlow/deploy/production/apache-vps.py > "$release_dir/apache-vps.py"
git show origin/main:SnapFlow/deploy/production/reload-apache.sh > "$release_dir/reload-apache.sh"

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
sudo env RENEWED_LINEAGE=/etc/letsencrypt/live/snapflow.medianet.space "$hook"
sudo certbot renew --cert-name snapflow.medianet.space --dry-run
systemctl is-active certbot.timer
printf 'Certificate phase passed. Verify your Wetty session still works.\n'
SH
```

The local-and-public HTTP probe originates on the VPS. Certbot's successful
dry-run supplies the independent ACME validation; strict local HTTPS checks
then verify the serving Apache certificate for each hostname. Check public
HTTPS from another client as well. Never replace verification with `curl -k`.
The hook only reloads Apache when the shared SnapFlow certificate is renewed.
It is tested explicitly because the VPS uses the older Certbot 2.1.0; the
commands do not depend on newer dry-run hook/reconfigure options.

## 2. Scoped cleanup and checkout update

After certificate/Wetty checks pass, this removes the explicitly approved old
SnapFlow/ticketing services and three owned data volumes. SnapFlow is down until
the replacement finishes. Wetty, source/env files, host services, unknown
containers and other vhosts remain. No Docker daemon restart is performed.

```bash
bash <<'SH'
set -euo pipefail
umask 077
cd "$HOME/snapflowv2.medianet.tn/SnapFlow/SnapFlow"
test "$(git branch --show-current)" = main
git fetch origin main
git diff --quiet
git diff --cached --quiet
git merge-base --is-ancestor HEAD origin/main
git show origin/main:SnapFlow/deploy/production/clean-vps.sh > "$HOME/snapflow-clean-vps.sh"
bash "$HOME/snapflow-clean-vps.sh" 2>&1 | tee "$HOME/snapflow-cleanup-$(date +%Y%m%d-%H%M%S).log"
git pull --ff-only origin main
git log -1 --oneline
SH
```

If Git detects local tracked changes, preserve/review them; do not use reset or
discard environment settings to make the command pass. Cleanup's own resource
ownership checks finish before any container is stopped.

## 3. New private VPS configuration (after pull)

Use a separate private runtime, for example `$HOME/.local/share/snapflow-vps`.
The Python environment needs PyYAML and cryptography. Fetch the pinned upstream
configuration, transfer/decrypt the verified export privately, then configure:

```bash
python3 deploy/production/rehearse.py fetch --runtime "$HOME/.local/share/snapflow-vps"
python3 deploy/production/rehearse.py configure \
  --runtime "$HOME/.local/share/snapflow-vps" --profile vps \
  --public-origin https://snapflow.medianet.space --skip-smtp
```

The configurator sets private-directory/file permissions on Linux, generates
destination credentials once, and reuses them on repeat. Compose identities are
`snapflow-production-supabase` and `snapflow-production-snapflow`, sharing the
dedicated `snapflow-production-bridge`. Create/verify that owned network before
startup. Only frontend `127.0.0.1:13000` and gateway `127.0.0.1:18000` are published.
No rehearsal Apache/Mailpit service or published aggregator port is generated.
Keep the export decryption key outside shell history and Git; Windows DPAPI
key material is not directly usable on Linux.

Build sequentially with disk checks; start Supabase, restore once, run `prepare`
before SnapFlow workers, then start SnapFlow. Existing `compose`, `restore` and
`prepare` actions use the stored VPS project identities. Imported schedules stay
disabled until their destination jobs are configured. Both databases remain
separate. Restore/build/startup on the real VPS have not run yet.

Only after both loopback upstreams are healthy, activate the final routes:

```bash
sudo python3 deploy/production/apache-vps.py stack
sudo python3 deploy/production/apache-vps.py probe
```

Then validate public login/RLS/Realtime, Edge-to-aggregator audits, Form Executor
and report reloads. The loopback socket precheck is not an application health
test. No 500-page, model or engine promotion follows from routing tests alone.
