# Apache and VPS connection review

Reviewed 2026-10-06 against the user's latest redacted Apache/container output
(`67b7f1c1-cb4f-415f-bd8b-bb8a374cf679`). This records configuration evidence,
with the live certificate repair results added below.

Implementation update: the VPS profile and two-phase scoped Apache repair are
now implemented and tested locally. See the commands and exact validation scope
in [VPS_RUNBOOK.md](../../../deploy/production/VPS_RUNBOOK.md). SMTP is explicitly
deferred at the user's request. The first live VPS result is recorded below.

Live repair update (Oct 6): the user ran release `265598c`. Both vhosts passed
syntax/reload with protected files unchanged; the frontend hostname passed exact
challenge-byte and missing-file checks. The API hostname returned HTTP 403.
Renewal stopped before running, and cleanup remains pending. The follow-up fixes
specific-before-broad Alias ordering and public challenge-directory permissions
under umask 077, with new regression coverage.

Successful repeat (Oct 6, release `b58d606`): `namei` confirmed the API challenge
directory was root-owned **0700**, while its parents were traversable. Both
hostnames then passed exact challenge bytes and missing-file 404, Certbot's
initial staging dry-run, real renewal and a second dry-run. The renewed shared
certificate expires **2027-01-04 14:26:43 UTC**, preserving both SANs. Strict
loopback HTTPS returned HTTP 200 for each hostname. The renewal reload hook
passed its explicit test, `certbot.timer` was active, and Wetty's runtime was
unchanged. Independent live curl checks from the local Windows machine also
returned HTTP 200 with **TLS_VERIFY=0** for both public hostnames, without
disabling certificate verification. No new-stack application acceptance or VPS
cleanup is implied by these HTTPS checks.

## Confirmed state

- Apache **2.4.68**, configuration **Syntax OK**; proxy, HTTP proxy, WebSocket,
  SSL, rewrite, alias, headers and setenvif modules are loaded.
- Host Apache owns ports **80, 443 and 18080**. The local rehearsal's Apache
  container on port 18080 cannot be copied directly onto this VPS.
- The previously expired shared certificate is renewed through **2027-01-04**.
  It covers both `snapflow.medianet.space` and `snapflow-api.medianet.space`.
- The old nine SnapFlow and four ticketing containers still run. No self-hosted
  Supabase is present in this snapshot; scoped VPS cleanup is still pending.
- Aggregator port 8080 is bound to IPv4/IPv6 wildcard addresses. External
  reachability through the firewall has not been tested.
- Ticketing owns loopback port 18081. Proposed loopback ports 13000 and 18000
  are not occupied in the supplied listening-port output.
- Wetty runs on loopback port 3030. Its global `990-wetty.conf` contains both
  proxy directives and **Digest authentication**, using `wetty.htdigest`.
  Preserve effective routing and authentication, as well as the container,
  mounts and networks. Neither the terminal path nor credentials belong in Git.
- The API hostname hosts an existing Django WSGI application. It is not the
  new aggregator endpoint. Preserve that application when repairing shared TLS.

## Routing defects and implications

The SnapFlow HTTP/HTTPS vhosts and the older `snapflowv2` HTTP vhost put the
`/api/` proxy inside a Location block before a root Location proxy. Apache uses
the last matching Location block for this directive, so the root block can
override `/api/`. This is a configuration defect; an actual failing API response
was not captured in this snapshot. Ordinary vhost-level ProxyPass rules have
different ordering: their first match wins. Mixing these forms is not an
ordering fix. See [Apache ProxyPass ordering](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html#proxypass).

The SnapFlow vhost has no local ACME challenge route, consistent with the
previous public test returning SPA HTML for a missing challenge. Add local
challenge handling using the existing Certbot webroots and an exclusion that
works with Location proxies (`SetEnvIf` and `no-proxy`). Test exact owned probe
bytes and a missing-file 404 on both certificate hostnames before renewal.

No Supabase routes exist in these vhosts. Leaving the frontend catch-all in
charge would send Auth, REST, Edge Functions and Realtime requests to the SPA.
Keep their native URL paths on the agreed public HTTPS origin.

## Destination connection contract

| Traffic | Destination |
|---|---|
| Browser: `/` and SPA routes | Host Apache to `127.0.0.1:13000`, frontend container port 3000 |
| Browser: `/auth/v1/`, `/rest/v1/`, `/functions/v1/`, `/storage/v1/`, `/graphql/v1/` | Host Apache to `127.0.0.1:18000`, Supabase gateway port 8000 |
| Browser: `/realtime/v1/` | Same gateway, with WebSocket upgrade |
| ACME challenge on both certificate hostnames | Existing local Certbot webroots; no SPA proxy |
| Protected terminal route | Existing Wetty proxy and Digest authentication |
| Supabase audit Edge Function | Private shared Docker network to `http://aggregator:8080/scan` |
| Form Executor | Private Supabase gateway and Supabase database connections |
| Scanner, NLP and aggregator evidence | Separate private SnapFlow audit database |

The code already constructs the Edge Function target from
`SCANNER_BASE_URL` (or `AUDIT_API_URL`) plus `/scan`. Set both private bases to
`http://aggregator:8080`, without an added `/api` prefix. This connection does
not require publishing aggregator port 8080 to the Internet.

Build the frontend with `VITE_SUPABASE_URL=https://snapflow.medianet.space` and
the destination public API key. Server credentials stay private. Set
`SUPABASE_PUBLIC_URL` and `SITE_URL` to this origin, `API_EXTERNAL_URL` to
`https://snapflow.medianet.space/auth/v1`, and the intended destination redirect
allowlist. Apache's TLS vhost must forward the HTTPS scheme. See
[Supabase URL configuration](https://supabase.com/docs/guides/self-hosting/docker#configure-supabase-urls).

## Execution sequence and outstanding proof

1. Prepare and locally validate the scoped Apache patch, including a protected
   terminal route with Digest authentication. Existing generic local HTTP
   rehearsal results do not prove preservation of the VPS Wetty configuration.
2. Repair the two challenge routes, syntax-check, gracefully reload, verify
   public probe bytes/404, then dry-run and renew the shared certificate. Verify
   both SANs and Wetty access. Do not restart Apache or Docker.
3. Run the already prepared scoped cleanup from Wetty and pull the pushed Git
   release after it succeeds. Preserve source/env files and protected resources.
4. Generate an explicit VPS deployment profile: public HTTPS origin, real SMTP,
   host Apache instead of the rehearsal Apache container, private gateway and
   frontend ports, and no public aggregator mapping. `rehearse.py configure`
   now supports `--profile vps --public-origin ... --skip-smtp`; it removes local
   HTTP/Mailpit/Apache and published aggregator settings for that profile.
5. Serial build, first restore, destination preparation and startup. Then test
   login, Auth links, RLS, Realtime, Edge-to-aggregator audits, Form Executor and
   persisted report reloads through public HTTPS.
6. Measure 150/300/500-page capacity with both databases and Wetty running.
   Existing browser/model/default promotion gates remain unchanged.

The ACME routing patch, both challenge checks and certificate renewal have
passed on the VPS. Scoped cleanup and new-stack deployment remain pending.
The old public `/api/` mapping is not proof of a working new Supabase-to-
microservices connection.
