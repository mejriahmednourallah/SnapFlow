# VPS Apache repair and replacement

Updated 2026-10-06. Run server commands in the existing Wetty terminal.
The user explicitly deferred SMTP. Password login for imported users remains
the target; delivery/confirmation/reset-email acceptance is pending. No automatic
email confirmation is enabled to conceal the missing SMTP service.

## Repeatable VPS launcher

`V3-Microservices/run-all.sh --vps` now delegates to `deploy/production/vps.py`
before any legacy preprod environment or Compose path is selected. `--local`
and the existing preprod path keep their existing behavior. The VPS path rejects
legacy options such as `--down`, `--local` and `--obscura` rather than guessing.
It uses an isolated Python environment under the private runtime, requiring
`python3-venv` on Debian. It installs PyYAML/cryptography there if missing; it
does not run sudo, reset a database, prune volumes or change Apache.

From the SnapFlow checkout in Wetty:

```bash
# One-time prerequisite if venv is not installed:
sudo apt-get install -y python3-venv

# First command: configuration + sequential image builds/downloads only.
bash V3-Microservices/run-all.sh --vps --action build --skip-smtp

# After build succeeds: start production Supabase and wait for bootstrap.
bash V3-Microservices/run-all.sh --vps --action supabase

# First import: paste the export key into the hidden prompt (never into chat).
bash V3-Microservices/run-all.sh --vps --action import

# After verified restore: prepare schemas, migrate evidence, start SnapFlow.
bash V3-Microservices/run-all.sh --vps --action start
bash V3-Microservices/run-all.sh --vps --action status
```

Build is the default action. SMTP deferral requires `--skip-smtp` for build.
The default private directory is `$HOME/.local/share/snapflow-vps`; override with
`--runtime /absolute/private/path`. The default origin is
`https://snapflow.medianet.space`; override build with `--public-origin`.
Never run the old local Supabase CLI reset/seed script on this destination.

The first VPS build rebuilds all four separated Python bases because an old
`latest` tag alone does not prove compatible inputs. Subsequent builds reuse
bases only when the private build-input manifest and current image IDs match.
`--rebuild-base` forces rebuilding; `--no-cache` bypasses service build cache
and also applies to a base rebuild when one is required. Service builds are
sequential. Supabase and the audit PostgreSQL images are downloaded as part of
build. Obscura remains disabled until its separate acceptance.

Long command output streams to Wetty and a private per-phase log. Build cache
and unused dangling images are cleaned before and after build, including after
failure. Tagged candidates/rollback images, every container and every data
volume are retained by that cleanup. A failed command prevents later phases.
Keep Wetty open while running this foreground command.

The production bridge is created with `snapflow.deployment=snapflow-production`;
an existing bridge without that label is refused. Wetty identity, uptime,
restart count, mounts and networks are compared before/after phases. Mount
order is normalized without omitting any values. This does not establish the
cause of the earlier legacy cleanup fingerprint failure or bypass its guard.

Import refuses replay of an existing verified marker, requires empty destination
Auth and stopped SnapFlow workers, accepts the key only through a hidden terminal
prompt/stdin, reuses destination signing keys and installs exported integrations.
It then runs the existing validated restore/preparation actions. Startup requires
a valid restore marker and refuses active audits before service recreation. It
prepares Supabase and runs the evidence migration transaction before workers.
Apache activation and real public application/scan tests remain separate.

Validation: thirteen orchestration tests pass, including build failure/cache
cleanup, production routing, guarded import/start order, active-audit refusal,
key transport and Wetty state comparison. Linux Bash dispatch, legacy help and
the existing three legacy launcher-flow cases also pass using an existing
isolated base image. Disposable containers are removed and build cache is 0 B.
These tests mock Docker
operations; they are not a completed VPS build/import or capacity acceptance.

Live progress (Oct 6): the user supplied the VPS launcher's build-complete
message and final image-pull/cleanup output. Cleanup reports 1.445 GB cache and
124.5 MB dangling images reclaimed. No final error is shown. Next run the
`supabase` phase and collect health, free-space/memory and Wetty status before
the first import. The supplied excerpt does not yet establish any of those
runtime checks or application/scan acceptance.

## Failed first bootstrap: Linux file permissions

The Oct 6 VPS diagnostics confirmed all seven mounted SQL inputs were 0600,
owned by UID/GID 1002. The pinned PostgreSQL image initializes as UID 100;
it cannot read those files. The database logged missing `_supabase` and an
`authenticator` role with no password, consistent with incomplete bootstrap.
At that time disk had 24 GB free and host available memory was 5.3 GiB; these
are idle/partial-start observations, not scan-load capacity results.

