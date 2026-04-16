-- Add dedicated redmine_url column to projects table
-- This separates the actual site URL (url) from the Redmine project URL (redmine_url)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS redmine_url text;
