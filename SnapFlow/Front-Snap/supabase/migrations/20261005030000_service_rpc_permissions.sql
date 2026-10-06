-- Cloud default privileges gave anon/authenticated explicit EXECUTE grants.
-- Revoking only PUBLIC in the original migrations did not remove those grants.
-- These RPCs are called by authorized Edge handlers using service_role.
DO $$
DECLARE signature text;
BEGIN
  FOR signature IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY[
      'form_test_build_scenario_snapshot', 'form_test_create_scenario_version',
      'form_test_clone_scenario_case', 'form_test_apply_generated_suite',
      'form_test_create_workflow', 'form_test_schedule_next_run',
      'form_test_create_schedule', 'form_test_enqueue_schedule_run',
      'form_test_refresh_schedule_snapshot', 'form_test_dispatch_due_schedules',
      'form_test_enqueue_manual_execution', 'form_test_launch_campaign',
      'form_test_refresh_campaign', 'form_test_select_campaign_reference',
      'form_test_launch_campaign_v2'
    ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', signature);
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
