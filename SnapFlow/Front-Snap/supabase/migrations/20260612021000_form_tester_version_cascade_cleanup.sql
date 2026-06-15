-- Keep approved snapshots immutable while allowing their parent workflow to be
-- deleted. A direct delete remains blocked as long as the parent exists.

CREATE OR REPLACE FUNCTION public.form_test_guard_scenario_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'approved' THEN
    IF EXISTS (
      SELECT 1
      FROM public.form_workflows workflow
      WHERE workflow.id = OLD.workflow_id
    ) THEN
      RAISE EXCEPTION 'Approved scenario versions are immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Approved scenario versions are immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'approved' THEN
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'approved_by is required';
    END IF;

    IF NEW.approved_by = NEW.created_by
       AND NOT public.has_role(NEW.approved_by, 'admin') THEN
      RAISE EXCEPTION 'A client cannot approve their own scenario version';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
