package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	_ "github.com/lib/pq"
)

var conn *sql.DB

type FormFuzzResultRecord struct {
	ScanID        string
	PageURL       string
	ActionURL     string
	FormID        string
	TestType      string
	Payload       map[string]string
	ResponseType  string
	StatusCode    int
	Anomaly       bool
	AnomalyReason string
	DurationMS    int64
	Error         string
}

// Connect establishes a connection to PostgreSQL, retrying until available.
func Connect() error {
	host := getEnv("DB_HOST", "localhost")
	port := getEnv("DB_PORT", "5432")
	name := getEnv("DB_NAME", "snapflow_v3")
	user := getEnv("DB_USER", "snapflow")
	pass := getEnv("DB_PASS", "snapflow")
	// [D-2] sslmode is now configurable; default is "disable" for local/Docker,
	// set DB_SSL_MODE=require for Azure PostgreSQL Flexible Server.
	sslMode := getEnv("DB_SSL_MODE", "disable")

	dsn := fmt.Sprintf("host=%s port=%s dbname=%s user=%s password=%s sslmode=%s",
		host, port, name, user, pass, sslMode)

	var err error
	for i := 0; i < 15; i++ {
		conn, err = sql.Open("postgres", dsn)
		if err == nil {
			err = conn.Ping()
			if err == nil {
				log.Printf("✅ Connected to PostgreSQL at %s:%s/%s", host, port, name)
				conn.SetMaxOpenConns(10)
				conn.SetMaxIdleConns(5)
				if err := ensureScanPagesHTMLColumns(); err != nil {
					log.Printf("⚠ Could not ensure scan_pages raw/rendered HTML columns: %v", err)
				}
				if err := ensureTelemetryColumn(); err != nil {
					log.Printf("⚠ Could not ensure scan_telemetry column: %v", err)
				}
				if err := ensureFormFuzzerArtifacts(); err != nil {
					log.Printf("⚠ Could not ensure form-fuzzer DB artifacts: %v", err)
				}
				return nil
			}
		}
		log.Printf("⏳ Waiting for database... (%d/15)", i+1)
		time.Sleep(2 * time.Second)
	}
	return fmt.Errorf("could not connect to database after 15 attempts: %v", err)
}

func ensureScanPagesHTMLColumns() error {
	if conn == nil {
		return nil
	}
	if _, err := conn.Exec(`
		ALTER TABLE scan_pages
		ADD COLUMN IF NOT EXISTS raw_html TEXT
	`); err != nil {
		return err
	}
	if _, err := conn.Exec(`
		ALTER TABLE scan_pages
		ADD COLUMN IF NOT EXISTS rendered_html TEXT
	`); err != nil {
		return err
	}
	_, err := conn.Exec(`
		UPDATE scan_pages
		SET raw_html = html
		WHERE raw_html IS NULL AND html IS NOT NULL
	`)
	return err
}

func ensureTelemetryColumn() error {
	if conn == nil {
		return nil
	}
	_, err := conn.Exec(`
		ALTER TABLE scan_summaries
		ADD COLUMN IF NOT EXISTS scan_telemetry JSONB DEFAULT NULL
	`)
	return err
}

func ensureFormFuzzerArtifacts() error {
	if conn == nil {
		return nil
	}
	if _, err := conn.Exec(`
		CREATE TABLE IF NOT EXISTS form_fuzz_results (
			id BIGSERIAL PRIMARY KEY,
			scan_id VARCHAR(64) NOT NULL,
			page_url TEXT NOT NULL,
			action_url TEXT NOT NULL,
			form_id TEXT NOT NULL,
			test_type VARCHAR(32) NOT NULL,
			payload JSONB DEFAULT '{}'::jsonb,
			response_type VARCHAR(32) DEFAULT 'error',
			status_code INTEGER DEFAULT 0,
			anomaly BOOLEAN DEFAULT FALSE,
			anomaly_reason TEXT,
			duration_ms BIGINT DEFAULT 0,
			error TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`); err != nil {
		return err
	}
	if _, err := conn.Exec(`
		CREATE INDEX IF NOT EXISTS idx_form_fuzz_scan
		ON form_fuzz_results (scan_id, page_url, form_id, test_type, created_at)
	`); err != nil {
		return err
	}
	_, err := conn.Exec(`
		ALTER TABLE scan_summaries
		ADD COLUMN IF NOT EXISTS form_fuzzer_summary JSONB DEFAULT NULL
	`)
	return err
}

