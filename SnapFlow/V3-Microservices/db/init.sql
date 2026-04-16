-- SnapFlow V3 Database Schema
-- Lightweight schema for the Go scanner to push page data into,
-- and for the NLP worker to poll and update.

CREATE TABLE IF NOT EXISTS scan_pages (
    id          SERIAL PRIMARY KEY,
    scan_id     VARCHAR(64)  NOT NULL,     -- groups pages from one scan run
    domain      VARCHAR(255) NOT NULL,
    url         TEXT         NOT NULL,
    html        TEXT,                       -- compatibility HTML used by existing readers
    raw_html    TEXT,                       -- raw HTTP HTML from crawler
    rendered_html TEXT,                     -- hydrated DOM HTML from headless renderer
    metrics     JSONB        DEFAULT '{}',  -- Tier 1+2 KPIs from Go
    nlp_results JSONB        DEFAULT NULL,  -- Tier 3 NLP results (NULL = not yet processed)
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_scan_url UNIQUE (scan_id, url)
);

-- Index for the NLP worker to quickly find unprocessed pages
CREATE INDEX IF NOT EXISTS idx_nlp_pending
    ON scan_pages (id) WHERE nlp_results IS NULL;

-- Backward-compatible upgrades for existing environments
ALTER TABLE scan_pages ADD COLUMN IF NOT EXISTS raw_html TEXT;
ALTER TABLE scan_pages ADD COLUMN IF NOT EXISTS rendered_html TEXT;
UPDATE scan_pages SET raw_html = html WHERE raw_html IS NULL AND html IS NOT NULL;

-- Index for querying by domain/scan
CREATE INDEX IF NOT EXISTS idx_scan_domain
    ON scan_pages (scan_id, domain);

-- Table to store domain-level KPIs (Security, Tech Stack, Privacy, Functional)
CREATE TABLE IF NOT EXISTS scan_summaries (
    scan_id           VARCHAR(64) PRIMARY KEY,
    domain            VARCHAR(255) NOT NULL,
    domain_security   JSONB DEFAULT '{}',
    domain_tech       JSONB DEFAULT '{}',
    domain_privacy    JSONB DEFAULT '{}',
    domain_functional JSONB DEFAULT '{}',
    image_compression    JSONB DEFAULT NULL,
    broken_links_summary JSONB DEFAULT NULL,
    seo_kpi_extended     JSONB DEFAULT NULL,
    created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add image_compression to existing tables if upgrading
ALTER TABLE scan_summaries ADD COLUMN IF NOT EXISTS image_compression JSONB DEFAULT NULL;
-- Phase J: broken links summary
ALTER TABLE scan_summaries ADD COLUMN IF NOT EXISTS broken_links_summary JSONB DEFAULT NULL;
-- Phase K: site-wide SEO KPI aggregations
ALTER TABLE scan_summaries ADD COLUMN IF NOT EXISTS seo_kpi_extended JSONB DEFAULT NULL;
-- Phase Form Fuzzer: compact per-scan summary
ALTER TABLE scan_summaries ADD COLUMN IF NOT EXISTS form_fuzzer_summary JSONB DEFAULT NULL;

-- Phase Form Fuzzer: detailed per-test records
CREATE TABLE IF NOT EXISTS form_fuzz_results (
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

CREATE INDEX IF NOT EXISTS idx_form_fuzz_scan
    ON form_fuzz_results (scan_id, page_url, form_id, test_type, created_at);

-- Phase 1: canonical KPI payload persistence (new-only mode)
CREATE TABLE IF NOT EXISTS scan_kpi_outputs (
    scan_id         VARCHAR(64) PRIMARY KEY,
    scan_url        TEXT,
    kpi_json        JSONB        NOT NULL,
    top_level_kpis  JSONB        NOT NULL DEFAULT '{}'::jsonb,
    quality_drift_artifact JSONB  NOT NULL DEFAULT '{}'::jsonb,
    updated_at      TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scan_kpi_outputs_scan_url_updated
    ON scan_kpi_outputs (scan_url, updated_at DESC);
