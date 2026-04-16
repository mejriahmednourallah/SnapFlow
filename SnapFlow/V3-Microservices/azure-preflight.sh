#!/bin/bash

################################################################################
# SnapFlow V3 - Code Changes & Pre-Flight Setup
# Run BEFORE executing azure-deploy.sh
################################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_step() { echo -e "${BLUE}[$(date +'%H:%M:%S')]${NC} ${GREEN}➜${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

question() {
    local prompt="$1"
    local default="$2"
    read -p "$(echo -e ${BLUE}$prompt${NC} [${YELLOW}$default${NC}]: )" response
    echo "${response:-$default}"
}

main() {
    log_step "=== SnapFlow V3 Azure Student - Pre-Flight Setup ==="
    echo ""
    
    # ========================================================================
    # MANUAL STEP 1: Upstash Redis Setup
    # ========================================================================
    log_step "MANUAL STEP 1: Set up Upstash Redis (FREE tier)"
    echo "  1. Visit: https://upstash.com"
    echo "  2. Sign up with GitHub/Google (free)"
    echo "  3. Create Database → Region: EU-West-1 → Type: Regional"
    echo "  4. After creation, go to 'Details' tab"
    echo "  5. Copy the CONNECTION URL line (starts with rediss://)"
    echo ""
    
    REDIS_URL=$(question "Paste your Upstash REDIS_URL" "rediss://default:none@none:6379")
    
    if [[ ! "$REDIS_URL" =~ redis(s)?://default:.+@.+:[0-9]+ ]]; then
        log_error "Invalid Redis URL format. Should be: redis(s)://default:PASSWORD@HOST:PORT"
        log_error "Got: $REDIS_URL"
        exit 1
    fi
    
    log_success "Upstash Redis configured"
    echo ""
    
    # ========================================================================
    # MANUAL STEP 2: Verify Azure CLI & Docker
    # ========================================================================
    log_step "MANUAL STEP 2: Verify prerequisites"
    
    if ! command -v az &> /dev/null; then
        log_error "Azure CLI not installed:"
        echo "  Linux: curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash"
        echo "  macOS: brew install azure-cli"
        exit 1
    fi
    log_success "Azure CLI installed"
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker not installed. Download Docker Desktop:"
        echo "  https://www.docker.com/products/docker-desktop"
        exit 1
    fi
    log_success "Docker installed"
    
    if ! docker ps &> /dev/null; then
        log_error "Docker daemon not running. Start Docker Desktop."
        exit 1
    fi
    log_success "Docker daemon running"
    echo ""
    
    # ========================================================================
    # CODE CHANGE 1: v3-scanner-go --no-sandbox flag
    # ========================================================================
    log_step "CODE CHANGE 1: v3-scanner-go --no-sandbox flag"
    
    SCANNER_FILE="V3-Microservices/v3-scanner-go/main.go"
    if [ -f "$SCANNER_FILE" ]; then
        if grep -q "CHROME_NO_SANDBOX" "$SCANNER_FILE"; then
            log_warn "Already patched: $SCANNER_FILE"
        else
            log_step "Patching $SCANNER_FILE..."
            # This is a simplified instruction - user should manually add:
            # if os.Getenv("CHROME_NO_SANDBOX") == "true" {
            #     launcher = launcher.Set("no-sandbox", "")
            # }
            cat << 'EOF'

Please manually add to v3-scanner-go/main.go (or launcher.go):

    if os.Getenv("CHROME_NO_SANDBOX") == "true" {
        launcher = launcher.Set("no-sandbox", "").
            Set("disable-dev-shm-usage", "").
            Set("disable-gpu", "")
    }

Ensure this is added to the rod.launcher configuration.
EOF
            read -p "Press Enter when done editing v3-scanner-go..."
        fi
    else
        log_warn "Scanner file not found at $SCANNER_FILE. Update manually."
    fi
    echo ""
    
    # ========================================================================
    # CODE CHANGE 2: v3-visual-regression --no-sandbox + enable flag
    # ========================================================================
    log_step "CODE CHANGE 2: v3-visual-regression --no-sandbox + ENABLED flag"
    
    VR_FILE="V3-Microservices/v3-visual-regression/main.py"
    if [ -f "$VR_FILE" ]; then
        if grep -q "VISUAL_REGRESSION_ENABLED" "$VR_FILE"; then
            log_warn "Already patched: $VR_FILE"
        else
            log_step "Patching $VR_FILE..."
            cat << 'EOF'

Please manually add to v3-visual-regression/main.py (top of file):

    import os
    
    VISUAL_REGRESSION_ENABLED = os.getenv("VISUAL_REGRESSION_ENABLED", "false").lower() == "true"
    
    def get_browser_args():
        args = []
        if os.getenv("CHROME_NO_SANDBOX") == "true":
            args.extend(["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"])
        return args

Then in your Playwright launch code, use:
    browser = await p.chromium.launch(args=get_browser_args())

And wrap main job logic with:
    if not VISUAL_REGRESSION_ENABLED:
        return {"status": "not_available", ...}
EOF
            read -p "Press Enter when done editing v3-visual-regression..."
        fi
    else
        log_warn "Visual regression file not found at $VR_FILE. Update manually."
    fi
    echo ""
    
    # ========================================================================
    # CODE CHANGE 3: v3-aggregator self-heartbeat
    # ========================================================================
    log_step "CODE CHANGE 3: v3-aggregator self-heartbeat (prevents F1 sleep)"
    
    AGG_FILE="V3-Microservices/v3-aggregator/main.py"
    if [ -f "$AGG_FILE" ]; then
        if grep -q "heartbeat" "$AGG_FILE"; then
            log_warn "Already patched: $AGG_FILE"
        else
            log_step "Patching $AGG_FILE..."
            cat << 'EOF'

Please manually add to v3-aggregator/main.py:

    import asyncio
    import httpx
    import os
    
    async def heartbeat():
        """Pings /health every 10 min. Only runs on Azure App Service."""
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
EOF
            read -p "Press Enter when done editing v3-aggregator..."
        fi
    else
        log_warn "Aggregator file not found at $AGG_FILE. Update manually."
    fi
    echo ""
    
    # ========================================================================
    # ENVIRONMENT VARIABLES
    # ========================================================================
    log_step "Collecting environment variables for deployment"
    
    RG_NAME=$(question "Resource Group name" "snapflow-rg")
    REGISTRY_NAME=$(question "Container Registry name (lowercase, no hyphens)" "snapflowregistry")
    DB_ADMIN=$(question "PostgreSQL admin username" "snapflow")
    DB_PASSWORD=$(question "PostgreSQL admin password (save this!)" "$(openssl rand -base64 16)")
    LOCATION=$(question "Azure region (try eastus or westus2 for student subscriptions)" "eastus")
    
    echo ""
    log_success "Configuration complete"
    echo ""
    
    # ========================================================================
    # EXPORT FOR DEPLOYMENT SCRIPT
    # ========================================================================
    log_step "Creating deployment configuration file"
    
    cat > azure-env.sh << ENVEOF
#!/bin/bash
# Generated deployment environment
# Source this before running azure-deploy.sh

export REDIS_URL="$REDIS_URL"
export RG_NAME="$RG_NAME"
export REGISTRY_NAME="$REGISTRY_NAME"
export DB_ADMIN="$DB_ADMIN"
export DB_PASSWORD="$DB_PASSWORD"
export LOCATION="$LOCATION"

# Extract Upstash host/port from REDIS_URL
UPSTASH_CREDS="\$(echo "$REDIS_URL" | sed -n 's/.*default:\([^@]*\)@\([^:]*\):\([0-9]*\).*/\1:\2:\3/p')"
export UPSTASH_PASSWORD="\$(echo \$UPSTASH_CREDS | cut -d: -f1)"
export UPSTASH_HOST="\$(echo \$UPSTASH_CREDS | cut -d: -f2)"
export UPSTASH_PORT="\$(echo \$UPSTASH_CREDS | cut -d: -f3)"

echo "✓ Environment loaded. Ready to deploy!"
ENVEOF
    
    chmod +x azure-env.sh
    log_success "Created: azure-env.sh"
    echo ""
    
    # ========================================================================
    # DEPLOYMENT READINESS
    # ========================================================================
    echo -e "${BLUE}════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✓ PRE-FLIGHT CHECK COMPLETE${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "NEXT: Run the deployment:"
    echo ""
    echo "  source ./azure-env.sh"
    echo "  bash ./azure-deploy.sh"
    echo ""
    echo "This will deploy your full stack in ~30 minutes."
    echo ""
}

main "$@"
