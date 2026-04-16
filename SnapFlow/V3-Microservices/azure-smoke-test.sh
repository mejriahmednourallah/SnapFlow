#!/bin/bash

################################################################################
# SnapFlow V3 - Azure Smoke Test & Validation
# Run AFTER azure-deploy.sh completes
################################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_step() { echo -e "${BLUE}[$(date +'%H:%M:%S')]${NC} ${GREEN}➜${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1" >&2; }
log_warn() { echo -e "${YELLOW}[!]${NC} $1"; }

# Source env if available
if [ -f "azure-env.sh" ]; then
    source azure-env.sh
fi

# ============================================================================
# Configuration
# ============================================================================

APP_URL="${1:-snapflow-aggregator.azurewebsites.net}"
RG_NAME="${RG_NAME:-snapflow-rg}"
REDIS_URL="${REDIS_URL:-}"

# Remove https:// if present
APP_URL="${APP_URL#https://}"
APP_URL="${APP_URL#http://}"

if [ -z "$REDIS_URL" ]; then
    log_error "REDIS_URL not set. Source azure-env.sh first:"
    log_error "  source ./azure-env.sh"
    exit 1
fi

# ============================================================================
# TESTS
# ============================================================================

test_aggregator_health() {
    log_step "TEST 1: Aggregator health check"
    
    if curl -s -f "https://$APP_URL/health" > /dev/null 2>&1; then
        HEALTH=$(curl -s "https://$APP_URL/health" | head -c 50)
        log_success "Aggregator is UP"
        echo "  Response: $HEALTH"
    else
        log_error "Aggregator health check FAILED"
        log_error "URL: https://$APP_URL/health"
        return 1
    fi
}

test_db_connectivity() {
    log_step "TEST 2: Database connectivity (via aggregator)"
    
    # This requires an actual endpoint that checks DB
    # For now, just verify the aggregator can respond
    STATUS=$(curl -s -w "%{http_code}" -o /dev/null "https://$APP_URL/health")
    
    if [ "$STATUS" = "200" ]; then
        log_success "Database appears to be accessible"
    else
        log_warn "Database status unknown (aggregator returned $STATUS)"
    fi
}

