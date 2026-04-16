# SnapFlow V3 — Azure Student Deployment QUICKSTART

**Deployment time: ~30 minutes (images build in parallel)**

---

## TL;DR — Execute This Now

```bash
# 1. Pre-flight setup (manual + code changes)
bash azure-preflight.sh

# 2. Source environment
source azure-env.sh

# 3. Deploy everything (fully automated)
bash azure-deploy.sh

# 4. Verify deployment
bash azure-smoke-test.sh
```

---

## Prerequisites (5 min)

### 1. **Upstash Redis (FREE)**
- Go to https://upstash.com (sign up with GitHub)
- Create Database → Select **EU-West-1** region
- Copy the `REDIS_URL` (format: `redis://default:PASSWORD@HOST:PORT`)
- You'll need this in `azure-preflight.sh`

### 2. **Azure for Students (confirm active)**
```bash
az login
az account show
# If not "Azure for Students", run:
az account set --subscription "Azure for Students"
```

### 3. **Install Docker Desktop**
- https://www.docker.com/products/docker-desktop
- Verify: `docker ps`

### 4. **Install Azure CLI**
```bash
# Linux/WSL
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

# macOS
brew install azure-cli
```

---

## Three Code Changes (Prepare V3 Services)

**Before** running `azure-deploy.sh`, apply these 3 changes to your services:

### Change 1: `v3-scanner-go/main.go`
Add Chrome `--no-sandbox` support (required on Azure Container Apps):

```go
// In your Rod launcher initialization:
if os.Getenv("CHROME_NO_SANDBOX") == "true" {
    launcher = launcher.
        Set("no-sandbox", "").
        Set("disable-dev-shm-usage", "").
        Set("disable-gpu", "")
}
```

### Change 2: `v3-visual-regression/main.py`
Enable visual regression + `--no-sandbox` flag:

```python
import os

VISUAL_REGRESSION_ENABLED = os.getenv("VISUAL_REGRESSION_ENABLED", "false").lower() == "true"

def get_browser_args():
    args = []
    if os.getenv("CHROME_NO_SANDBOX") == "true":
        args.extend(["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"])
    return args

# In your job handler:
if not VISUAL_REGRESSION_ENABLED:
    return {"status": "not_available", "reason": "Visual regression disabled"}

# When launching Playwright:
browser = await p.chromium.launch(args=get_browser_args())
```

### Change 3: `v3-aggregator/main.py`
Add self-heartbeat to prevent F1 tier sleep:

```python
import asyncio, httpx, os

async def heartbeat():
    """Ping /health every 10 min (Azure App Service only)."""
    if not os.getenv("WEBSITE_SITE_NAME"):
        return
    await asyncio.sleep(60)
    url = f"https://{os.getenv('WEBSITE_SITE_NAME')}.azurewebsites.net/health"
    async with httpx.AsyncClient() as client:
        while True:
            try:
                await client.get(url, timeout=10)
            except Exception:
                pass
            await asyncio.sleep(600)

@app.on_event("startup")
async def startup():
    asyncio.create_task(heartbeat())
```

---

## Execution Flow

### Step 1: Pre-Flight Setup
```bash
cd V3-Microservices
bash azure-preflight.sh
```

**What it does:**
- ✅ Verifies prerequisites (Docker, Azure CLI)
- ✅ Asks for Upstash Redis URL
- ✅ Creates `azure-env.sh` with your config
- ✅ Guides you through code changes

**Output:**
```
✓ Pre-flight check complete
Next: Run the deployment:
  source ./azure-env.sh
  bash ./azure-deploy.sh
```

### Step 2: Source Environment Variables
```bash
source azure-env.sh
```

### Step 3: Deploy Everything
```bash
bash azure-deploy.sh
```

**What it does (fully automated):**

| Step | Time | What |
|------|------|------|
| 1 | 2 min | Azure login + subscription check |
| 2 | 1 min | Create resource group |
| 3 | 3 min | Create Container Registry |
| 4 | 20 min | Build & push 4 Docker images **(parallel)** |
| 5 | 10 min | Create PostgreSQL 16 server |
| 6 | 5 min | Deploy aggregator on App Service F1 |
| 7 | 3 min | Create Container Apps environment |
| 8-11 | 5 min | Deploy v3-scanner, nlp-worker, visual-regression with KEDA |

**Total: ~30 minutes**

**Output at end:**
```
════════════════════════════════════════════════════════════════
✓ DEPLOYMENT COMPLETE
════════════════════════════════════════════════════════════════

Aggregator URL: https://snapflow-aggregator.azurewebsites.net

Health Check:
  curl https://snapflow-aggregator.azurewebsites.net/health

Saved Credentials:
  Database: postgresql://snapflow:***@snapflow-db.postgres.database.azure.com:5432/snapflow
  DB Password: [YOUR_PASSWORD]
```

### Step 4: Verify Deployment
```bash
bash azure-smoke-test.sh
```

**What it checks:**
- ✅ Aggregator health endpoint
- ✅ Database connectivity
- ✅ Redis connectivity
- ✅ Container Apps running
- ✅ Container Registry images
- ✅ Cost summary
- ✅ Manual verification checklist

---

## After Deployment: Critical Setup

### 1. Set Up External Heartbeat (2 min)
App Service F1 sleeps after 20 minutes. Prevent this:

**Option A: cron-job.org (free)**
1. Visit https://cron-job.org
2. Sign up, create job:
   - **URL:** `https://snapflow-aggregator.azurewebsites.net/health`
   - **Method:** GET
   - **Interval:** Every 10 minutes
   - **Notification:** On failure