The configurator now grants container input directories 0755, SQL/code/config
files 0644 and shell entrypoints 0755. The enclosing private runtime remains
0700; runtime credentials and decrypted imports remain private. Only the
intended input trees are changed; database data is excluded and symlinks are
refused. Missing required bootstrap files are rejected instead of being
silently created as directories. An initially empty Studio snippets directory
is still created when required by the pinned configuration.

Existing PostgreSQL data has already been initialized, so changing permissions
and restarting alone will not replay first-init SQL. For this failed first
deployment, use the guarded repair after pulling the fix:

```bash
bash V3-Microservices/run-all.sh --vps --action repair-bootstrap
```

It requires no import marker, zero Auth users (or no users table), zero public
application tables, the expected Compose container/volume ownership, and only
the verified DB container consuming that volume. All checks finish before
mutation. It corrects the inputs, stops only the generated Supabase stack,
removes only its verified DB container and
`snapflow-production-supabase_supabase-data`, then bootstraps/waits again.
Destination credentials, db-config/storage volumes, SnapFlow's separate audit
DB, Wetty and Apache are retained. It refuses populated/imported destinations;
it is not an ordinary redeployment command. No image rebuild is needed.

Validation: five profile checks pass in Linux, including restrictive-umask
input access and private-file preservation; fifteen launcher checks pass,
including repair scope and refusal for populated/shared/foreign resources.
`probe_bootstrap_linux.py` also passed a real, offline PostgreSQL 17.6.1.136
cold bootstrap with UID-1002 input fixtures, confirming `_supabase` exists and
`authenticator` has a password. Its owned test containers/volumes were removed.
The repaired VPS bootstrap and full Supabase health still need live proof.

## Release validation

- VPS and rehearsal profiles: three checks pass, including credential reuse,
  rejection of a profile switch in an existing runtime, HTTPS origin validation
  and both generated Compose configurations.
- Real Apache container checks pass for both HTTP/HTTPS vhost directives in
  both phases: owned challenge bytes, missing-file 404, Digest 401 and successful
  authenticated terminal proxy. Stack mode also checks six Supabase routes,
  an actual WebSocket 101 handshake, forwarded HTTPS scheme, seed-function 403
  and HTTP redirects that exempt the terminal/challenge paths.
- Five scoped Apache checks pass in Linux, including rollback of both vhost
  files on a simulated syntax failure, alias precedence and restrictive umask.
  Four cleanup scope/abort checks pass.
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

Oct 6 live attempt: both vhosts applied with Syntax OK and protected files
unchanged. Frontend challenge checks passed; API challenge returned 403, so
renewal and cleanup did not run. The follow-up moves the specific challenge
Alias before the API's broad Alias and makes only the two public challenge
directories traversable under restrictive umask. Existing root-owned challenge
directories created with 0700 are corrected; application parent modes and
private runtime files are unchanged. Symlinked challenge directories abort.
These two defects are reproduced/covered locally; the exact VPS 403 cause and
successful renewal remain subject to the repeated server probe. See
[Alias precedence](https://httpd.apache.org/docs/2.4/mod/mod_alias.html#alias).

The repeated VPS run on release `b58d606` passed: the API directory's root-owned
0700 permissions were confirmed; both challenge probes, staging dry-runs and
real shared-certificate renewal succeeded. Expiry is January 4, 2027, with both
SANs retained. Strict loopback and independent public Windows curl checks passed
for both names; the reload hook passed, the timer was active and Wetty's runtime
was unchanged. Certificate repair is complete. Proceed to scoped cleanup below;
the new-stack build/import/startup and application tests are still pending.

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

The October 6 cleanup stopped all thirteen approved legacy containers, then
aborted at the Wetty runtime fingerprint check before removal. No reclaimed
space or checkout pull has been established. The subsequent user diagnostics
show Wetty running since July 8 with zero restarts, no OOM and its expected
network; the differing fingerprint field remains unidentified. Do not bypass
the cleanup guard. Check free disk space before building the separate projects.

The verified Cloud export is now carried in Git as an encrypted bundle under
`deploy/production/exports/20261005-cloud`. Follow that directory's README to
transfer only its decryption key privately and stage the import through Wetty.
Neither raw SQL nor keys belong in this checkout.

Use a separate private runtime, for example `$HOME/.local/share/snapflow-vps`.
The Python environment needs PyYAML and cryptography. Fetch the pinned upstream
configuration, decrypt the verified export into the private runtime, then configure:

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
