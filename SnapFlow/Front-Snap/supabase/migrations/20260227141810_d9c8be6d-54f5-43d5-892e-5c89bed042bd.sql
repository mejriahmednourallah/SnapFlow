
-- Add archived_at column to audits table for archiving reports
ALTER TABLE public.audits ADD COLUMN archived_at timestamp with time zone DEFAULT NULL;
