                   # SnapFlow Codebase Analysis - Comprehensive Overview

**Date**: April 7, 2026  
**Version**: 1.0.0  
**Scope**: Complete architecture analysis of Frontend, Backend Microservices, Database, Infrastructure, and KPI Framework

---

## Table of Contents

1. [Frontend (Front-Snap)](#frontend-front-snap)
2. [Backend Microservices](#backend-microservices)
3. [Database Architecture](#database-architecture)
4. [Infrastructure & Deployment](#infrastructure--deployment)
5. [Key Technologies & Versions](#key-technologies--versions)
6. [Data Flow Through System](#data-flow-through-system)
7. [9 Audit Axes Framework](#9-audit-axes-framework)
8. [Integration Patterns](#integration-patterns)

---

## Frontend (Front-Snap/)

### Main Purpose
React-based SPA dashboard for managing and visualizing website audits. Provides comprehensive audit reporting, project management, and result visualization with support for French language content.

### Tech Stack
- **Core Framework**: React 18.3.1 with TypeScript
- **Build Tool**: Vite 5.4.19 (fast development server, optimized builds)
- **Styling**: Tailwind CSS 3.4.17 + PostCSS with autoprefixer
- **Component Library**: Radix UI (headless, accessible components)
- **Form Handling**: React Hook Form + Zod validation
- **Routing**: React Router DOM 6.30.1
- **State Management**: React Query (TanStack) 5.83.0 for server state
- **Charts & Visualization**: Recharts 2.15.4, html2canvas 1.4.1, jspdf 4.2.0
- **Backend Integration**: Supabase 2.97.0 (PostgreSQL + Auth + RealTime)
- **PDF Generation**: @react-pdf/renderer 4.3.2
- **Icons**: Lucide React 0.462.0
- **Testing**: Vitest 3.2.4, jsdom 20.0.3
- **Linting**: ESLint 9.32.0 + TypeScript support

### Architecture Patterns

#### 1. **Component Structure**
```
src/components/
├── layout/          # AppLayout, navigation wrappers
├── audit/           # AuditReport display, axis views
├── projects/        # Project management components
├── admin/           # User/admin management
├── schedules/       # Schedule management
├── notifications/   # Notification system
├── form-tester/     # Form testing workflow
├── pdf/             # PDF generation components
├── ai/              # AI assistant components
├── activity/        # Activity tracking views
├── ui/              # Shadcn UI primitives
└── [Components]     # CriticalityBadge, PriorityBadge, ScoreGauge, NavLink, Footer
```

#### 2. **Routing Strategy**
- **Unified Layout**: `AppLayout` component wraps authenticated routes
- **Legacy Redirects**: Old paths redirect to new organized structure
  - `/dashboard` → `/app`
  - `/admin` → `/app`
  - `/admin/projects` → `/app/projects`
- **Main Routes**:
  - `/auth` - Authentication page
  - `/app` - Dashboard (Overview)
  - `/app/projects` - Project listing
  - `/app/projects/:id` - Project detail
  - `/app/projects/:id/activity` - Activity report
  - `/app/reports` - Reports page
  - `/app/schedules` - Report scheduling
  - `/app/notifications` - Notifications center
  - `/app/workflows` - Workflow builder
  - `/app/workflows/form-tester` - Form tester tool
  - `/app/users` - User management
  - `/audit/:id` - Audit report view

#### 3. **State Management**
- **Authentication**: `AuthProvider` context manages user session, role, and admin status
- **Server State**: React Query for API data caching and synchronization
- **Theme**: `ThemeProvider` for dark/light mode persistence
- **UI Toast Notifications**: Sonner + Radix UI Toaster

### Key Hooks

| Hook | Purpose |
|------|---------|
| `useAuth()` | Session, user, role, isAdmin status |
| `useTheme()` | Dark/light mode toggling |
| `use-toast.ts` | Toast notification system |
| `useAsyncAuditPoll.ts` | Poll audit results asynchronously |
| `useAuth.tsx` | Authentication context management |
| `useFormTester.ts` | Form testing workflow state |
| `useFormWorkflowBuilder.ts` | Form workflow construction |
| `useProjectAssignments.ts` | Project assignment management |
| `useRealtimeNotifications.ts` | Supabase real-time notification listener |
| `useRedmineIdentifier.ts` | Redmine project integration |
| `useRedmineIssues.ts` | Fetch/sync Redmine issues |
| `use-mobile.tsx` | Mobile breakpoint detection |

### UI Components
- **Badge System**: `CriticalityBadge` (critical/high/medium/low), `PriorityBadge`
- **Gauges**: `ScoreGauge` for KPI/axis score visualization
- **Navigation**: `NavLink` component for route navigation
- **Footer**: Site footer component
- **Shadcn UI**: Accordion, Alert Dialog, Avatar, Checkbox, Dialog, Dropdown Menu, Hover Card, Label, Navigation Menu, Popover, Progress, Radio Group, ScrollArea, Select, Separator, Slider, Switch, Tabs, Toggle, Tooltip

### Key Utilities

**auditMapper.ts**:
- Normalizes audit report structure from API
- Maps 9 audit axes (French/English variants) to unified metadata
- Converts raw KPI data to display-friendly format
- Handles axis aliasing (e.g., "TECHNIQUE" → "TECHNIQUE", "CMS" → "TECHNIQUE")
- Manages passing KPI display (filters out risk wording from passing tests per user preference)

**mockAuditData.ts**:
- Mock audit report structure for BNDA Mali bank website
- Defines TypeScript interfaces: `AuditReport`, `AuditAxis`, `AuditFinding`, `KpiItem`, `AuditRoadmap`
- Provides axis score calculations and risk level inference
- Implements helper functions for report filtering (news, pages without meta, etc.)

### Data Flow

```
1. User logs in → Supabase Auth → AuthProvider stores session
2. Navigate to /app/projects → Fetch projects via React Query
3. Click project → /app/projects/:id → Fetch project detail + audit history
4. Trigger scan → POST to v3-aggregator /scan endpoint → Get scan_id
5. Poll v3-aggregator /status/:scan_id → Update UI with progress
6. Scan complete → Fetch full audit report
7. Display AuditReport → Map axis data via auditMapper.ts
8. User interacts with findings → Toast notifications via Sonner
9. Export audit → Use @react-pdf/renderer to generate PDF
10. Real-time updates → Supabase listener triggers notifications
```

### Data Access Integration
- **Supabase Client**: Configured in `src/integrations/supabase/client.ts`
  - Auto-refreshing JWT tokens
  - localStorage persistence
  - Real-time subscriptions enabled
- **Tables Accessed**:
  - `user_roles` - Fetch user roles for authorization
  - Custom audit tables (audit results, findings, etc.)

---

## Backend Microservices

### Architecture Overview

**Microservices Pattern**:
- **v3-scanner-go** (Port 8081): Web crawling, page metrics, security/functional analysis
- **v3-nlp-worker** (No Port): Async NLP processing, content analysis
- **v3-visual-regression** (Port 8083): Visual regression testing, UX metrics
- **v3-aggregator** (Port 8080): Central API gateway, orchestration, KPI building
- **v3-cli** (Local): Developer CLI for build/deploy/monitor/scan operations

All services use PostgreSQL (snapflow_v3 database) for persistence.

---

### 1. v3-scanner-go

**Purpose**: High-performance web crawler and multi-axis analyzer using Go with headless browser automation.

**Key Technologies**:
- **HTTP Framework**: Standard Go net/http
- **Web Scraping**: Colly v2 (web crawler with cookie/session support)
- **Browser Automation**: go-rod (Chrome/Chromium control)
- **Database**: pq (PostgreSQL driver)
- **Environment**: Alpine Linux 3.19 + Chromium

**Analyzers Implemented**:
```go
- formbrowser   → Form detection, interaction testing
- formfuzzer    → Form input fuzzing, anomaly detection
- functional    → Link validation (broken links), CTA analysis
- performance   → Core Web Vitals, image analysis, compression
- privacy       → Cookie analysis, tracking detection
- security      → XSS, SQLi, DDoS signal detection, SSL verification
- seo           → Meta tags, headings, sitemap, robots.txt
- tech          → CMS, framework, server detection
- ux            → Design analysis, layout stability
```

**Key Data Structures**:
```go
type ScannerConfig {
    ScanID              string
    StartURL            string
    AllowedDomains      []string
    MaxDepth            int
    MaxPages            int
    Parallelism         int
    HeadlessConcurrency int
}

type BrokenLink {
    URL, FoundOn, AnchorText string
    StatusCode int
    Error string
    IsExternal bool
}

type ImageCompressionStats {
    TotalImages, SampledImages, UnoptimisedCount int
    UnoptimisedImages []ImageCompressionInfo
    CompressionRatePct float64
    Passed bool
}

type PageIssueEntry {
    URL string
    Score int
    Issues []string
    Headings []HeadingInfo
    Meta MetaInfo
}
```

**Database Operations**:
- Inserts page-level metrics into `scan_pages` table
- Stores HTML content for NLP processing
- Computes and stores domain-level KPIs in `scan_summaries`

**API Endpoints**:
- `GET /health` - Service health check
- `POST /scan` - Initiate crawl (accepts ScannerConfig JSON)
  - Returns scan_id and queues crawl job
  - Asynchronous - returns immediately while scan runs in background

**Output**:
- Tier 1+2 KPIs stored in `scan_pages.metrics` (JSONB)
- Domain-level aggregations in `scan_summaries` (Security, Tech Stack, Privacy, Functional)
- Image compression analysis
- Broken links detection with HTTP status codes
- SEO analysis with page-by-page scoring

---

### 2. v3-nlp-worker

**Purpose**: Async NLP processor for text analysis, readability scoring, and keyword extraction.

**Key Technologies**:
- **Web Framework**: FastAPI 0.111.0 + Uvicorn
- **NLP Libraries**:
  - NLTK 3.9.1 (tokenization, stopwords, stemming via SnowballStemmer)
  - spaCy (optional for advanced NLP)
  - language-tool-python (grammar checking, optional)
  - textstat 0.7.4 (readability metrics: Flesch-Kincaid, SMOG, Gunning Fog)
- **HTML Parsing**: BeautifulSoup 4.12.3
- **Database**: psycopg2 2.9.9
- **JSON**: json5 (lenient parsing)

**Processing Pipeline**:
```
1. Poll `scan_pages` WHERE nlp_results IS NULL (every 3s by default)
2. Extract text from HTML using BeautifulSoup
3. Clean text (normalize unicode, remove extra whitespace)
4. Calculate NLP metrics:
   - Word count, unique word count
   - Keyword density (top N keywords with stem deduplication)
   - Readability scores (Flesch-Kincaid, SMOG, Gunning Fog)
   - Language detection
   - Sentiment analysis (optional)
5. Store results in `scan_pages.nlp_results` (JSONB)
6. Update `scan_summaries` with aggregated NLP metrics
```

**NLP Metrics Captured**:
- Word count (total, unique, density)
- Stop word ratio
- Average word/sentence length
- Flesch Reading Ease (0-100 scale)
- Flesch-Kincaid Grade Level
- SMOG Index
- Gunning Fog Index
- Keyword extraction with frequency
- Duplicate content detection

**Database Operations**:
- Queries `scan_pages` for pending pages (`nlp_results IS NULL`)
- Updates `nlp_results` JSONB field when complete
- Polls continuously (configurable `POLL_INTERVAL`)
- Handles text extraction and cleaning

**Key Features**:
- Multi-language support (NLTK stopwords for various languages)
- Graceful error handling for malformed HTML
- Optional language detection
- Configurable polling interval

---

### 3. v3-visual-regression

**Purpose**: Visual regression testing and UX metrics computation via Chromium screenshots.

**Key Technologies**:
- **Web Framework**: FastAPI 0.115.0 + Uvicorn
- **Image Processing**:
  - Pillow (PIL) for image manipulation
  - scikit-image (SSIM - Structural Similarity Index)
  - OpenCV (Canny edge detection)
- **Browser Automation**: Chromium via playwright/pyppeteer-like abstractions
- **Database**: psycopg2 2.9.9

**KPI Engines**:

#### **1. Régression Visuelle Pondérée (Weighted Visual Regression)**
- **Endpoint**: `POST /compare`
- **Input**: baseline scan_id vs new scan_id + URLs
- **Output**: `weighted_regression_score` (0-100 per page)
- **Zones** (5 semantic regions with weights):
  - Header (0-12%, weight 0.30)
  - Hero (12-35%, weight 0.25)
  - Content (35-80%, weight 0.15)
  - Footer (80-100%, weight 0.05)
  - CTA (optional, weight 0.25)
- **Computation**: SSIM delta per zone × zone weight × 200
- **Formula**: `weighted_regression_score = Σ(SSIM_delta_i × weight_i) × 200`

#### **2. Complexité Visuelle (Visual Complexity)**
- **Endpoint**: `POST /ux-kpis`
- **Output**: `visual_complexity_score` (0-100)
- **Computation**: Canny edge detection → edge_density normalization
- **Formula**: `score = min(edge_density / 0.30, 1.0) × 100`
- **Ranges**:
  - Simple: 0-40 (edge density < 0.12)
  - Modéré: 40-73 (edge density 0.12-0.22)
  - Complexe: 73-100 (edge density > 0.22)
- **Optimal**: ~0.18 edge density for best UX

#### **3. Proéminence CTA (CTA Prominence)**
- **Endpoint**: `POST /ux-kpis`
- **Output**: `cta_prominence_score` (0-100)
- **Sub-Metrics**:
  - Above-fold positioning (weight 0.40)
  - WCAG contrast ratio (weight 0.35)
  - Visual saliency percentile (weight 0.25)
- **Formula**: `(above_fold × 0.40 + contrast × 0.35 + saliency × 0.25) × 100`
- **Pass Criteria**: Score ≥ 60 AND WCAG contrast ≥ 4.5

#### **4. Score d'Impression Initiale (First Impression Score)**
- **Endpoint**: `POST /ux-kpis`
- **Output**: `first_impression_score` (0-100)
- **Sub-Components** (weighted):
  - Above-fold density: 0.30
  - CTA prominence: 0.35
  - Visual hierarchy: 0.20
  - Complexity (inverted): 0.15
- **Severity Mapping**:
  - Passing: score ≥ 73 (green)
  - Warning: score 60-72 (yellow)
  - Failing: score < 60 (red)

**API Endpoints**:
- `GET /health` - Service health check
- `POST /screenshot` - Capture screenshots for URLs
- `POST /compare` - Compare baseline vs new screenshots
- `POST /ux-kpis` - Compute UX metrics
- `POST /browser-compat` - Test browser compatibility

**Database**:
- Stores screenshots in `visual_screenshots` table
- Links to scan_id for retrieval
- Enables baseline/regression comparison

**Configuration**:
- `REGRESSION_THRESHOLD`: 5% pixel change threshold
- `FUSED_REGRESSION_THRESHOLD`: 0.22 normalized score
- `CHROME_NO_SANDBOX`: true for Docker containerization
- `VISUAL_REGRESSION_ENABLED`: feature flag

---

### 4. v3-aggregator

**Purpose**: Central API gateway orchestrating scan requests across all services, building KPI reports, and managing audit results lifecycle.

**Key Technologies**:
- **Web Framework**: FastAPI 0.115.0 + Uvicorn
- **HTTP Client**: requests 2.32.3 for inter-service communication
- **Database**: psycopg2 2.9.9
- **Data Validation**: Pydantic 2.7.1
- **Core Processing**: ThreadingRLock for thread-safe scan status

**Architecture**:

```
v3-aggregator orchestrates:
1. Scan Request (POST /scan)
   ↓
2. Call v3-scanner-go (POST /scan) → get scan_id → crawl starts
   ↓
3. Poll v3-scanner-go for completion
   ↓
4. Call v3-visual-regression (POST /compare) → VRT KPIs
   ↓
5. NLP Worker polls autonomously → populates nlp_results
   ↓
6. Aggregate all results → build KPI-centric report
   ↓
7. Apply classification rules via classifier.py → build recommendations
   ↓
8. Return final audit report
```

**Core Modules**:

#### **kpi_builder.py**
- Converts raw scan data to KPI-centric report structure
- Builds 9 audit axes with scores
- **Key Function**: `build_kpi_centric_report()`
  - Reads `scan_pages` + `scan_summaries` data
  - Computes per-axis scores
  - Generates passing KPIs list
  - Returns French-language audit structure

#### **classifier.py**
- Builds recommendations from KPI findings
- Grades severity and effort
- Creates actionable roadmap
- **Key Function**: `build_recommendations()`
  - Extracts findings from axes
  - Scores effort (LOW/MEDIUM/HIGH) based on scope + complexity
  - Sorts by severity (CRITICAL → HIGH → MEDIUM → LOW)
  - Organizes into roadmap: `immediate | this_sprint | this_quarter | backlog`
- **Severity Scoring**: Based on vulnerability type, affected page count, fix complexity

**Key Data Structures**:
```python
class ScanRequest(BaseModel):
    url: str
    max_depth: int = 2
    max_pages: int = 50
    parallelism: int = 4

class ScanStatus(BaseModel):
    scan_id: str
    status: str  # "scanning" | "processing" | "complete" | "failed"
    progress_pct: float
    current_page_count: int
    total_pages: int
    error: Optional[str]

class AuditReport(BaseModel):
    scan_id: str
    domain: str
    axes: Dict[str, AxisReport]
    domain_analysis: Dict
    site_metrics: Dict
    summary: AuditSummary
    quick_wins: List[ActionItem]
    bugs: List[ActionItem]
    recommendations: List[ActionItem]
    compliance: List[ActionItem]
    roadmap: Roadmap
    passing_kpis: List[PassingKpi]
    generated_at: str  # ISO 8601
```

**API Endpoints**:
- `POST /scan` - Initiate audit scan
  ```json
  Request: { "url": "https://example.com", "max_depth": 2, "max_pages": 50 }
  Response: { "scan_id": "scan_abc123", "status": "scanning" }
  ```
- `GET /status/:scan_id` - Poll scan progress
  ```json
  Response: { "scan_id": "...", "status": "scanning", "progress_pct": 45, "current_page_count": 23, ... }
  ```
- `GET /report/:scan_id` - Fetch final audit report
  ```json
  Response: { Full AuditReport structure }
  ```

**Service Communication**:
- Calls `SCANNER_API_URL` (default: `http://scanner:8081`)
- Calls `VISUAL_REGRESSION_API_URL` (default: `http://v3-visual-regression:8083`)
- Fallback candidate URLs for local/Docker variations

**In-Memory State**:
- `scans: dict[str, dict]` - Tracks ongoing scan status
- Thread-safe via `scans_lock = threading.RLock()`
- Persisted to DB for cross-container visibility

---

### 5. v3-cli

**Purpose**: Developer CLI for building, deploying, monitoring, and testing SnapFlow services.

**Key Technologies**:
- **Language**: Go 1.22+
- **Config**: `.snapflow.yaml` YAML file
- **Tunnel**: pinggy.io for deployment exposure
- **Docker**: Direct container log access

**Command Structure**:
```
snapflow [command] [flags]

Commands:
├── monitor    Monitor service health via polling + Docker
├── build      Build microservices with configurable cross-compilation
├── deploy     Deploy via pinggy.io tunnel
├── scan       Trigger scan via v3-aggregator API
│   ├── scan https://example.com --watch
│   └── scan status scan_12345
└── [Interactive Menu]
```

**Commands Detail**:

| Command | Purpose | Config Key |
|---------|---------|-----------|
| `monitor` | Poll service health endpoints + Docker container status | `monitor.poll_interval_ms`, `monitor.services[]` |
| `build` | Cross-compile Go binaries (default: Linux amd64) | `build.cgo_enabled`, `build.goos`, `build.output` |
| `deploy` | Create pinggy.io tunnel for remote testing | `deploy.pinggy_token`, `deploy.target_port` |
| `scan` | Trigger scan on remote/local aggregator | Calls `api_url/scan` |

**Config File** (`.snapflow.yaml` / `~/.snapflow.yaml`):
```yaml
api_url:     http://localhost:8080
scanner_url: http://localhost:8081

build:
  cgo_enabled: "0"
  goos: linux
  goarch: amd64
  output: ./bin/scanner
  source: ./v3-scanner-go

deploy:
  pinggy_token: "your-token"
  target_port: 8080
  tunnel_region: ""

monitor:
  poll_interval_ms: 2000
  log_lines_buffer: 200
  services:
    - name: scanner
      url: http://localhost:8081/health
    - name: aggregator
      url: http://localhost:8080/health
    - name: nlp-worker
      check: docker
      container: v3-nlp-worker
```

---

## Database Architecture

### Database: snapflow_v3 (PostgreSQL 16)

**Connection**:
```
Host: db (Docker) or localhost (local)
Port: 5432
User: snapflow
Password: snapflow (default)
Database: snapflow_v3
```

### Tables

#### **scan_pages**
Central table for page-level crawl data.

```sql
CREATE TABLE scan_pages (
    id                SERIAL PRIMARY KEY,
    scan_id           VARCHAR(64)  NOT NULL,     -- groups pages from one scan
    domain            VARCHAR(255) NOT NULL,
    url               TEXT         NOT NULL,
    html              TEXT,                       -- full HTML from Colly
    metrics           JSONB DEFAULT '{}',         -- Tier 1+2 KPIs from Go
    nlp_results       JSONB DEFAULT NULL,         -- Tier 3 NLP results (NULL = pending)
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT uq_scan_url UNIQUE (scan_id, url)
);

CREATE INDEX idx_nlp_pending ON scan_pages (id) WHERE nlp_results IS NULL;
CREATE INDEX idx_scan_domain ON scan_pages (scan_id, domain);
```

**Schema**:
| Column | Type | Purpose |
|--------|------|---------|
| id | SERIAL | Primary key |
| scan_id | VARCHAR(64) | Groups pages from one scan run |
| domain | VARCHAR(255) | Target domain |
| url | TEXT | Full page URL |
| html | TEXT | Full HTML response from Colly |
| metrics | JSONB | Tier 1+2 KPIs from v3-scanner-go (Performance, Security, Functional, SEO, Tech Stack, Privacy, UX, etc.) |
| nlp_results | JSONB | Tier 3 NLP results from v3-nlp-worker (readability, keywords, content quality); NULL until processed |
| created_at | TIMESTAMP | Row creation timestamp |

**Metrics JSONB Structure** (example):
```json
{
  "performance": { "lcp_ms": 3200, "fcp_ms": 1800, "cls": 0.08 },
  "security": { "has_https": true, "cookie_issues": 2 },
  "seo": { "has_h1": true, "meta_description": "...", "score": 75 },
  "broken_links": { "count": 3, "links": [...] },
  "image_compression": { "total": 12, "unoptimized": 4 }
}
```

**NLP Results JSONB Structure** (example):
```json
{
  "word_count": 1250,
  "unique_words": 450,
  "readability": {
    "flesch_kincaid_grade": 8.5,
    "flesch_reading_ease": 62.0,
    "smog_index": 10.2
  },
  "keywords": [
    { "word": "banking", "frequency": 12, "density": 0.96 },
    { "word": "financial", "frequency": 8, "density": 0.64 }
  ]
}
```

---

#### **scan_summaries**
Domain-level aggregated KPI summary.

```sql
CREATE TABLE scan_summaries (
    scan_id                VARCHAR(64) PRIMARY KEY,
    domain                 VARCHAR(255) NOT NULL,
    domain_security        JSONB DEFAULT '{}',
    domain_tech            JSONB DEFAULT '{}',
    domain_privacy         JSONB DEFAULT '{}',
    domain_functional      JSONB DEFAULT '{}',
    image_compression      JSONB DEFAULT NULL,
    broken_links_summary   JSONB DEFAULT NULL,
    seo_kpi_extended       JSONB DEFAULT NULL,
    form_fuzzer_summary    JSONB DEFAULT NULL,
    created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Schema**:
| Column | Type | Purpose |
|--------|------|---------|
| scan_id | VARCHAR(64) | Primary key (unique per scan) |
| domain | VARCHAR(255) | Target domain |
| domain_security | JSONB | Aggregated security metrics across all pages |
| domain_tech | JSONB | Tech stack, CMS, framework detection |
| domain_privacy | JSONB | Privacy & compliance metrics |
| domain_functional | JSONB | Functional test results |
| image_compression | JSONB | Site-wide image optimization stats |
| broken_links_summary | JSONB | Aggregated broken links with status codes |
| seo_kpi_extended | JSONB | Site-wide SEO KPIs (meta coverage, headings, etc.) |
| form_fuzzer_summary | JSONB | Form fuzzing test summary |
| created_at | TIMESTAMP | Scan creation timestamp |

**Relationships**:
- One-to-many: `scan_summaries` (1) ← `scan_pages` (many) via scan_id

---

#### **form_fuzz_results**
Detailed form fuzzing test records (Phase Form Fuzzer).

```sql
CREATE TABLE form_fuzz_results (
    id             BIGSERIAL PRIMARY KEY,
    scan_id        VARCHAR(64) NOT NULL,
    page_url       TEXT        NOT NULL,
    action_url     TEXT        NOT NULL,
    form_id        TEXT        NOT NULL,
    test_type      VARCHAR(32) NOT NULL,
    payload        JSONB       DEFAULT '{}'::jsonb,
    response_type  VARCHAR(32) DEFAULT 'error',
    status_code    INTEGER     DEFAULT 0,
    anomaly        BOOLEAN     DEFAULT FALSE,
    anomaly_reason TEXT,
    duration_ms    BIGINT      DEFAULT 0,
    error          TEXT,
    created_at     TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_form_fuzz_scan ON form_fuzz_results 
    (scan_id, page_url, form_id, test_type, created_at);
```

**Schema**:
| Column | Type | Purpose |
|--------|------|---------|
| id | BIGSERIAL | Primary key |
| scan_id | VARCHAR(64) | References scan |
| page_url | TEXT | URL where form found |
| action_url | TEXT | Form submission target |
| form_id | TEXT | HTML form identifier |
| test_type | VARCHAR(32) | Type of fuzzing test performed |
| payload | JSONB | Input payload sent |
| response_type | VARCHAR(32) | Response type: 'error', 'success', 'timeout' |
| status_code | INTEGER | HTTP response status |
| anomaly | BOOLEAN | Whether test revealed anomaly |
| anomaly_reason | TEXT | Description of anomaly |
| duration_ms | BIGINT | Test execution time |
| error | TEXT | Error message if test failed |
| created_at | TIMESTAMP | Test execution timestamp |

---

#### **Additional Supabase Tables** (Frontend)
- `user_roles` - Maps user IDs to roles (admin, user, etc.)
- `audit_results` - (inferred) Stores API audit responses
- Additional project/task/notification tables as needed

---

## Infrastructure & Deployment

### Docker Compose Setup

**File**: `V3-Microservices/docker-compose.yml`

```yaml
services:
  db:
    Image: postgres:16-alpine
    Ports: 5432:5432
    Volumes: pgdata, init.sql mount
    Healthcheck: pg_isready check
    
  scanner (v3-scanner-go):
    Build: ./v3-scanner-go/Dockerfile
    Ports: 8081:8081
    Depends: db (healthy)
    Env: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS, CHROME_NO_SANDBOX
    
  nlp-worker:
    Build: ./v3-nlp-worker/Dockerfile
    No exposed port (internal service)
    Depends: db (healthy)
    Env: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS, POLL_INTERVAL
    Restart: unless-stopped
    
  aggregator:
    Build: ./v3-aggregator/Dockerfile
    Ports: 8080:8080
    Depends: db (healthy)
    Env: DB_*, SCANNER_API_URL, VISUAL_REGRESSION_API_URL
    Restart: unless-stopped
    
  v3-visual-regression:
    Build: ./v3-visual-regression/Dockerfile
    Ports: 8083:8083
    Depends: db (healthy)
    Env: DATABASE_URL, VISUAL_REGRESSION_ENABLED, CHROME_NO_SANDBOX
    Restart: unless-stopped

volumes:
  pgdata:
```

**Port Mapping**:
| Service | Port | Purpose |
|---------|------|---------|
| db | 5432 | PostgreSQL |
| scanner | 8081 | v3-scanner-go API |
| aggregator | 8080 | v3-aggregator API (main gateway) |
| v3-visual-regression | 8083 | VRT service |
| nlp-worker | None | Internal, polled by workers |

**Service Dependencies**:
- All services depend on healthy PostgreSQL before starting
- NLP Worker: Autonomous polling (no dependencies after DB ready)
- Scanner: Stateless per scan, can scale horizontally
- Visual Regression: Requires Chromium (baked into image)

**Volumes**:
- `pgdata` - PostgreSQL persistent data volume
- `./db/init.sql` - Database initialization (executed on first db start)

---

### Deployment Strategies

#### **Local Development**
```bash
docker-compose up -d
# Access:
# - Aggregator: http://localhost:8080
# - Scanner: http://localhost:8081
# - Visual Regression: http://localhost:8083
# - DB: localhost:5432
```

#### **CLI-Based Deployment** (via v3-cli)
```bash
snapflow build      # Compile all Go services
snapflow deploy     # Create pinggy.io tunnel for external access
snapflow monitor    # Health monitoring
snapflow scan https://example.com --watch
```

#### **Azure Deployment** (QUICKSTART docs available)
- Scripts: `azure-deploy.sh`, `azure-env.sh`, `azure-preflight.sh`
- Smoke tests: `azure-smoke-test.sh`
- Manual testing: `run_manual_test.sh`

---

### Build Configuration

**Go Scanner Build** (Multi-stage Dockerfile):
```dockerfile
# Stage 1: Build
FROM golang:alpine
COPY go.mod go.sum
RUN go mod download (with retry loop)
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /v3-scanner-go

# Stage 2: Runtime
FROM alpine:3.19
RUN apk add chromium ca-certificates tzdata
ENV CHROME_PATH=/usr/bin/chromium-browser
COPY --from=builder /v3-scanner-go .
ENTRYPOINT ["./v3-scanner-go"]
```

**Python Services Build**:
- Simple Dockerfile with Python base
- Copies `requirements.txt` → `pip install`
- Sets working directory → runs service

---

## Key Technologies & Versions

### Frontend Stack
| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 18.3.1 | Core UI framework |
| TypeScript | 5.8.3 | Type safety |
| Vite | 5.4.19 | Build & dev server |
| Tailwind CSS | 3.4.17 | Utility-first styling |
| Shadcn/UI | Latest via Radix | Headless components |
| React Router | 6.30.1 | Client-side routing |
| React Query | 5.83.0 | Server state management |
| Supabase | 2.97.0 | Backend as a Service |
| Recharts | 2.15.4 | Chart visualization |
| Zod | 3.25.76 | Schema validation |

### Backend Stack
| Technology | Version | Purpose |
|-----------|---------|---------|
| Go | 1.22+ | Scanner, CLI |
| Python | 3.x | NLP, Aggregator, Visual Regression |
| FastAPI | 0.115.0 | Python web framework |
| PostgreSQL | 16-alpine | Database |
| Colly | v2 | Web crawler |
| go-rod | Latest | Browser automation |
| NLTK | 3.9.1 | NLP library |
| spaCy | Latest | Advanced NLP (optional) |
| Pillow | Latest | Image processing |
| scikit-image | Latest | SSIM computation |

### DevOps Stack
| Technology | Purpose |
|-----------|---------|
| Docker | Containerization |
| Docker Compose | Multi-container orchestration |
| Alpine Linux | Minimal base image |
| Chromium | Headless browser |
| pinggy.io | Tunnel for deployment |

---

## Data Flow Through System

### Complete Audit Request Lifecycle

```
1. USER INITIATES SCAN
   ├─ Frontend: POST /app (React app)
   ├─ User enters URL + scan parameters
   ├─ POST to Aggregator: /scan
   │  └─ Body: { url, max_depth, max_pages, parallelism }
   └─ Response: { scan_id: "scan_abc123", status: "scanning" }

2. SCANNER CRAWL PHASE
   ├─ Aggregator spawns crawler in v3-scanner-go
   ├─ Scanner:
   │  ├─ Crawls pages via Colly + go-rod
   │  ├─ Runs analyzers:
   │  │  ├─ performance → LCP, FCP, CLS, Core Web Vitals
   │  │  ├─ security → XSS, SQLi, DDoS signals
   │  │  ├─ seo → meta tags, headings, robots.txt
   │  │  ├─ functional → broken links, CTA analysis
   │  │  ├─ tech → framework, CMS detection
   │  │  ├─ privacy → cookies, tracking
   │  │  └─ ux → layout, design analysis
   │  ├─ Inserts into scan_pages (Tier 1+2 metrics in JSONB)
   │  └─ Aggregates into scan_summaries
   └─ Duration: Minutes (depends on site size)

3. NLP ASYNC PROCESSING
   ├─ NLP Worker continuously polls:
   │  WHERE nlp_results IS NULL
   ├─ For each pending page:
   │  ├─ Extracts text from HTML
   │  ├─ Calculates:
   │  │  ├─ Readability (Flesch-Kincaid, SMOG, Gunning Fog)
   │  │  ├─ Keyword density + extraction
   │  │  ├─ Word count metrics
   │  │  └─ Duplicate detection
   │  ├─ Updates scan_pages.nlp_results
   │  └─ Aggregates into scan_summaries
   └─ Duration: Minutes (runs in background)

4. VISUAL REGRESSION ANALYSIS
   ├─ Aggregator calls v3-visual-regression:
   │  ├─ POST /screenshot → Capture baseline screenshots
   │  └─ POST /ux-kpis → Compute UX metrics
   ├─ Visual Regression computes:
   │  ├─ Visual Complexity (edge detection, density)
   │  ├─ CTA Prominence (positioning, contrast, saliency)
   │  ├─ First Impression Score (composite)
   │  └─ Weighted Regression Score (zone comparison)
   └─ Results linked to scan_summaries

5. FORM FUZZING (If enabled)
   ├─ Scanner detects forms via formbrowser
   ├─ FormFuzzer runs payloads:
   │  ├─ SQL injection patterns
   │  ├─ XSS patterns
   │  ├─ Default credentials
   │  └─ Field validation tests
   ├─ Stores anomalies in form_fuzz_results table
   └─ Aggregates into scan_summaries.form_fuzzer_summary

6. KPI AGGREGATION & REPORT BUILDING
   ├─ Aggregator waits for all phases:
   │  ├─ scan_pages populated
   │  ├─ scan_summaries aggregated
   │  ├─ nlp_results completed
   │  └─ visual_regression linked
   ├─ kpi_builder.py:
   │  ├─ Reads raw data from scan_summaries
   │  ├─ Computes 9 audit axes scores
   │  ├─ Maps KPIs to axis/sub-axis structure
   │  └─ Generates finding list per axis
   ├─ classifier.py:
   │  ├─ Scores severity (CRITICAL, HIGH, MEDIUM, LOW)
   │  ├─ Calculates effort (LOW, MEDIUM, HIGH)
   │  ├─ Prioritizes findings
   │  └─ Creates actionable roadmap
   └─ Returns complete AuditReport JSON

7. FRONTEND POLLING & DISPLAY
   ├─ React app polls Aggregator:
   │  GET /status/:scan_id
   ├─ Poll returns:
   │  ├─ status: "scanning" | "processing" | "complete" | "failed"
   │  ├─ progress_pct: 0-100
   │  ├─ current_page_count: N
   │  └─ error: (if failed)
   ├─ When complete, fetches full report:
   │  GET /report/:scan_id
   ├─ auditMapper.ts normalizes axes:
   │  ├─ Maps French/English axis names
   │  ├─ Filters passing KPIs
   │  └─ Filters risk wording from passing tests (per user preference)
   ├─ React renders:
   │  ├─ Global score gauge
   │  ├─ 9 axis cards with scores
   │  ├─ Findings organized by type (bugs, recommendations, compliance)
   │  ├─ Roadmap (immediate, this_sprint, this_quarter, backlog)
   │  └─ Passing KPIs list
   └─ User can export to PDF via jsPDF

8. SUPABASE REAL-TIME UPDATES (Optional)
   ├─ Scan completion triggers event
   └─ Frontend listener updates UI in real-time
```

---

## 9 Audit Axes Framework

SnapFlow evaluates websites across **9 distinct axes**, each with sub-axes, KPIs, and findings.

### Axis Structure

```
Axis (name, id, icon, scoring)
├── Sub-Axes (related sub-dimensions)
├── KPIs (individual measurements)
├── Findings (bugs, recommendations, passing_kpis)
└── Score Aggregation
```

---

### The 9 Axes

#### **1. Audit Fonctionnel (Functional Audit)**
**ID**: `functional` | **Icon**: functional

**Purpose**: Verify correct functionality of all interactive elements, forms, links, buttons, CTA, internal search.

**Sub-Axes**:
- Form functionality & validation
- CTA (Call-To-Action) visibility & behavior
- Internal link integrity (broken link detection with HTTP status)
- Search engine availability
- Interactive element responsiveness

**KPIs Measured**:
- Form validation status (error 500s detected, missing validation)
- CTA prominence score (from v3-visual-regression)
- Broken links count & status codes
- Search functionality presence
- Form fuzz anomalies

**Typical Findings**:
- Broken forms (returning 500 errors)
- 404 links with redirect recommendations
- Weak CTA placement
- Missing search functionality
- Form validation gaps

**Score Calculation**:
```
functional_score = (
  1.0 - (broken_links_count / total_links) × 0.40
  - (form_errors_count / total_forms) × 0.40
  - (low_cta_prominence) × 0.20
) × 100
```

---

#### **2. Accessibilité & W3C (Accessibility & W3C Compliance)**
**ID**: `accessibility` | **Icon**: accessibility

**Purpose**: Ensure compliance with WCAG 2.1 guidelines, W3C HTML standards, and accessibility best practices.

**Sub-Axes**:
- HTML/CSS validity (W3C)
- Text contrast (WCAG AA/AAA)
- Keyboard navigation
- ALT text for images
- Heading hierarchy (H1-H6 structure)
- Form labels & ARIA attributes
- Screen reader compatibility

**KPIs Measured**:
- HTML validation errors count
- Contrast ratio (WCAG 2.1 AA = 4.5:1 minimum)
- Image ALT coverage percentage
- Keyboard-navigable element count
- H1 uniqueness & hierarchy validation
- ARIA attribute presence

**Typical Findings**:
- 87+ HTML validation errors
- 60% of text with low contrast
- 78% of images missing ALT text
- Non-keyboard-navigable form fields
- Multiple H1 tags per page
- Missing form labels

**Score Calculation**:
```
accessibility_score = (
  1.0 - (validation_errors / total_elements) × 0.25
  - (low_contrast_count / total_text) × 0.35
  - (missing_alts / total_images) × 0.25
  - (non_keyboard_elements / total_interactive) × 0.15
) × 100
```

---

#### **3. Performance (Performance & Core Web Vitals)**
**ID**: `performance` | **Icon**: performance

**Purpose**: Measure page loading speed, Core Web Vitals, and server responsiveness.

**Sub-Axes**:
- Largest Contentful Paint (LCP) ≤ 2.5s
- First Contentful Paint (FCP) ≤ 1.8s
- Cumulative Layout Shift (CLS) ≤ 0.1
- Time to First Byte (TTFB)
- Image optimization & compression
- Script optimization (defer/async)
- Server-side compression (GZIP/Brotli)

**KPIs Measured**:
- LCP milliseconds (desktop + mobile)
- FCP milliseconds
- CLS as decimal
- Image compression ratio (actual vs optimized)
- Unoptimized image count
- Render-blocking script count
- Compression algorithm used

**Typical Findings**:
- LCP > 8s on mobile (critical)
- Images uncompressed (5+ MB total)
- No GZIP/Brotli compression
- 4+ render-blocking scripts
- No lazy loading implemented

**Score Calculation**:
```
performance_score = (
  max(0, 1.0 - (lcp_ms - 2500) / 5000) × 0.30
  + max(0, 1.0 - (fcp_ms - 1800) / 3000) × 0.25
  + max(0, 1.0 - cls / 0.2) × 0.25
  + (image_compression_ratio) × 0.15
  + server_compression_bonus × 0.05
) × 100
```

---

#### **4. Audit SEO (Search Engine Optimization)**
**ID**: `seo` | **Icon**: seo

**Purpose**: Optimize for search engine visibility, indexation, and organic traffic.

**Sub-Axes**:
- META tags (description, keywords, OG tags)
- Sitemap XML presence & validity
- robots.txt configuration
- URL structure (clean, descriptive)
- Heading hierarchy
- Duplicate content detection
- Mobile-friendly detection
- Structured data (Schema.org)

**KPIs Measured**:
- META description coverage (%)
- Sitemap XML found (bool) + valid (bool)
- robots.txt present (bool)
- Page title uniqueness
- H1 presence per page
- Duplicate content percentage
- Mobile viewport tag
- Schema.org implementation

**Typical Findings**:
- 10/12 pages missing meta descriptions
- Sitemap XML not found (404)
- Inconsistent H1 hierarchy
- Parameter-heavy URLs (non-descriptive)
- Duplicate content across pages
- No structured data

**Score Calculation**:
```
seo_score = (
  (meta_description_coverage / total_pages) × 0.30
  + (sitemap_found ? 1.0 : 0.0) × 0.25
  + (robots_txt_valid ? 1.0 : 0.0) × 0.15
  + (unique_h1_ratio) × 0.20
  + (1.0 - duplicate_ratio) × 0.10
) × 100
```

---

#### **5. Audit de Contenu (Content Audit)**
**ID**: `content` | **Icon**: content

**Purpose**: Evaluate content quality, relevance, originality, and editorial consistency.

**Sub-Axes**:
- Content timeliness (news/updates frequency)
- Content uniqueness (duplicate detection via NLP)
- Readability metrics (Flesch-Kincaid, SMOG)
- Keyword targeting & density
- Content structure & formatting
- Spelling & grammar

**KPIs Measured**:
- Last content update date
- Readability grade level
- Flesch Reading Ease (0-100)
- Keyword density per page
- Unique content percentage
- Spelling errors count
- Page word count metrics

**Typical Findings**:
- News not updated in 6+ months
- Readability grade > 12 (too complex)
- Duplicate content across pages
- No keyword targeting visible
- Poor grammar/spelling

**Score Calculation**:
```
content_score = (
  (1.0 - days_since_update / 180) × 0.30  # Timeliness
  + (readability_grade_inverse) × 0.25    # Readability
  + (unique_content_ratio) × 0.25         # Originality
  + (keyword_optimization) × 0.20         # Targeting
) × 100
```

---

#### **6. Audit UX/UI (User Experience & User Interface)**
**ID**: `ux-ui` | **Icon**: ux-ui

**Purpose**: Assess design quality, usability, navigation, visual hierarchy, and mobile compatibility.

**Sub-Axes**:
- Responsive design (mobile, tablet, desktop)
- Navigation structure & clarity
- Visual hierarchy (typography, color, spacing)
- Design consistency (brand guidelines adherence)
- CTA prominence & visibility
- Landing page clarity
- Mobile-first approach

**KPIs Measured**:
- Responsive breakpoint coverage
- Navigation menu item count
- CTA prominence score (0-100)
- Visual complexity score (0-100)
- First impression score (0-100)
- Design consistency metrics
- Color palette compliance

**Typical Findings** (from v3-visual-regression):
- Non-responsive layout on mobile
- Excessive navigation items (>7)
- CTA below fold or poor contrast
- Visual complexity too high (> 0.30 edge density)
- Inconsistent typography/colors
- First impression score < 60

**Score Calculation**:
```
ux_ui_score = (
  responsive_coverage × 0.20
  + navigation_clarity × 0.15
  + cta_prominence / 100 × 0.35
  + (1.0 - visual_complexity_normalized) × 0.15
  + first_impression / 100 × 0.15
) × 100
```

---

#### **7. Eco Index (Environmental Impact)**
**ID**: `eco-index` | **Icon**: eco-index

**Purpose**: Measure environmental footprint of the website (page weight, requests, data transfer).

**Sub-Axes**:
- Page weight (HTML, CSS, JS, images, metadata)
- Total HTTP requests count
- Data transfer per page (compressed vs. uncompressed)
- Code splitting efficiency
- Asset caching headers
- Carbon footprint estimation

**KPIs Measured**:
- Average page weight (MB)
- Total requests per page
- Uncompressed data size
- Compression savings percentage
- Cache-Control header presence
- Number of external resources

**Typical Findings**:
- Average page weight 3.8 MB (target: < 1 MB)
- 85+ requests per page (target: < 50)
- Images not compressed
- Missing cache headers
- No content delivery network (CDN)

**Score Calculation**:
```
eco_score = (
  max(0, 1.0 - (avg_page_weight / 3.0)) × 0.40
  + max(0, 1.0 - (requests / 100)) × 0.30
  + (compression_ratio) × 0.20
  + (cdn_usage ? 1.0 : 0.5) × 0.10
) × 100
```

---

#### **8. RGPD & Conformité (GDPR & Legal Compliance)**
**ID**: `rgpd` | **Icon**: rgpd

**Purpose**: Ensure compliance with GDPR/RGPD regulations and legal requirements.

**Sub-Axes**:
- Privacy policy presence & completeness
- Cookie consent management (CMP)
- Data processing disclosure
- User rights procedures (RGPD Article 15-22)
- Data retention policies
- DPO (Data Protection Officer) contact
- Legal notices & mentions
- Security measures documentation

**KPIs Measured**:
- Privacy policy present (bool) + HTML format (bool)
- CMP/cookie consent present (bool)
- Legal mentions completeness (%)
- Data retention policy documented (bool)
- DPO contact available (bool)
- https enabled (bool)
- Security measures documented (bool)

**Typical Findings**:
- No cookie consent banner (critical)
- Privacy policy only in PDF, not HTML
- Incomplete legal mentions (missing editor, hoster, DPO)
- No RGPD rights exercise procedure
- No data retention duration specified
- Missing DPO contact

**Score Calculation**:
```
rgpd_score = (
  (privacy_policy_found ? 1.0 : 0.0) × 0.25
  + (cmp_present ? 1.0 : 0.0) × 0.30
  + (legal_mentions_complete ? 1.0 : 0.5) × 0.20
  + (rgpd_procedure_available ? 1.0 : 0.0) × 0.15
  + (https_enabled ? 1.0 : 0.0) × 0.10
) × 100
```

---

#### **9. Check Sécurité (Security Audit)**
**ID**: `security` | **Icon**: security

**Purpose**: Identify security vulnerabilities, misconfigurations, and attack vectors.

**Sub-Axes**:
- Injection attacks (SQL, NoSQL, LDAP, XPath)
- Cross-Site Scripting (XSS)
- Broken authentication
- Sensitive data exposure
- XML External Entities (XXE)
- Broken access control
- Security misconfiguration (headers, SSL/TLS)
- DDoS vulnerability indicators
- Dependency vulnerabilities

**KPIs Measured**:
- SQLi vulnerable endpoints
- XSS vulnerable endpoints
- DDoS signal count
- HTTPS/TLS version
- Security headers (CSP, X-Frame-Options, etc.)
- Cookie security (HttpOnly, Secure, SameSite)
- Vulnerable dependencies count
- Affected page count

**Typical Findings**:
- SQL injection vulnerabilities detected
- XSS payload injection possible
- Missing security headers
- DDoS signal patterns found
- Weak SSL/TLS configuration
- Insecure cookies (missing HttpOnly)
- Outdated dependencies

**Score Calculation**:
```
security_score = (
  1.0 - (sqli_vulnerable_count + xss_vulnerable_count) / total_endpoints × 0.40
  - (ddos_signal_count > 0 ? 0.20 : 0.0)
  + (security_headers_count / max_headers) × 0.20
  + (https_valid ? 1.0 : 0.0) × 0.20
) × 100
```

---

### Score Aggregation to Global Score

```
global_score = (
  functional_score × 0.12
  + accessibility_score × 0.12
  + performance_score × 0.18
  + seo_score × 0.15
  + content_score × 0.10
  + ux_ui_score × 0.15
  + eco_score × 0.10
  + rgpd_score × 0.05
  + security_score × 0.03
)
```

**Maturity Levels** (based on global_score):
- 0-20: Critique
- 20-40: Problématique
- 40-60: En développement
- 60-80: Bon
- 80-100: Excellente

**Risk Levels**:
- Critical: score < 30
- High: 30-50
- Medium: 50-70
- Low: > 70

---

## Integration Patterns

### Frontend ↔ Backend Data Contract

#### **Scan Initiation**
```json
POST /aggregator/scan
{
  "url": "https://example.com",
  "max_depth": 2,
  "max_pages": 50,
  "parallelism": 4,
  "headless_concurrency": 8
}

Response: {
  "scan_id": "scan_1712577600000_abc",
  "status": "scanning",
  "started_at": 1712577600
}
```

#### **Status Polling**
```json
GET /aggregator/status/scan_1712577600000_abc

Response: {
  "scan_id": "scan_1712577600000_abc",
  "status": "processing",
  "progress_pct": 65,
  "current_page_count": 32,
  "total_pages": 50,
  "phases": {
    "crawl": "complete",
    "nlp": "processing",
    "visual_regression": "pending"
  },
  "error": null
}
```

#### **Report Retrieval**
```json
GET /aggregator/report/scan_1712577600000_abc

Response: {
  "scan_id": "scan_1712577600000_abc",
  "domain": "example.com",
  "global_score": 68,
  "risk_level": "medium",
  "axes": {
    "functional": { "score": 75, "maxScore": 100, ... },
    "accessibility": { "score": 62, "maxScore": 100, ... },
    ... [all 9 axes]
  },
  "summary": {
    "total": 42,
    "bugs": 15,
    "recommendations": 20,
    "compliance": 7,
    "critical": 3,
    "high": 8,
    "medium": 15,
    "low": 16
  },
  "quick_wins": [ { "id", "title", "type", "severity", ... } ],
  "bugs": [...],
  "recommendations": [...],
  "compliance": [...],
  "roadmap": {
    "immediate": [...],
    "this_sprint": [...],
    "this_quarter": [...],
    "backlog": [...]
  },
  "passing_kpis": [
    {
      "id": "perf_lcp",
      "label": "Largest Contentful Paint",
      "observed_value": "1.8s",
      "status": "pass",
      "evidence": [...]
    }
  ],
  "generated_at": "2026-04-07T10:30:45Z"
}
```

### Service-to-Service Communication

```
Frontend (React)
    ↓ (HTTP/HTTPS)
Supabase Auth
    ↓
Aggregator API (Port 8080)
    ├─→ Scanner API (Port 8081) — spawn crawl jobs
    ├─→ NLP Worker — async polling (no direct call)
    ├─→ Visual Regression (Port 8083) — compute UX metrics
    └─→ PostgreSQL DB — persist/query results

NLP Worker (autonomous)
    ├─→ PostgreSQL — pollscan_pages WHERE nlp_results IS NULL
    └─→ Updates scan_pages.nlp_results when complete
```

### Async Task Coordination

**Pattern**: Database-driven coordination via status flags

1. **initiate_scan()** → Creates scan_id, inserts empty scan_summaries row
2. **scanner.run()** → Crawls, populates scan_pages + aggregates to scan_summaries
3. **nlp_worker.poll()** → Detects null nlp_results, processes, updates
4. **aggregator.wait()** → Polls until all fields populated
5. **aggregator.build_report()** → Reads completed data
6. **aggregator.return_report()** → Frontend receives via GET /report/:scan_id

---

## Development Workflow

### Frontend Development
```bash
cd Front-Snap
npm install
npm run dev      # Vite dev server (hot reload)
npm run lint     # ESLint check
npm run test     # Vitest
npm run build    # Production build
```

### Backend Microservices
```bash
# Scanner (Go)
cd V3-Microservices/v3-scanner-go
go build -o scanner
./scanner

# Aggregator (Python)
cd V3-Microservices/v3-aggregator
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080

# Infrastructure
docker-compose up -d
docker-compose logs -f
```

### CLI Usage
```bash
# Interactive menu
snapflow

# Direct commands
snapflow scan https://example.com --watch
snapflow monitor
snapflow build
snapflow deploy --token <pinggy-token>
```

---

## Key Takeaways

1. **Architecture**: Microservices with autonomous NLP worker, orchestrated by Aggregator
2. **Data Pipeline**: Pages → Metrics → NLP → VRT → KPI Building → Report
3. **9 Axes**: Comprehensive framework covering Functional, Accessibility, Performance, SEO, Content, UX/UI, Eco, RGPD, Security
4. **Frontend**: Modern React SPA with Supabase integration
5. **Database**: PostgreSQL with JSONB for flexible schema
6. **Deployment**: Docker Compose for local, CLI for manual, Azure scripts available
7. **KPI Framework**: Multi-tiered (Tier 1 Go metrics, Tier 2 aggregation, Tier 3 NLP + VRT)
8. **User Preference**: Passing KPIs exclude risk wording (per preference in user memory)

---

## References

- **Frontend**: [Front-Snap/package.json](../Front-Snap/package.json)
- **Database**: [V3-Microservices/db/init.sql](../V3-Microservices/db/init.sql)
- **Docker**: [V3-Microservices/docker-compose.yml](../V3-Microservices/docker-compose.yml)
- **VRT Framework**: [v3-visual-regression/PHASE_5_KPI_AXIS_MAPPING.md](../V3-Microservices/v3-visual-regression/PHASE_5_KPI_AXIS_MAPPING.md)
- **CLI**: [v3-cli/README.md](../V3-Microservices/v3-cli/README.md)

---

**Document Generated**: 2026-04-07 by Codebase Analysis Tool