**Option B: GitHub Actions (free)**
```yaml
name: Keep Aggregator Alive
on:
  schedule:
    - cron: '*/10 * * * *'
jobs:
  heartbeat:
    runs-on: ubuntu-latest
    steps:
      - run: curl https://snapflow-aggregator.azurewebsites.net/health
```

### 2. Set Budget Alert (1 min)
Prevent surprise charges:

```
portal.azure.com → Cost Management → Budgets
Amount: $30/month
Alert threshold: 80% ($24)
```

You get emailed when approaching limit.

### 3. Test End-to-End (5 min)

**Trigger a scan:**
```bash
# Using Upstash console CLI or redis-cli:
LPUSH snapflow:queue:scans '{"scan_id":"test-001","domain":"https://example.com"}'
```

**Watch scanner spin up:**
```bash
az containerapp logs show --name v3-scanner --resource-group snapflow-rg --follow
```

**Confirm scaling to 0:**
```bash
az containerapp show --name v3-scanner --resource-group snapflow-rg \
  --query properties.template.scale.minReplicas
# Expected: 0 (not charging when idle)
```

---

## Monitoring & Cost Control

### Real-Time Cost Tracking
```bash
# Current month spend
az consumption usage list --query "[].{Service:instanceName, Cost:pretaxCost}" --output table

# Or: portal.azure.com → Cost Analysis
```

### Services & Expected Costs

| Service | Cost/Month | Why |
|---------|-----------|-----|
| App Service F1 | $0 | Free tier (50 MB daily) |
| PostgreSQL B1ms | ~$13 | Always-on database |
| Container Apps (idle) | ~$0 | KEDA scales to 0 |
| Container Apps (10 scans/day) | ~$8-15 | Workers active ~1-2 hours/day |
| Container Registry Basic | ~$5 | Image storage (10 GB limit) |
| Redis (Upstash) | $0 | Free tier (10k requests/day) |
| **Total** | **~$20-30/mo** | Lasts ~4 months on $100 credit |

---

## Troubleshooting

### Aggregator won't start
```bash
# Check logs
az webapp log tail --name snapflow-aggregator --resource-group snapflow-rg --follow

# Verify DB connection
DATABASE_URL="postgresql://snapflow:PASSWORD@snapflow-db.postgres.database.azure.com:5432/snapflow?sslmode=require"
psql "$DATABASE_URL" -c "SELECT 1"
```

### Scanner job not picked up
```bash
# Check Redis connection
redis-cli -u "$REDIS_URL" llen snapflow:queue:scans

# Check Container App is scaled up
az containerapp show --name v3-scanner --resource-group snapflow-rg \
  --query properties.template.scale
```

### High credit burn
```bash
# Check if Container Apps are stuck at min=1
az containerapp show --name v3-scanner --resource-group snapflow-rg \
  --query properties.template.scale.minReplicas
# Should be 0, not 1

# Fix: Update min replicas
az containerapp update --name v3-scanner --resource-group snapflow-rg --min-replicas 0
```

---

## Environment Variables Used

| Variable | Value | Notes |
|----------|-------|-------|
| `REDIS_URL` | `redis://default:...` | From Upstash |
| `DATABASE_URL` | `postgresql://...` | Auto-generated, saved in logs |
| `CHROME_NO_SANDBOX` | `true` | Required on Container Apps |
| `VISUAL_REGRESSION_ENABLED` | `true` | Enabled on Azure (unlike Render) |
| `ENVIRONMENT` | `azure-student` | For logging/monitoring |
| `WEBSITE_SITE_NAME` | Auto-injected | Used by heartbeat on App Service |

---

## Next Steps

### Immediate (Today)
- [x] Deploy with scripts
- [x] Set up heartbeat
- [x] Set budget alert
- [x] Test one scan

### Short-term (This week)
- [ ] Integrate with frontend (API calls to `https://snapflow-aggregator.azurewebsites.net`)
- [ ] Configure domain name (or whitelist `azurewebsites.net`)
- [ ] Set up logging/monitoring in Azure Portal

### Transition to Production (Before credit runs out)
- [ ] Move to K8s deployment (`snapflow-v3-k8s-complete.md`)
- [ ] Remove `--no-sandbox` (enable full browser isolation)
- [ ] Scale to multi-region
- [ ] Set up CDN, caching, SSL

---

## Emergency Stop (if credit running low)

```bash
# Stop all workloads but keep database
az containerapp delete --name v3-scanner --resource-group snapflow-rg --yes
az containerapp delete --name v3-nlp-worker --resource-group snapflow-rg --yes
az containerapp delete --name v3-visual-regression --resource-group snapflow-rg --yes

# Stop aggregator
az webapp stop --name snapflow-aggregator --resource-group snapflow-rg

# Database is kept (can restart later)
```

---

## Support / Reference

- **Azure for Students docs:** https://learn.microsoft.com/en-us/azure/education-hub/
- **Container Apps KEDA:** https://learn.microsoft.com/en-us/azure/container-apps/scale-rules-redis
- **PostgreSQL Flexible Server:** https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/overview
- **Upstash Redis:** https://upstash.com/docs
- **Rod (Go browser automation):** https://go-rod.github.io
- **Playwright (Python):** https://playwright.dev/python

---

**Ready? Run:**
```bash
bash azure-preflight.sh
source azure-env.sh
bash azure-deploy.sh
bash azure-smoke-test.sh
```

**Questions?** Check logs with `az ... log tail` or review cost alerts in portal.
