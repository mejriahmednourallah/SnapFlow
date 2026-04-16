
ALTER TABLE public.report_schedules
ADD COLUMN start_date date NOT NULL DEFAULT CURRENT_DATE,
ADD COLUMN end_date date NULL;
