export type WorkflowStatus = 'draft' | 'needs_review' | 'pending' | 'approved' | 'executed' | 'blocked';
export type WorkflowListView = 'mine' | 'review_queue' | 'all';
export type NodeType =
  | 'trigger'
  | 'navigate'
  | 'form_fill'
  | 'fill'
  | 'select'
  | 'check'
  | 'upload'
  | 'click'
  | 'submit'
  | 'wait'
  | 'condition'
  | 'assert'
  | 'screenshot'
  | 'inspect_response';
export type RenderedNodeKind = NodeType | 'unknown';
export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'stopping'
  | 'passed'
  | 'failed'
  | 'error'
  | 'blocked'
  | 'inconclusive'
  | 'cancelled'
  | 'pass'
  | 'fail'
  | 'needs_review';
export type ExecutionSource =
  | 'pending_executor'
  | 'chromium'
  | 'obscura'
  | 'simulated_legacy'
  | 'executor_unavailable'
  | 'legacy_unknown';
export type ExecutionMode = 'full' | 'step' | 'from_step' | 'scheduled';
export type ExecutionEngine = 'chromium' | 'obscura' | 'simulated_legacy';
export type ExecutionStepStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'error'
  | 'blocked'
  | 'inconclusive'
  | 'cancelled'
  | 'skipped';
export type ScenarioVersionStatus = 'draft' | 'pending' | 'approved' | 'rejected';
export type WorkflowBranchKey = 'default' | 'success' | 'failure' | 'true' | 'false';
export type ExpectedOutcome =
  | 'success'
  | 'validation_error'
  | 'business_rejection'
  | 'server_error'
  | 'blocked';
export type ExpectedBehavior = 'accept' | 'reject' | 'explore';
export type ObservedBehavior =
  | 'accepted'
  | 'validation_rejected'
  | 'business_rejected'
  | 'technical_error'
  | 'inconclusive';
export type BusinessVerdict =
  | 'conform'
  | 'unexpected_acceptance'
  | 'unexpected_rejection'
  | 'needs_confirmation'
  | 'interrupted'
  | 'observation';
export type CampaignStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'error';
export type ScenarioGenerationSource = 'manual' | 'detected' | 'ai' | 'clone';
export type FieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'password'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'textarea'
  | 'number'
  | 'date'
  | 'time'
  | 'url'
  | 'search'
  | 'file';

