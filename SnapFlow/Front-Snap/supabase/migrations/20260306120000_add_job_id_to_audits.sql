-- Add job_id column to audits for async polling support
ALTER TABLE audits ADD COLUMN IF NOT EXISTS job_id TEXT;