// InsertPage upserts a single scanned page into the database.
func InsertPage(scanID, domain, pageURL, html string, metrics interface{}) error {
	if conn == nil {
		return nil // DB not configured, skip silently
	}

	metricsJSON, err := json.Marshal(metrics)
	if err != nil {
		return fmt.Errorf("failed to marshal metrics: %v", err)
	}

	_, err = conn.Exec(`
		INSERT INTO scan_pages (scan_id, domain, url, html, raw_html, metrics)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (scan_id, url)
		DO UPDATE SET
			html = EXCLUDED.html,
			raw_html = EXCLUDED.raw_html,
			metrics = EXCLUDED.metrics
	`, scanID, domain, pageURL, html, html, string(metricsJSON))

	return err
}

// InsertSummary upserts the domain-level KPIs into the scan_summaries table.
func InsertSummary(scanID, domain string, secRes, techRes, privRes, funcRes interface{}) error {
	if conn == nil {
		return nil // DB not configured
	}

	secJSON, _ := json.Marshal(secRes)
	techJSON, _ := json.Marshal(techRes)
	privJSON, _ := json.Marshal(privRes)
	funcJSON, _ := json.Marshal(funcRes)

	_, err := conn.Exec(`
		INSERT INTO scan_summaries (scan_id, domain, domain_security, domain_tech, domain_privacy, domain_functional)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (scan_id)
		DO UPDATE SET 
			domain_security = EXCLUDED.domain_security,
			domain_tech = EXCLUDED.domain_tech,
			domain_privacy = EXCLUDED.domain_privacy,
			domain_functional = EXCLUDED.domain_functional
	`, scanID, domain, string(secJSON), string(techJSON), string(privJSON), string(funcJSON))

	if err != nil {
		return fmt.Errorf("failed to insert scan summary: %v", err)
	}
	return nil
}

// UpdateSEOKPIExtended stores Phase K site-wide SEO aggregations in scan_summaries.
// Safe to call even when DB is nil (no-op).
func UpdateSEOKPIExtended(scanID string, kpi interface{}) error {
	if conn == nil {
		return nil
	}
	data, err := json.Marshal(kpi)
	if err != nil {
		return fmt.Errorf("failed to marshal seo_kpi_extended: %v", err)
	}
	_, err = conn.Exec(`
		UPDATE scan_summaries
		SET seo_kpi_extended = COALESCE(seo_kpi_extended::jsonb, '{}'::jsonb) || $1::jsonb
		WHERE scan_id = $2
	`, string(data), scanID)
	return err
}

// UpdateBrokenLinks stores the broken link summary for a scan in scan_summaries.
// Safe to call even when DB is nil (no-op).
func UpdateBrokenLinks(scanID string, summary interface{}) error {
	if conn == nil {
		return nil
	}
	data, err := json.Marshal(summary)
	if err != nil {
		return fmt.Errorf("failed to marshal broken_links_summary: %v", err)
	}
	_, err = conn.Exec(`
		UPDATE scan_summaries SET broken_links_summary = $1 WHERE scan_id = $2
	`, string(data), scanID)
	return err
}

// UpdateImageCompression stores the image compression stats for a scan in scan_summaries.
// Safe to call even when DB is nil (no-op).
func UpdateImageCompression(scanID string, stats interface{}) error {
	if conn == nil {
		return nil
	}
	data, err := json.Marshal(stats)
	if err != nil {
		return fmt.Errorf("failed to marshal image_compression: %v", err)
	}
	_, err = conn.Exec(`
		UPDATE scan_summaries SET image_compression = $1 WHERE scan_id = $2
	`, string(data), scanID)
	return err
}

// UpdateTelemetry stores scan telemetry details in scan_summaries.
// Safe to call even when DB is nil (no-op).
func UpdateTelemetry(scanID string, telemetry interface{}) error {
	if conn == nil {
		return nil
	}
	data, err := json.Marshal(telemetry)
	if err != nil {
		return fmt.Errorf("failed to marshal scan_telemetry: %v", err)
	}
	_, err = conn.Exec(`
		UPDATE scan_summaries SET scan_telemetry = $1 WHERE scan_id = $2
	`, string(data), scanID)
	return err
}

