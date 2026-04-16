
ALTER TABLE public.report_schedules 
  ALTER COLUMN start_date TYPE timestamp with time zone USING start_date::timestamp with time zone,
  ALTER COLUMN start_date SET DEFAULT now();

ALTER TABLE public.report_schedules 
  ALTER COLUMN end_date TYPE timestamp with time zone USING end_date::timestamp with time zone;
