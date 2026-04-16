-- Add is_scanning and current_scan_id columns if they don't exist yet
-- (these may have been added manually; this migration is idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'report_schedules' AND column_name = 'is_scanning'
  ) THEN
    ALTER TABLE report_schedules ADD COLUMN is_scanning BOOLEAN NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'report_schedules' AND column_name = 'current_scan_id'
  ) THEN
    ALTER TABLE report_schedules ADD COLUMN current_scan_id TEXT;
  END IF;
END $$;
