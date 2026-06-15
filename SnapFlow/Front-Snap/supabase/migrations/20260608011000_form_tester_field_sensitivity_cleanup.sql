-- Form Tester field sensitivity should protect secrets, not block normal test inputs.
-- Email, phone, textarea, checkbox and radio fields can be filled with fictitious
-- test data. Their values may still be masked in execution logs by the executor.

UPDATE public.workflow_form_fields
SET is_sensitive = false
WHERE lower(field_type) IN ('email', 'tel', 'textarea', 'checkbox', 'radio')
  AND is_sensitive = true;

UPDATE public.workflow_form_fields
SET is_sensitive = true
WHERE lower(field_type) = 'password'
   OR lower(coalesce(field_name, '') || ' ' || coalesce(field_label, '')) ~
      '(password|passwd|mot.?de.?passe|token|secret|api.?key)';

COMMENT ON COLUMN public.workflow_form_fields.is_sensitive IS
  'Marks secret-like fields for masking. It must not prevent operators from entering fictitious test values.';
