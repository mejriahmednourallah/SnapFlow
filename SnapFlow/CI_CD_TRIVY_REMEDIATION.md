# SnapFlow CI/CD Trivy Remediation

This note documents the safe workflow for fixing Trivy findings without changing
SnapFlow behavior.

## Workflows

The active GitHub Actions workflows live one level above this project folder:

- `../.github/workflows/ci.yml`
- `../.github/workflows/security.yml`
- `../.github/workflows/containers.yml`
- `../.github/workflows/manifests.yml`
- `../.github/workflows/nightly-deep.yml`

Trivy is pinned to `aquasec/trivy:0.72.0` in the security, container, manifest,
and nightly workflows. The dedicated Trivy workflows emit readable table logs,
JSON artifacts, SARIF artifacts, and GitHub step summaries.

## GitHub CLI Triage

Use GitHub CLI from the repository root:

```bash
gh run list --workflow "SnapFlow Security"
gh run list --workflow "SnapFlow Containers"
gh run list --workflow "SnapFlow Manifests"
```

Inspect failed logs:

```bash
gh run view <run-id> --log-failed
```

Download Trivy artifacts when the log is too large:

```bash
gh run download <run-id>
```

Re-run after fixes:

```bash
gh workflow run "SnapFlow Security"
gh workflow run "SnapFlow Containers" -f image=all
gh workflow run "SnapFlow Manifests"
```

## Safe Fix Policy

Allowed without product review:

- Docker base image patch/minor bumps.
- npm patch/minor updates that preserve the current package choices.
- Python requirements patch/minor updates.
- Go module patch/minor updates followed by `go mod tidy`.
- `.trivyignore` entries only for verified false positives or accepted risks.

Not allowed as a Trivy-only fix:

- API, schema, UI, or business-logic changes.
- Replacing libraries or frameworks.
- Major dependency upgrades unless separately reviewed.
- Deployment behavior changes.

Each `.trivyignore` entry should include the CVE, affected path or image, reason,
and a review date.
