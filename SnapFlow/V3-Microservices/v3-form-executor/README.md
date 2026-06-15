# SnapFlow Form Executor

Phase 3 browser worker for approved Form Tester scenario versions.

## Responsibilities

- Atomically claim executions whose source is `pending_executor`.
- Load the approved immutable scenario snapshot.
- Run each execution in an isolated Playwright Chromium context.
- Persist progressive step results, logs, assertions, network summaries, and redacted artifacts.
- Stop on CAPTCHA or OTP without attempting to bypass the challenge.
- Keep business failures (`failed`) separate from executor failures (`error`).

## Local Tests

```powershell
cd V3-Microservices\v3-form-executor
python -m pip install -r requirements.txt
python -m playwright install chromium
python -m pytest tests -q
```

The tests use a local fixture server only. They do not require Supabase, Docker, or an external website.

## Local Worker

Apply the Supabase migrations first, then set the executor database URL:

```powershell
$env:FORM_EXECUTOR_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
$env:FORM_EXECUTOR_ARTIFACT_DIR = "$PWD\.artifacts"
python -m uvicorn main:app --host 0.0.0.0 --port 8085
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8085/health
```

Artifacts stay local unless both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured.

## Compose Profile

The service is opt-in and does not start with the audit stack by default:

```powershell
cd V3-Microservices
docker compose --profile form-tester up -d --build v3-form-executor
```

The compose default expects local Supabase on ports `54321` and `54322`. Override
`FORM_EXECUTOR_DATABASE_URL` when using a remote or differently configured database.