// InsertFormFuzzResults stores per-test form-fuzzer records in a dedicated table.
// Safe to call even when DB is nil (no-op).
func InsertFormFuzzResults(records []FormFuzzResultRecord) error {
	if conn == nil || len(records) == 0 {
		return nil
	}

	tx, err := conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO form_fuzz_results (
			scan_id, page_url, action_url, form_id, test_type,
			payload, response_type, status_code, anomaly,
			anomaly_reason, duration_ms, error
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, r := range records {
		payloadJSON, err := json.Marshal(r.Payload)
		if err != nil {
			return fmt.Errorf("failed to marshal form-fuzzer payload: %v", err)
		}
		if _, err := stmt.Exec(
			r.ScanID,
			r.PageURL,
			r.ActionURL,
			r.FormID,
			r.TestType,
			string(payloadJSON),
			r.ResponseType,
			r.StatusCode,
			r.Anomaly,
			r.AnomalyReason,
			r.DurationMS,
			r.Error,
		); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// UpdateFormFuzzerSummary stores compact form-fuzzer counters in scan_summaries.
// Safe to call even when DB is nil (no-op).
func UpdateFormFuzzerSummary(scanID string, summary interface{}) error {
	if conn == nil {
		return nil
	}
	data, err := json.Marshal(summary)
	if err != nil {
		return fmt.Errorf("failed to marshal form_fuzzer_summary: %v", err)
	}
	_, err = conn.Exec(`
		UPDATE scan_summaries SET form_fuzzer_summary = $1 WHERE scan_id = $2
	`, string(data), scanID)
	return err
}

// MergePageMetrics fetches the existing metrics JSON for a page, merges in the
// given extra keys (top-level), and writes the result back.  If the page row
// does not yet exist (race between headless analysis and InsertPage), the merge
// is retried once after a short delay.  Safe to call even when DB is nil (no-op).
func MergePageMetrics(scanID, pageURL string, extra map[string]interface{}) error {
	if conn == nil {
		return nil
	}

	var metricsText string
	err := conn.QueryRow(
		`SELECT metrics FROM scan_pages WHERE scan_id = $1 AND url = $2`,
		scanID, pageURL,
	).Scan(&metricsText)
	if err != nil {
		// [D-1] Row may not exist yet due to async InsertPage race.
		// Wait briefly then retry once rather than silently dropping the data.
		time.Sleep(200 * time.Millisecond)
		err2 := conn.QueryRow(
			`SELECT metrics FROM scan_pages WHERE scan_id = $1 AND url = $2`,
			scanID, pageURL,
		).Scan(&metricsText)
		if err2 != nil {
			// Row still absent after retry — skip gracefully.
			return nil
		}
	}

	var existing map[string]interface{}
	if metricsText != "" {
		if err2 := json.Unmarshal([]byte(metricsText), &existing); err2 != nil {
			existing = map[string]interface{}{}
		}
	} else {
		existing = map[string]interface{}{}
	}

	for k, v := range extra {
		existing[k] = v
	}

	merged, err := json.Marshal(existing)
	if err != nil {
		return fmt.Errorf("failed to marshal merged metrics: %v", err)
	}

	_, err = conn.Exec(
		`UPDATE scan_pages SET metrics = $1 WHERE scan_id = $2 AND url = $3`,
		string(merged), scanID, pageURL,
	)
	return err
}

// UpdatePageHTML stores hydrated DOM HTML separately while preserving raw HTTP HTML.
// html is still updated for backward compatibility with consumers that read only html.
func UpdatePageHTML(scanID, pageURL, html string) error {
	if conn == nil {
		return nil
	}
	_, err := conn.Exec(`
		UPDATE scan_pages
		SET rendered_html = $1, html = $1
		WHERE scan_id = $2 AND url = $3
	`, html, scanID, pageURL)
	return err
}

// Close closes the database connection.
func Close() {
	if conn != nil {
		conn.Close()
	}
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
