-- Scanner-owned observations and NLP-owned publication/claims stay separate.
ALTER TABLE scan_pages ADD COLUMN IF NOT EXISTS content_revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE scan_pages ADD COLUMN IF NOT EXISTS nlp_revision BIGINT;
ALTER TABLE scan_pages ADD COLUMN IF NOT EXISTS nlp_ready BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE scan_pages ADD COLUMN IF NOT EXISTS nlp_claim_token UUID;
ALTER TABLE scan_pages ADD COLUMN IF NOT EXISTS nlp_claim_until TIMESTAMPTZ;
UPDATE scan_pages SET nlp_revision = 1
WHERE nlp_results IS NOT NULL AND nlp_revision IS NULL AND content_revision = 1;

CREATE OR REPLACE FUNCTION snapflow_page_content_revision() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.raw_html IS DISTINCT FROM OLD.raw_html
       OR NEW.rendered_html IS DISTINCT FROM OLD.rendered_html
       OR NEW.html IS DISTINCT FROM OLD.html
       OR NEW.metrics->'rendered_discovery'->'visible_text' IS DISTINCT FROM OLD.metrics->'rendered_discovery'->'visible_text'
       OR NEW.metrics->'rendered_discovery'->'shadow_dom' IS DISTINCT FROM OLD.metrics->'rendered_discovery'->'shadow_dom'
       OR NEW.metrics->'rendered_discovery'->'raw_html' IS DISTINCT FROM OLD.metrics->'rendered_discovery'->'raw_html'
       OR NEW.metrics->'rendered_discovery'->'response_headers'->'last-modified' IS DISTINCT FROM OLD.metrics->'rendered_discovery'->'response_headers'->'last-modified'
       OR NEW.metrics->'rendered_response'->'raw_html' IS DISTINCT FROM OLD.metrics->'rendered_response'->'raw_html'
       OR NEW.metrics->'rendered_response'->'shadow_dom' IS DISTINCT FROM OLD.metrics->'rendered_response'->'shadow_dom'
       OR NEW.metrics->'rendered_response'->'response_headers'->'last-modified' IS DISTINCT FROM OLD.metrics->'rendered_response'->'response_headers'->'last-modified'
       OR NEW.metrics->'response_headers'->'last-modified' IS DISTINCT FROM OLD.metrics->'response_headers'->'last-modified' THEN
        NEW.content_revision := OLD.content_revision + 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE TRIGGER scan_pages_content_revision
BEFORE UPDATE ON scan_pages FOR EACH ROW
EXECUTE FUNCTION snapflow_page_content_revision();
CREATE INDEX IF NOT EXISTS idx_nlp_revision_pending ON scan_pages(id)
WHERE nlp_results IS NULL OR nlp_revision IS DISTINCT FROM content_revision;
CREATE INDEX IF NOT EXISTS idx_nlp_spelling_retry_pending ON scan_pages(id)
WHERE COALESCE(nlp_results#>'{spelling_scope,provider_failures}' ?| ARRAY['fr','en','ar'], FALSE)
  AND COALESCE((nlp_results->>'spelling_provider_retry_count')::int, 0) < 3;
