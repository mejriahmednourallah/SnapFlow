-- Repair obvious legacy rows created by the old static parser when it read
-- unquoted HTML attributes as boolean "true" values.

UPDATE public.workflow_form_fields
SET field_type = CASE
  WHEN lower(coalesce(field_name, '') || ' ' || coalesce(field_label, '') || ' ' || coalesce(placeholder, '')) ~ 'mail'
    THEN 'email'
  WHEN lower(coalesce(field_name, '') || ' ' || coalesce(field_label, '') || ' ' || coalesce(placeholder, '')) ~ 'tel|phone|mobile'
    THEN 'tel'
  WHEN lower(coalesce(field_name, '') || ' ' || coalesce(field_label, '') || ' ' || coalesce(placeholder, '')) ~ 'delivery|time|heure'
    THEN 'time'
  ELSE 'text'
END
WHERE lower(field_type) = 'true';