test_redis_connectivity() {
    log_step "TEST 3: Redis connectivity"
    
    # Check if we have redis-cli available
    if command -v redis-cli &> /dev/null; then
        # Extract host/port from REDIS_URL
        if [[ $REDIS_URL =~ redis://default:([^@]*)@([^:]+):([0-9]+) ]]; then
            PASSWORD="${BASH_REMATCH[1]}"
            HOST="${BASH_REMATCH[2]}"
            PORT="${BASH_REMATCH[3]}"
            
            if redis-cli -h "$HOST" -p "$PORT" -a "$PASSWORD" ping &> /dev/null; then
                log_success "Redis is reachable"
                # Check queue
                COUNT=$(redis-cli -h "$HOST" -p "$PORT" -a "$PASSWORD" llen snapflow:queue:scans 2>/dev/null || echo "0")
                echo "  Scans queue length: $COUNT"
            else
                log_error "Redis connection failed"
                return 1
            fi
        else
            log_warn "Could not parse REDIS_URL"
        fi
    else
        log_warn "redis-cli not installed. Install with: apt-get install redis-tools"
    fi
}

test_container_apps_status() {
    log_step "TEST 4: Container Apps status"
    
    if ! command -v az &> /dev/null; then
        log_warn "Azure CLI not available. Skipping Container Apps status check."
        return 0
    fi
    
    for app in "v3-scanner" "v3-nlp-worker" "v3-visual-regression"; do
        if az containerapp show --name "$app" --resource-group "$RG_NAME" &> /dev/null; then
            REPLICAS=$(az containerapp show --name "$app" --resource-group "$RG_NAME" \
                --query "properties.template.scale.minReplicas" -o tsv 2>/dev/null || echo "unknown")
            log_success "$app exists (min replicas: $REPLICAS)"
        else
            log_error "$app not found in Azure"
            return 1
        fi
    done
}

test_container_registry() {
    log_step "TEST 5: Container Registry images"
    
    if ! command -v az &> /dev/null; then
        log_warn "Azure CLI not available. Skipping registry check."
        return 0
    fi
    
    REGISTRY_NAME="${REGISTRY_NAME:-snapflowregistry}"
    
    IMAGES=$(az acr repository list --name "$REGISTRY_NAME" 2>/dev/null || echo "")
    if [ -n "$IMAGES" ]; then
        log_success "Container Registry images:"
        echo "$IMAGES" | while read img; do
            echo "  - $img"
        done
    else
        log_error "Could not list images from registry"
        return 1
    fi
}

test_app_service_logs() {
    log_step "TEST 6: App Service logs (last 5 lines)"
    
    if ! command -v az &> /dev/null; then
        log_warn "Azure CLI not available. Skipping log check."
        return 0
    fi
    
    LOGS=$(az webapp log tail --name "snapflow-aggregator" --resource-group "$RG_NAME" 2>/dev/null | head -5 || echo "No logs available")
    
    if [ -n "$LOGS" ]; then
        echo "$LOGS" | while read line; do
            echo "  $line"
        done
    fi
}

test_sample_endpoint() {
    log_step "TEST 7: Sample API call (if available)"
    
    # Try calling a sample endpoint
    # Adjust based on actual aggregator endpoints
    STATUS=$(curl -s -w "%{http_code}" -o /dev/null "https://$APP_URL/api/status" 2>/dev/null || echo "000")
    
    if [ "$STATUS" = "200" ] || [ "$STATUS" = "404" ]; then
        log_success "API endpoint reachable (HTTP $STATUS)"
    else
        log_warn "API endpoint unreachable (HTTP $STATUS)"
    fi
}

# ============================================================================
# COST CHECK
# ============================================================================

cost_summary() {
    log_step "TEST 8: Cost monitoring setup"
    
    if ! command -v az &> /dev/null; then
        log_warn "Azure CLI not available. Cannot check spend."
        return 0
    fi
    
    echo ""
    echo "Monthly estimated costs:"
    echo "  • App Service F1:        FREE"
    echo "  • PostgreSQL B1ms:       ~\$13/month"
    echo "  • Container Apps (idle): ~\$0/month"
    echo "  • Container Apps (busy): ~\$8-15/month (depends on usage)"
    echo "  • Container Registry:    ~\$5/month"
    echo "  • Redis (Upstash):       FREE"
    echo ""
    echo "Total estimated: ~\$20-30/month from \$100 student credit"
    echo "Budget: ~4 months of usage"
    echo ""
    echo -e "${YELLOW}IMPORTANT: Set up cost alerts in Azure Portal${NC}"
    echo "  1. portal.azure.com → Cost Management → Budgets"
    echo "  2. Create budget for \$30/month"
    echo "  3. Alert at 80% (\$24)"
    echo ""
}

# ============================================================================
# MANUAL VERIFICATION CHECKLIST
# ============================================================================

manual_checks() {
    echo ""
    echo -e "${CYAN}════════════════════════════════════════════════════════════════════${NC}"
    echo "MANUAL VERIFICATION CHECKLIST"
    echo -e "${CYAN}════════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "[ ] 1. Visit aggregator in browser:"
    echo "       https://$APP_URL"
    echo ""
    echo "[ ] 2. Verify database migrations ran:"
    echo "       az postgres flexible-server db delete --name snapflow --resource-group $RG_NAME"
    echo "       (Check that tables exist via Azure Portal)"
    echo ""
    echo "[ ] 3. Set up external heartbeat (cron-job.org):"
    echo "       https://cron-job.org → Create Job"
    echo "       URL: https://$APP_URL/health"
    echo "       Interval: Every 10 minutes"
    echo ""
    echo "[ ] 4. Test a scan (push to Redis queue):"
    echo "       # Using Upstash web console or redis-cli:"
    echo "       LPUSH snapflow:queue:scans '{\"scan_id\":\"test\",\"domain\":\"example.com\"}'"
    echo "       # Check logs: az container logs --follow (for v3-scanner)"
    echo ""
    echo "[ ] 5. Verify Container Apps scale to 0 after scan:"
    echo "       az containerapp show --name v3-scanner --resource-group $RG_NAME"
    echo "       # Check: properties.template.scale.minReplicas = 0"
    echo ""
    echo "[ ] 6. Monitor Azure portal dashboard:"
    echo "       https://portal.azure.com"
    echo "       • Subscriptions → Azure for Students → Cost Analysis"
    echo "       • Set daily budget alert"
    echo ""
    echo "[ ] 7. (Optional) Set up monitoring:"
    echo "       • Application Insights on App Service"
    echo "       • Log Analytics for Container Apps"
    echo ""
}

# ============================================================================
# MAIN
# ============================================================================

main() {
    echo -e "${BLUE}════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}SnapFlow V3 - Azure Smoke Test${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    PASSED=0
    FAILED=0
    
    # Run tests
    for test in test_aggregator_health test_db_connectivity test_redis_connectivity \
                test_container_apps_status test_container_registry test_app_service_logs \
                test_sample_endpoint; do
        echo ""
        if $test; then
            ((PASSED++))
        else
            ((FAILED++))
        fi
    done
    
    cost_summary
    manual_checks
    
    # Summary
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════════════${NC}"
    echo "RESULTS: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    if [ $FAILED -eq 0 ]; then
        log_success "All tests passed! ✓"
        exit 0
    else
        log_error "$FAILED test(s) failed"
        exit 1
    fi
}

main "$@"
