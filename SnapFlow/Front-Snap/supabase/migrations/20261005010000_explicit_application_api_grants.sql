-- New Supabase databases no longer grant CRUD to API roles automatically.
-- Make the application's existing API/RLS contract explicit. Keep future
-- tables private until their migrations add their own grants and policies.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.activity_reports, public.app_settings, public.audits, public.clients,
  public.form_scenario_versions, public.form_test_campaigns,
  public.form_test_scenarios, public.form_workflows, public.notifications,
  public.profiles, public.project_assignments, public.project_perimeter_blocks,
  public.projects, public.redmine_auth_events, public.redmine_login_attempts,
  public.redmine_project_account_cache, public.redmine_role_mappings,
  public.redmine_user_identities, public.report_schedules, public.trial_usage,
  public.user_roles, public.workflow_artifacts, public.workflow_edges,
  public.workflow_execution_commands, public.workflow_form_fields,
  public.workflow_logs, public.workflow_nodes, public.workflow_results,
  public.workflow_schedule_runs, public.workflow_schedules,
  public.workflow_step_results
TO service_role;

-- Authenticated CRUD is still constrained by each table's existing RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.activity_reports, public.app_settings, public.audits, public.clients,
  public.form_scenario_versions, public.form_test_scenarios,
  public.form_workflows, public.notifications, public.profiles,
  public.project_assignments, public.project_perimeter_blocks, public.projects,
  public.redmine_role_mappings, public.redmine_user_identities,
  public.report_schedules, public.user_roles, public.workflow_edges,
  public.workflow_form_fields, public.workflow_nodes, public.workflow_schedules
TO authenticated;

GRANT SELECT ON TABLE
  public.form_test_campaigns, public.redmine_auth_events,
  public.workflow_artifacts, public.workflow_execution_commands,
  public.workflow_logs, public.workflow_schedule_runs, public.workflow_step_results
TO authenticated;
GRANT SELECT, INSERT ON TABLE public.workflow_results TO authenticated;

-- This is the one intentionally public table in the existing trial flow.
GRANT SELECT, INSERT ON TABLE public.trial_usage TO anon, authenticated;

-- Do not grant API access to trigger functions or service-only RPCs, and do
-- not change their existing ACLs. All current table keys are UUIDs, not sequences.
NOTIFY pgrst, 'reload schema';
