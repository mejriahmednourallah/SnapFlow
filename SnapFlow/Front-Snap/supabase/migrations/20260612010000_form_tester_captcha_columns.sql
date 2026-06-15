-- Form Tester V1 — CAPTCHA resolution columns (2Captcha integration)
-- Date: 2026-06-12
-- Adds captcha_detected, captcha_type, captcha_solved, captcha_solve_duration_ms, captcha_solve_cost
-- to workflow_step_results for the v3-form-executor CAPTCHA resolution flow.

ALTER TABLE public.workflow_step_results
  ADD COLUMN IF NOT EXISTS captcha_detected BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.workflow_step_results
  ADD COLUMN IF NOT EXISTS captcha_type TEXT;

ALTER TABLE public.workflow_step_results
  ADD COLUMN IF NOT EXISTS captcha_solved BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.workflow_step_results
  ADD COLUMN IF NOT EXISTS captcha_solve_duration_ms INTEGER CHECK (captcha_solve_duration_ms IS NULL OR captcha_solve_duration_ms >= 0);

ALTER TABLE public.workflow_step_results
  ADD COLUMN IF NOT EXISTS captcha_solve_cost NUMERIC(10, 6);

COMMENT ON COLUMN public.workflow_step_results.captcha_detected IS
  'True si un CAPTCHA etait present sur cette etape.';
COMMENT ON COLUMN public.workflow_step_results.captcha_type IS
  'Type de CAPTCHA detecte: recaptcha_v2, hcaptcha, turnstile, image_captcha, generic_captcha.';
COMMENT ON COLUMN public.workflow_step_results.captcha_solved IS
  'True si le CAPTCHA a ete resolu avec succes via 2Captcha.';
COMMENT ON COLUMN public.workflow_step_results.captcha_solve_duration_ms IS
  'Duree de resolution du CAPTCHA en millisecondes.';
COMMENT ON COLUMN public.workflow_step_results.captcha_solve_cost IS
  'Cout estime de la resolution 2Captcha (USD). Visible uniquement par les administrateurs.';
