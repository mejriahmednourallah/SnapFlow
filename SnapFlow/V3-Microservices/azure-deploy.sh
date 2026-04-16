#!/bin/bash

################################################################################
# SnapFlow V3 - Azure Student Deployment - FULLY AUTOMATED
# Execution time: ~30 min (images build in parallel)
# Prerequisites: az login, docker running, .env file configured (see below)
################################################################################

set -e  # Exit on first error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================================
# CONFIG (Edit these or use environment variables)
# ============================================================================

RG_NAME="${RG_NAME:-snapflow-rg}"
LOCATION="${LOCATION:-eastus}"
REGISTRY_NAME="${REGISTRY_NAME:-snapflowregistry}"
APP_SERVICE_NAME="${APP_SERVICE_NAME:-snapflow-aggregator}"
PLAN_NAME="${PLAN_NAME:-snapflow-plan}"
DB_SERVER="${DB_SERVER:-snapflow-db}"
DB_ADMIN="${DB_ADMIN:-snapflow}"
DB_NAME="${DB_NAME:-snapflow}"
CONTAINER_ENV="${CONTAINER_ENV:-snapflow-env}"
DB_PASSWORD="${DB_PASSWORD:-}"  # SET THIS or will be generated
REDIS_URL="${REDIS_URL:-}"      # SET THIS from Upstash
CANDIDATE_LOCATIONS="${CANDIDATE_LOCATIONS:-}"  # Optional comma/space separated list
UPSTASH_HOST="${UPSTASH_HOST:-}"
UPSTASH_PORT="${UPSTASH_PORT:-6379}"
UPSTASH_PASSWORD="${UPSTASH_PASSWORD:-}"

# Derived
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGISTRY_URL="${REGISTRY_NAME}.azurecr.io"

# ============================================================================
# HELPERS
# ============================================================================

