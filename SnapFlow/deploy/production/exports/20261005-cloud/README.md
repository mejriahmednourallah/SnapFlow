# One-time Cloud import

This directory contains only the authenticated, encrypted migration bundle and
a public checksum manifest. It includes the database, Auth users/password hashes
and exported functions/integration settings. Storage file migration is excluded.
Do not add plaintext SQL, the decryption key or destination credentials to Git.

The key remains in the original export directory, protected by Windows DPAPI
for the exporting user's account. On that Windows PC, from the SnapFlow checkout:

```powershell
.\deploy\production\copy-export-key.ps1 -ExportDirectory "$env:LOCALAPPDATA\SnapFlow\cloud-exports\20261005-082109-wagctsvpmnleqzqjhqjq"
```

In Wetty, after pulling the release and installing Python dependencies, run this
as a directly pasted command block (not inside a piped shell or heredoc):

```bash
(
  set -euo pipefail
  set +x
  umask 077
  cd "$HOME/snapflowv2.medianet.tn/SnapFlow/SnapFlow"
  read -r -s -p 'Paste export key (hidden), then Enter: ' export_key
  printf '\n'
  printf '%s' "$export_key" | python3 deploy/production/rehearse.py decrypt \
    --runtime "$HOME/.local/share/snapflow-vps" \
    --export deploy/production/exports/20261005-cloud
  unset export_key
)
```

The value is read without echo and passed through stdin, not command arguments
or shell history. Clear the Windows clipboard after pasting:
`Set-Clipboard -Value ""`. Keep clipboard-history/sync disabled for this transfer.
The helper does not print or save the key.

Decryption verifies SHA-256 before authentication and extraction. It only stages
the private import; it does not restore or start services. Use the VPS runbook
for pinned Supabase startup, `restore`, `prepare`, SnapFlow startup and Apache
activation, in that order. Imported users retain their password hashes;
destination Supabase signing/API keys are generated separately by `configure`.