export interface FormWorkflow {
  id: string;
  org_id: string;
  created_by: string;
  project_id: string | null;
  project_name?: string | null;
  name: string;
  target_url: string;
  status: WorkflowStatus;
  approved_by: string | null;
  approval_note: string | null;
  rejection_note: string | null;
  detected_at: string | null;
  approved_at: string | null;
  executed_at: string | null;
  detection_sources: string[];
  confidence: 'high' | 'medium' | 'low';
  risk_flags: string[];
  blocked_reason: string | null;
  detection_evidence: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WorkflowNode {
  id: string;
  workflow_id: string;
  scenario_id: string;
  type: NodeType;
  order_index: number;
  position_x: number;
  position_y: number;
  config: NodeConfig;
  created_at: string;
}

export type NodeConfig = TriggerConfig | FormFillConfig | SubmitConfig | AssertConfig | Record<string, unknown>;

export interface TriggerConfig {
  url: string;
}

export interface FormFillConfig {
  field_id: string;
}

export interface SubmitConfig {
  selector: string;
  wait_for: string;
}

export interface AssertConfig {
  type: 'url_contains' | 'element_present' | 'text_present';
  value: string;
  label: string;
}

export interface WorkflowFormField {
  id: string;
  node_id: string;
  workflow_id: string;
  scenario_id: string;
  field_name: string;
  field_type: FieldType;
  field_label: string | null;
  field_selector: string;
  placeholder: string | null;
  required: boolean;
  ai_suggestion: string | null;
  user_value: string | null;
  is_sensitive: boolean;
  created_at: string;
}

export interface AssertionResult {
  label: string;
  expected: string;
  actual: string;
  passed: boolean;
}

export interface WorkflowResult {
  id: string;
  workflow_id: string;
  scenario_id: string | null;
  scenario_version_id: string | null;
  executed_by: string | null;
  executed_at: string;
  status: ExecutionStatus;
  duration_ms: number | null;
  assertions: AssertionResult[];
  screenshot_url: string | null;
  error_message: string | null;
  audit_run_id: string | null;
  step_trace: Array<Record<string, unknown>>;
  final_url: string | null;
  network_summary: Record<string, unknown>;
  execution_source: ExecutionSource;
  execution_mode: ExecutionMode;
  execution_engine: ExecutionEngine;
  environment: string;
  start_node_id: string | null;
  current_node_id: string | null;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  stopped_at: string | null;
  heartbeat_at: string | null;
  requested_by: string | null;
  failure_reason: string | null;
  summary: Record<string, unknown>;
  progress_completed: number;
  progress_total: number;
  queue_wait_ms?: number | null;
  execution_duration_ms?: number | null;
  total_elapsed_ms?: number | null;
  campaign_id?: string | null;
  campaign_role?: 'baseline' | 'case' | null;
  depends_on_execution_id?: string | null;
  evaluation_mode?: 'baseline_comparison' | 'explicit_oracle' | 'exploratory' | null;
  scenario?: Pick<
    FormTestScenario,
    'id' | 'name' | 'description' | 'expected_outcome' | 'case_definition'
  > | null;
}

export type WorkflowScheduleFrequency = 'once' | 'daily' | 'weekly' | 'monthly';

export interface WorkflowSchedule {
  id: string;
  workflow_id: string;
  scenario_id: string;
  scenario_version_id: string;
  org_id: string;
  created_by: string;
  name: string;
  frequency: WorkflowScheduleFrequency;
  timezone: string;
  start_at: string;
  local_time: string;
  day_of_week: number | null;
  day_of_month: number | null;
  next_run_at: string | null;
  last_run_at: string | null;
  end_at: string | null;
  is_active: boolean;
  environment: string;
  overlap_policy: 'queue';
  last_error: string | null;
  created_at: string;
  updated_at: string;
  form_scenario_versions?: {
    version_number: number;
    checksum: string;
  } | null;
  form_workflows?: {
    name: string;
    target_url: string;
  } | null;
}

export interface WorkflowScheduleRun {
  id: string;
  schedule_id: string;
  scheduled_for: string;
  execution_id: string | null;
  status: 'queued' | 'dispatched' | 'completed' | 'error' | 'skipped';
  error_message: string | null;
  created_at: string;
  dispatched_at: string | null;
  completed_at: string | null;
}

export interface FormTesterAiStatus {
  provider: 'gemini';
  model: string;
  configured: boolean;
  available: boolean;
  fallback: 'heuristic';
  error: string | null;
}

export interface WorkflowStepResult {
  id: string;
  execution_id: string;
  node_id: string | null;
  sequence_number: number;
  step_type: string;
  status: ExecutionStepStatus;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  input_redacted: Record<string, unknown>;
  output_redacted: Record<string, unknown>;
  assertions: AssertionResult[];
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
  created_at: string;
  // CAPTCHA fields (V1 — 2Captcha integration)
  captcha_detected: boolean;
  captcha_type: string | null;
  captcha_solved: boolean;
  captcha_solve_duration_ms: number | null;
  captcha_solve_cost: number | null;
}

export interface WorkflowExecutionLog {
  id: string;
  execution_id: string;
  step_result_id: string | null;
  level: 'debug' | 'info' | 'warning' | 'error';
  event_type: string;
  message: string;
  details_redacted: Record<string, unknown>;
  created_at: string;
}

export interface WorkflowArtifact {
  id: string;
  execution_id: string;
  step_result_id: string | null;
  artifact_type: 'screenshot' | 'html_snapshot' | 'network_response' | 'uploaded_fixture' | 'downloaded_file';
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  redaction_status: 'pending' | 'redacted' | 'not_required' | 'failed';
  metadata_redacted: Record<string, unknown>;
  signed_url?: string | null;
  signed_path?: string | null;
  previewable?: boolean;
  upload_status?: 'available' | 'failed' | 'local_only';
  storage_backend?: 'supabase' | 'local';
  created_at: string;
}

export interface NodePositionUpdate {
  node_id: string;
  position_x: number;
  position_y: number;
}

export interface NodeInspectorState {
  nodeId: string | null;
  tab: 'configuration' | 'assistant' | 'execution';
}

export interface LiveExecutionPreview {
  executionId: string | null;
  currentNodeId: string | null;
  progressCompleted: number;
  progressTotal: number;
  latestScreenshotUrl: string | null;
  latestLogMessage: string | null;
}

export interface WorkflowExecutionCommand {
  id: string;
  execution_id: string;
  command: 'stop' | 'retry' | 'run_step' | 'run_from';
  node_id: string | null;
  status: 'pending' | 'processing' | 'completed' | 'rejected' | 'failed';
  requested_by: string;
  payload_redacted: Record<string, unknown>;
  requested_at: string;
  processed_at: string | null;
}

export interface WorkflowExecutionDetail extends WorkflowResult {
  steps: WorkflowStepResult[];
  logs: WorkflowExecutionLog[];
  artifacts: WorkflowArtifact[];
  commands: WorkflowExecutionCommand[];
}

export interface WorkflowNodeWithFields extends WorkflowNode {
  field: WorkflowFormField | null;
}

export interface WorkflowEdge {
  id: string;
  workflow_id: string;
  scenario_id: string;
  source_node_id: string;
  target_node_id: string;
  branch_key: WorkflowBranchKey;
  created_at: string;
}

export interface WorkflowWithDetails extends FormWorkflow {
  active_scenario: FormTestScenario;
  scenarios: FormTestScenario[];
  scenario_versions: FormScenarioVersion[];
  nodes: WorkflowNodeWithFields[];
  edges: WorkflowEdge[];
  latest_result: WorkflowResult | null;
}

export interface WorkflowListItem extends FormWorkflow {
  latest_result: Pick<WorkflowResult, 'id' | 'status' | 'executed_at'> | null;
}

export interface DetectedField {
  name: string;
  type: FieldType;
  label: string | null;
  selector: string;
  placeholder: string | null;
  required: boolean;
  options?: Array<{ label: string; value: string }>;
  min?: string | null;
  max?: string | null;
  step?: string | null;
  pattern?: string | null;
  min_length?: number | null;
  max_length?: number | null;
  autocomplete?: string | null;
  group_name?: string | null;
  initial_value?: string | null;
  step_index?: number;
}

export type FormProfileType =
  | 'contact'
  | 'login'
  | 'search'
  | 'newsletter'
  | 'registration'
  | 'password_recovery'
  | 'upload'
  | 'appointment'
  | 'checkout_payment'
  | 'quote_request'
  | 'feedback_survey'
  | 'generic';

export interface FormIdentity {
  selector: string;
  action_url: string;
  method: string;
  form_index: number;
  field_fingerprint: string[];
  confidence: number;
}

export interface FormCandidate {
  identity: FormIdentity;
  form_type: FormProfileType;
  score: number;
  reasons: string[];
  fields_count: number;
}

export interface FormProfile {
  version: 2;
  form_type: FormProfileType;
  confidence: number;
  alternative_types: FormProfileType[];
  action_url: string;
  method: string;
  submit_selector: string;
  fields: Array<Record<string, unknown>>;
  steps: Array<Record<string, unknown>>;
  conditional_rules: Array<Record<string, unknown>>;
  success_candidates: TestCaseExpectedSignal[];
  failure_candidates: TestCaseExpectedSignal[];
  possible_side_effects: string[];
  route_compiled?: boolean;
  form_identity?: FormIdentity;
}

export interface DetectionResponse {
  success: boolean;
  detection_method?: string;
  detection_sources?: string[];
  confidence?: 'high' | 'medium' | 'low';
  risk_flags?: string[];
  blocked_reason?: string | null;
  forms_found?: number;
  fields_count?: number;
  fields?: WorkflowFormField[];
  form_profile?: FormProfile;
  form_candidates?: FormCandidate[];
  selected_form_identity?: FormIdentity | null;
  selection_required?: boolean;
  error?: string;
}

export interface FieldSuggestion {
  field_id: string;
  value: string;
  reasoning: string;
  is_sensitive: boolean;
}

export interface SuggestionResponse {
  success: boolean;
  suggestions: FieldSuggestion[];
  error?: string;
}

export interface ApprovalPayload {
  action: 'approve' | 'reject';
  note?: string;
  scenarioId?: string;
  scenarioVersionId?: string;
}

export interface ExecutionResponse {
  success: boolean;
  result_id: string;
  execution_id?: string;
  deduplicated?: boolean;
  status: ExecutionStatus;
  duration_ms: number;
  assertions: AssertionResult[];
  screenshot_url: string | null;
  step_trace: Array<Record<string, unknown>>;
  final_url: string | null;
  network_summary: Record<string, unknown>;
  execution_source: ExecutionSource;
  scenario_id: string;
  scenario_version_id: string;
  scenario_version_number: number;
  scenario_checksum: string;
  error?: string | null;
  execution: WorkflowResult;
}

export interface FormTestScenario {
  id: string;
  workflow_id: string;
  org_id: string;
  created_by: string;
  name: string;
  description: string | null;
  status: ScenarioVersionStatus;
  is_default: boolean;
  expected_outcome: ExpectedOutcome;
  source_scenario_id: string | null;
  generation_source: ScenarioGenerationSource;
  case_definition: TestCaseDefinition;
  created_at: string;
  updated_at: string;
}

export interface TestCaseFieldMutation {
  field_id: string;
  field_name?: string;
  value: string;
  reason?: string;
}

export interface TestCaseExpectedSignal {
  type:
    | 'form_invalid'
    | 'validation_message_present'
    | 'element_present'
    | 'element_absent'
    | 'response_status'
    | 'response_status_range'
    | 'url_contains'
    | 'url_changed'
    | 'dom_changed'
    | 'form_disappeared'
    | 'network_request_matching'
    | 'field_value_equals'
    | 'submission_outcome'
    | 'success_message_present'
    | 'text_present'
    | 'text_absent';
  value?: string;
  field_id?: string;
  weight?: number;
  enabled?: boolean;
}

export interface PlannedInteraction {
  type: 'click' | 'wait' | 'fill' | 'select' | 'check' | 'upload' | 'submit';
  field_id?: string;
  selector?: string;
  value?: string;
  label?: string;
  duration_ms?: number;
}

export interface OutcomeOracle {
  expected_outcome: ExpectedOutcome;
  pass_threshold: number;
  inconclusive_threshold: number;
  signals: TestCaseExpectedSignal[];
}

export interface TestCaseDefinition {
  plan_version?: number;
  form_type?: FormProfileType;
  field_mutations?: TestCaseFieldMutation[];
  expected_signals?: TestCaseExpectedSignal[];
  validation_scope?: 'field' | 'form';
  target_field_id?: string;
  target_field_name?: string;
  route_steps?: PlannedInteraction[];
  oracle?: OutcomeOracle;
  side_effects?: string[];
  purpose?: string;
  reasoning?: string;
  expected_behavior?: ExpectedBehavior;
  expectation_confidence?: number;
  suggested_severity?: 'critical' | 'high' | 'medium' | 'low';
  suggested_severity_reason?: string;
  baseline_dependent?: boolean;
  generated_at?: string;
}

export interface TestCaseSuggestion {
  id: string;
  name: string;
  description: string;
  expected_outcome: ExpectedOutcome;
  field_mutations: TestCaseFieldMutation[];
  expected_signals: TestCaseExpectedSignal[];
  validation_scope?: 'field' | 'form';
  target_field_id?: string;
  target_field_name?: string;
  compilation_error?: string;
  purpose?: string;
  form_type?: FormProfileType;
  route_steps?: PlannedInteraction[];
  oracle?: OutcomeOracle;
  side_effects?: string[];
  plan_version?: number;
  reasoning: string;
  expected_behavior?: ExpectedBehavior;
  expectation_confidence?: number;
  suggested_severity?: 'critical' | 'high' | 'medium' | 'low';
  suggested_severity_reason?: string;
  baseline_dependent?: boolean;
}

export interface FormTestCampaignSummary {
  conform: number;
  anomaly: number;
  needs_confirmation: number;
  interrupted: number;
  observation: number;
  total?: number;
}

export interface FormTestCampaign {
  id: string;
  workflow_id: string;
  org_id: string;
  created_by: string;
  baseline_scenario_id: string;
  baseline_execution_id: string | null;
  baseline_scenario_ids: string[];
  baseline_execution_ids: string[];
  reference_execution_id: string | null;
  reference_selection: {
    selected_at?: string;
    threshold?: number;
    winner_execution_id?: string;
    winner_score?: number;
    winner_conclusive?: boolean;
    candidates?: Array<{
      execution_id: string;
      scenario_id: string;
      status: string;
      score: number;
      conclusive: boolean;
      reasons?: string[];
      conflicts?: string[];
    }>;
  };
  reference_conclusive: boolean;
  name: string;
  status: CampaignStatus;
  selected_scenario_ids: string[];
  summary: FormTestCampaignSummary;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageEvidence {
  text: string;
  normalized_text?: string;
  concepts: string[];
  selector?: string;
  role?: string;
  source?: string;
}

export interface SemanticDomObservation {
  success_messages: MessageEvidence[];
  validation_messages: MessageEvidence[];
  rejection_messages: MessageEvidence[];
  invalid_controls?: Array<Record<string, unknown>>;
  form_lifecycle: 'retained' | 'reset' | 'replaced' | 'removed';
}

export interface SemanticBaselineComparison {
  reference_execution_id?: string | null;
  available: boolean;
  conclusive: boolean;
  similarity_score: number;
  matched_signals: string[];
  conflicting_signals: string[];
}

export interface FormTestAiInterpretation {
  category: ObservedBehavior;
  confidence: number;
  explanation: string;
  evidence: string[];
  provider: string;
  model: string;
  informational_only: true;
  generated_at: string;
}

export interface FormTestCampaignDetail {
  campaign: FormTestCampaign;
  executions: WorkflowExecutionDetail[];
}

export interface TestCaseSuggestionResponse {
  success: boolean;
  cases: TestCaseSuggestion[];
  provider: 'llm' | 'heuristic';
  plan_version?: number;
  form_profile?: FormProfile;
  case_count?: number;
  warnings?: string[];
  error?: string;
}

export interface FormScenarioVersion {
  id: string;
  scenario_id: string;
  workflow_id: string;
  version_number: number;
  status: ScenarioVersionStatus;
  checksum: string;
  snapshot: Record<string, unknown>;
  created_by: string;
  submitted_by: string | null;
  approved_by: string | null;
  submission_note: string | null;
  approval_note: string | null;
  rejection_note: string | null;
  created_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
}

export interface StatusBadgeProps {
  status: WorkflowStatus | ExecutionStatus;
  size?: 'sm' | 'md';
  label?: string;
}

export interface WorkflowBuilderProps {
  workflowId: string;
  isOperator: boolean;
}

export interface FieldConfigPanelProps {
  field: WorkflowFormField;
  onUpdate: (fieldId: string, value: string) => Promise<void>;
  isLoading: boolean;
}