log_step() {
    echo -e "${BLUE}[$(date +'%H:%M:%S')]${NC} ${GREEN}➜${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

get_policy_allowed_locations() {
    local sub_id
    sub_id=$(az account show --query id -o tsv 2>/dev/null || true)
    if [ -z "$sub_id" ]; then
        return 0
    fi

    {
        az policy assignment list \
            --scope "/subscriptions/$sub_id" \
            --query "[].parameters.listOfAllowedLocations.value[]" \
            -o tsv 2>/dev/null
        az policy assignment list \
            --scope "/subscriptions/$sub_id" \
            --query "[].parameters.allowedLocations.value[]" \
            -o tsv 2>/dev/null
        az policy assignment list \
            --scope "/subscriptions/$sub_id" \
            --query "[].properties.parameters.listOfAllowedLocations.value[]" \
            -o tsv 2>/dev/null
        az policy assignment list \
            --scope "/subscriptions/$sub_id" \
            --query "[].properties.parameters.allowedLocations.value[]" \
            -o tsv 2>/dev/null
    } | tr '[:upper:]' '[:lower:]' | sed '/^$/d' | sort -u
}

build_location_candidates() {
    local -A seen=()
    local -a candidates=()
    local loc

    add_location() {
        local candidate
        candidate=$(echo "$1" | tr '[:upper:]' '[:lower:]' | xargs)
        if [ -z "$candidate" ]; then
            return
        fi
        if [ -z "${seen[$candidate]}" ]; then
            seen[$candidate]=1
            candidates+=("$candidate")
        fi
    }

    add_location "$LOCATION"

    for loc in ${CANDIDATE_LOCATIONS//,/ }; do
        add_location "$loc"
    done

    while IFS= read -r loc; do
        add_location "$loc"
    done < <(get_policy_allowed_locations)

    for loc in eastus eastus2 centralus westus westus2 southcentralus; do
        add_location "$loc"
    done

    printf "%s\n" "${candidates[@]}"
}

check_prereq() {
    log_step "Checking prerequisites..."
    
    if ! command -v az &> /dev/null; then
        log_error "Azure CLI not found. Install: https://learn.microsoft.com/cli/azure/install-azure-cli"
        exit 1
    fi
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker not found. Install Docker Desktop."
        exit 1
    fi
    
    if ! docker ps &> /dev/null; then
        log_error "Docker daemon not running. Start Docker Desktop."
        exit 1
    fi
    
    if [ -z "$REDIS_URL" ]; then
        log_error "REDIS_URL not set. Get it from Upstash and run:"
        log_error "  export REDIS_URL='rediss://default:XXX@XXX.upstash.io:6379'"
        exit 1
    fi
    
    if [ -z "$DB_PASSWORD" ]; then
        log_warn "DB_PASSWORD not set. Generating random one..."
        DB_PASSWORD=$(openssl rand -base64 16 | tr -d "/@" | head -c 20)
        log_step "Generated DB_PASSWORD: $DB_PASSWORD (save this!)"
    fi
    
    # Check if we have UPSTASH credentials for KEDA
    if [ -z "$UPSTASH_HOST" ]; then
        log_warn "UPSTASH_HOST not extracted from REDIS_URL"
        # Try to extract from REDIS_URL (format: redis(s)://default:PASSWORD@HOST:PORT)
        if [[ $REDIS_URL =~ redis(s)?://default:[^@]*@([^:]+):([0-9]+) ]]; then
            UPSTASH_HOST="${BASH_REMATCH[1]}"
            UPSTASH_PORT="${BASH_REMATCH[2]}"
            UPSTASH_PASSWORD=$(echo $REDIS_URL | sed -n 's/.*default:\([^@]*\)@.*/\1/p')
            log_success "Extracted from REDIS_URL: HOST=$UPSTASH_HOST PORT=$UPSTASH_PORT"
        else
            log_error "Could not parse REDIS_URL. Format: redis(s)://default:PASSWORD@HOST:PORT"
            exit 1
        fi
    fi

    # Ensure required Azure resource providers are registered
    local required_namespaces=(
        "Microsoft.ContainerRegistry"
        "Microsoft.App"
        "Microsoft.DBforPostgreSQL"
        "Microsoft.Web"
        "Microsoft.OperationalInsights"
    )
    local ns
    local state
    for ns in "${required_namespaces[@]}"; do
        state=$(az provider show --namespace "$ns" --query registrationState -o tsv 2>/dev/null || echo "NotRegistered")
        if [ "$state" != "Registered" ]; then
            log_warn "Provider '$ns' is '$state'. Registering..."
            az provider register --namespace "$ns" --wait >/dev/null
            state=$(az provider show --namespace "$ns" --query registrationState -o tsv 2>/dev/null || echo "Unknown")
            if [ "$state" != "Registered" ]; then
                log_error "Failed to register provider '$ns' (state: $state)"
                exit 1
            fi
            log_success "Provider '$ns' registered"
        fi
    done
    
    log_success "Prerequisites OK"
}

# ============================================================================
# STEP 1 - Azure Login & Subscription
# ============================================================================

step_azure_login() {
    log_step "STEP 1: Azure Login & Subscription Setup"
    
    # Check if already logged in
    if ! az account show &> /dev/null; then
        log_step "Opening browser for Azure login..."
        az login
    fi
    
    CURRENT_SUB=$(az account show --query name -o tsv)
    log_step "Current subscription: $CURRENT_SUB"
    
    if [[ "$CURRENT_SUB" != *"Students"* && "$CURRENT_SUB" != *"Free"* ]]; then
        log_warn "You may not be on the student subscription. Confirm before continuing."
        read -p "Continue? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
    
    log_success "Azure login OK"
}

# ============================================================================
# STEP 2 - Resource Group
# ============================================================================

step_rg() {
    log_step "STEP 2: Creating Resource Group"
    
    if az group exists --name "$RG_NAME" | grep -q true; then
        log_warn "Resource group '$RG_NAME' already exists. Skipping."
    else
        az group create \
            --name "$RG_NAME" \
            --location "$LOCATION" \
            --query properties.provisioningState -o tsv
        log_success "Resource group created"
    fi
}

# ============================================================================
# STEP 3 - Container Registry
# ============================================================================

step_acr() {
    log_step "STEP 3: Creating Container Registry"
    
    if az acr show --name "$REGISTRY_NAME" --resource-group "$RG_NAME" &> /dev/null; then
        log_warn "Registry '$REGISTRY_NAME' already exists. Skipping creation."
    else
        local created=0
        local acr_output
        local candidate
        local -a candidates=()

        mapfile -t candidates < <(build_location_candidates)

        for candidate in "${candidates[@]}"; do
            log_step "Trying ACR create in location '$candidate'..."
            set +e
            acr_output=$(az acr create \
                --name "$REGISTRY_NAME" \
                --resource-group "$RG_NAME" \
                --sku Basic \
                --admin-enabled true \
                --location "$candidate" \
                --query provisioningState -o tsv 2>&1)
            local rc=$?
            set -e

            if [ $rc -eq 0 ]; then
                LOCATION="$candidate"
                export LOCATION
                created=1
                log_success "Container registry created in '$LOCATION'"
                break
            fi

            if echo "$acr_output" | grep -qi "already exists"; then
                log_error "Registry name '$REGISTRY_NAME' is globally unavailable. Choose another REGISTRY_NAME and retry."
                exit 1
            fi

            if echo "$acr_output" | grep -Eqi "RequestDisallowedByAzure|PolicyViolation|disallowed"; then
                log_warn "Policy denied ACR creation in '$candidate'"
                continue
            fi

            if echo "$acr_output" | grep -Eqi "LocationNotAvailableForResourceType|not available"; then
                log_warn "ACR not available in '$candidate'"
                continue
            fi

            log_warn "ACR create failed in '$candidate': $acr_output"
        done

        if [ $created -ne 1 ]; then
            log_error "Could not create ACR in any candidate location."
            log_error "Set CANDIDATE_LOCATIONS (comma-separated) and retry, e.g.:"
            log_error "  export CANDIDATE_LOCATIONS='eastus,westus2,southcentralus'"
            log_error "Then run: ./azure-deploy.sh"
            exit 1
        fi
    fi
    
    # Get credentials
    ACR_USERNAME=$(az acr credential show --name "$REGISTRY_NAME" --query username -o tsv)
    ACR_PASSWORD=$(az acr credential show --name "$REGISTRY_NAME" --query "passwords[0].value" -o tsv)
    export ACR_USERNAME ACR_PASSWORD
    
    # Login to Docker
    log_step "Logging in to Docker registry..."
    az acr login --name "$REGISTRY_NAME"
    log_success "Docker login successful"
}

# ============================================================================
# STEP 4 - Build & Push Docker Images (PARALLEL)
# ============================================================================

step_build_images() {
    log_step "STEP 4: Building and pushing Docker images (parallel)"
    
    cd "$BASE_DIR"
    
    # Define services to build
    declare -A SERVICES=(
        ["v3-scanner-go"]="v3-scanner-go"
        ["v3-aggregator"]="v3-aggregator"
        ["v3-nlp-worker"]="v3-nlp-worker"
        ["v3-visual-regression"]="v3-visual-regression"
    )
    
    # Function to build one image
    build_image() {
        local service=$1
        local dir=$2
        log_step "[BUILD] $service"
        
        if [ ! -d "$dir" ]; then
            log_error "Directory not found: $dir"
            return 1
        fi
        
        (
            cd "$dir"
            docker build -t "$REGISTRY_URL/$service:latest" . \
                && docker push "$REGISTRY_URL/$service:latest" \
                && log_success "[PUSH] $service"
        ) || (log_error "[FAILED] $service" && return 1)
    }
    
    # Start all builds in background
    local pids=()
    for service in "${!SERVICES[@]}"; do
        build_image "$service" "${SERVICES[$service]}" &
        pids+=($!)
    done
    
    # Wait for all builds to complete
    local failed=0
    for pid in "${pids[@]}"; do
        if ! wait $pid; then
            ((failed++))
        fi
    done
    
    if [ $failed -gt 0 ]; then
        log_error "$failed image(s) failed to build"
        exit 1
    fi
    
    log_success "All images built and pushed"
}

# ============================================================================
# STEP 5 - PostgreSQL
# ============================================================================

step_postgres() {
    log_step "STEP 5: Creating PostgreSQL Flexible Server"
    
    if az postgres flexible-server show --name "$DB_SERVER" --resource-group "$RG_NAME" &> /dev/null; then
        log_warn "PostgreSQL server '$DB_SERVER' already exists. Skipping."
        DB_DOMAIN=$(az postgres flexible-server show \
            --name "$DB_SERVER" \
            --resource-group "$RG_NAME" \
            --query fullyQualifiedDomainName -o tsv)
    else
        log_step "Creating PostgreSQL server (this takes 5-10 minutes)..."
        az postgres flexible-server create \
            --name "$DB_SERVER" \
            --resource-group "$RG_NAME" \
            --location "$LOCATION" \
            --admin-user "$DB_ADMIN" \
            --admin-password "$DB_PASSWORD" \
            --sku-name Standard_B1ms \
            --tier Burstable \
            --storage-size 32 \
            --version 16 \
            --public-access 0.0.0.0 \
            --query fullyQualifiedDomainName -o tsv > /dev/null
        
        DB_DOMAIN=$(az postgres flexible-server show \
            --name "$DB_SERVER" \
            --resource-group "$RG_NAME" \
            --query fullyQualifiedDomainName -o tsv)
        
        log_success "PostgreSQL created: $DB_DOMAIN"
    fi
    
    # Create database
    log_step "Creating database '$DB_NAME'..."
    az postgres flexible-server db create \
        --resource-group "$RG_NAME" \
        --server-name "$DB_SERVER" \
        --database-name "$DB_NAME" \
        --query name -o tsv > /dev/null || log_warn "Database may already exist"
    
    log_success "PostgreSQL setup complete"
    export DB_DOMAIN
}

# ============================================================================
# STEP 6 - App Service for Aggregator
# ============================================================================

step_app_service() {
    log_step "STEP 6: Deploying Aggregator on App Service (F1 Free)"
    
    # Create App Service plan if needed
    if ! az appservice plan show --name "$PLAN_NAME" --resource-group "$RG_NAME" &> /dev/null; then
        log_step "Creating App Service plan..."
        az appservice plan create \
            --name "$PLAN_NAME" \
            --resource-group "$RG_NAME" \
            --sku F1 \
            --is-linux \
            --location "$LOCATION" \
            --query name -o tsv > /dev/null
        log_success "App Service plan created"
    else
        log_warn "App Service plan already exists"
    fi
    
    # Create or update web app
    if az webapp show --name "$APP_SERVICE_NAME" --resource-group "$RG_NAME" &> /dev/null; then
        log_warn "Web app already exists. Updating deployment..."
    else
        log_step "Creating web app..."
        az webapp create \
            --name "$APP_SERVICE_NAME" \
            --resource-group "$RG_NAME" \
            --plan "$PLAN_NAME" \
            --deployment-container-image-name "$REGISTRY_URL/v3-aggregator:latest" \
            --query defaultHostName -o tsv > /dev/null
        log_success "Web app created"
    fi
    
    # Configure container
    log_step "Configuring container registry..."
    az webapp config container set \
        --name "$APP_SERVICE_NAME" \
        --resource-group "$RG_NAME" \
        --docker-custom-image-name "$REGISTRY_URL/v3-aggregator:latest" \
        --docker-registry-server-url "https://$REGISTRY_URL" \
        --docker-registry-server-user "$ACR_USERNAME" \
        --docker-registry-server-password "$ACR_PASSWORD" \
        > /dev/null
    
    # Set environment variables
    log_step "Setting environment variables..."
    DATABASE_URL="postgresql://$DB_ADMIN:$DB_PASSWORD@$DB_DOMAIN:5432/$DB_NAME?sslmode=require"
    
    az webapp config appsettings set \
        --name "$APP_SERVICE_NAME" \
        --resource-group "$RG_NAME" \
        --settings \
            "DATABASE_URL=$DATABASE_URL" \
            "REDIS_URL=$REDIS_URL" \
            "ENVIRONMENT=azure-student" \
            "WEBSITES_PORT=8000" \
            > /dev/null
    
    # Get public URL
    APP_URL=$(az webapp show \
        --name "$APP_SERVICE_NAME" \
        --resource-group "$RG_NAME" \
        --query defaultHostName -o tsv)
    
    export APP_URL
    log_success "App Service deployed: https://$APP_URL"
    
    # Wait for it to be up
    log_step "Waiting for aggregator to be ready (up to 60s)..."
    for i in {1..30}; do
        if curl -s "https://$APP_URL/health" &> /dev/null; then
            log_success "Aggregator is UP"
            break
        fi
        echo -n "."
        sleep 2
    done
}

# ============================================================================
# STEP 7 - Container Apps Environment
# ============================================================================

step_container_app_env() {
    log_step "STEP 7: Creating Container Apps Environment"
    
    if az containerapp env show --name "$CONTAINER_ENV" --resource-group "$RG_NAME" &> /dev/null; then
        log_warn "Container App environment already exists"
    else
        log_step "Creating environment (this takes 2-3 minutes)..."
        az containerapp env create \
            --name "$CONTAINER_ENV" \
            --resource-group "$RG_NAME" \
            --location "$LOCATION" \
            --query properties.provisioningState -o tsv > /dev/null
        log_success "Container App environment created"
    fi
}

# ============================================================================
# STEP 8/9/10/11 - Deploy Container Apps (v3-scanner, nlp-worker, visual-regression)
# ============================================================================

deploy_container_app() {
    local app_name=$1
    local image=$2
    local cpu=$3
    local memory=$4
    local max_replicas=$5
    local queue_name=$6
    local queue_length=$7
    
    log_step "Deploying $app_name..."
    
    DATABASE_URL="postgresql://$DB_ADMIN:$DB_PASSWORD@$DB_DOMAIN:5432/$DB_NAME?sslmode=require"
    
    # Check if already exists
    if az containerapp show --name "$app_name" --resource-group "$RG_NAME" &> /dev/null; then
        log_warn "$app_name already exists. Updating..."
        # Update image
        az containerapp update \
            --name "$app_name" \
            --resource-group "$RG_NAME" \
            --image "$REGISTRY_URL/$image:latest" \
            > /dev/null
    else
        # Create new
        az containerapp create \
            --name "$app_name" \
            --resource-group "$RG_NAME" \
            --environment "$CONTAINER_ENV" \
            --image "$REGISTRY_URL/$image:latest" \
            --registry-server "$REGISTRY_URL" \
            --registry-username "$ACR_USERNAME" \
            --registry-password "$ACR_PASSWORD" \
            --cpu "$cpu" \
            --memory "$memory" \
            --min-replicas 0 \
            --max-replicas "$max_replicas" \
            --secrets \
                "db-url=$DATABASE_URL" \
                "redis-url=$REDIS_URL" \
                "upstash-password=$UPSTASH_PASSWORD" \
            --env-vars \
                "DATABASE_URL=secretref:db-url" \
                "REDIS_URL=secretref:redis-url" \
                "CHROME_NO_SANDBOX=true" \
                "ENVIRONMENT=azure-student" \
            > /dev/null
    fi
    
    # Configure KEDA Redis scaler
    log_step "Configuring KEDA scaler for $app_name..."
    az containerapp update \
        --name "$app_name" \
        --resource-group "$RG_NAME" \
        --scale-rule-name redis-scaler \
        --scale-rule-type redis \
        --scale-rule-metadata \
            "listName=$queue_name" \
            "listLength=$queue_length" \
            "address=$UPSTASH_HOST:$UPSTASH_PORT" \
        --scale-rule-auth "connection=upstash-password" \
        > /dev/null
    
    log_success "$app_name deployed"
}

step_container_apps() {
    log_step "STEPS 8-11: Deploying all Container Apps"
    
    # v3-scanner-go
    deploy_container_app \
        "v3-scanner" \
        "v3-scanner-go" \
        "2.0" \
        "4Gi" \
        "5" \
        "snapflow:queue:scans" \
        "3"
    
    # v3-nlp-worker
    deploy_container_app \
        "v3-nlp-worker" \
        "v3-nlp-worker" \
        "1.0" \
        "2Gi" \
        "4" \
        "snapflow:queue:nlp" \
        "2"
    
    # v3-visual-regression
    # Add VISUAL_REGRESSION_ENABLED=true
    log_step "Deploying v3-visual-regression (with visual regression ENABLED)..."
    DATABASE_URL="postgresql://$DB_ADMIN:$DB_PASSWORD@$DB_DOMAIN:5432/$DB_NAME?sslmode=require"
    
    if ! az containerapp show --name "v3-visual-regression" --resource-group "$RG_NAME" &> /dev/null; then
        az containerapp create \
            --name "v3-visual-regression" \
            --resource-group "$RG_NAME" \
            --environment "$CONTAINER_ENV" \
            --image "$REGISTRY_URL/v3-visual-regression:latest" \
            --registry-server "$REGISTRY_URL" \
            --registry-username "$ACR_USERNAME" \
            --registry-password "$ACR_PASSWORD" \
            --cpu "2.0" \
            --memory "4Gi" \
            --min-replicas 0 \
            --max-replicas 3 \
            --secrets \
                "db-url=$DATABASE_URL" \
                "redis-url=$REDIS_URL" \
                "upstash-password=$UPSTASH_PASSWORD" \
            --env-vars \
                "DATABASE_URL=secretref:db-url" \
                "REDIS_URL=secretref:redis-url" \
                "VISUAL_REGRESSION_ENABLED=true" \
                "CHROME_NO_SANDBOX=true" \
                "ENVIRONMENT=azure-student" \
            > /dev/null
    fi
    
    # KEDA for visual-regression
    az containerapp update \
        --name "v3-visual-regression" \
        --resource-group "$RG_NAME" \
        --scale-rule-name redis-scaler \
        --scale-rule-type redis \
        --scale-rule-metadata \
            "listName=snapflow:queue:visual" \
            "listLength=1" \
            "address=$UPSTASH_HOST:$UPSTASH_PORT" \
        --scale-rule-auth "connection=upstash-password" \
        > /dev/null
    
    log_success "All Container Apps deployed"
}

# ============================================================================
# SUMMARY
# ============================================================================

summary() {
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✓ DEPLOYMENT COMPLETE${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "Aggregator URL: https://$APP_URL"
    echo ""
    echo "Health Check:"
    echo "  curl https://$APP_URL/health"
    echo ""
    echo "Next Steps:"
    echo "  1. Set up external heartbeat (cron-job.org)"
    echo "  2. Run smoke tests: bash azure-smoke-test.sh"
    echo "  3. Monitor costs: portal.azure.com → Cost Management"
    echo ""
    echo "Saved Credentials:"
    echo "  Database: postgresql://$DB_ADMIN:***@$DB_DOMAIN:5432/$DB_NAME?sslmode=require"
    echo "  DB Password: $DB_PASSWORD"
    echo ""
    echo -e "${YELLOW}Save these credentials somewhere safe!${NC}"
    echo ""
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

main() {
    log_step "=== SnapFlow V3 Azure Student Deployment ==="
    echo ""
    
    check_prereq
    step_azure_login
    step_rg
    step_acr
    step_build_images
    step_postgres
    step_app_service
    step_container_app_env
    step_container_apps
    
    summary
}

main "$@"
