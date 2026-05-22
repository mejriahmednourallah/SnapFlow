export type WorkflowStatus = 'draft' | 'needs_review' | 'pending' | 'approved' | 'executed' | 'blocked';
export type NodeType = 'trigger' | 'form_fill' | 'submit' | 'assert';
export type ExecutionStatus = 'pass' | 'fail' | 'error' | 'blocked' | 'needs_review';
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
  | 'date';

export interface FormWorkflow {
  id: string;
  org_id: string;
  created_by: string;
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
  type: NodeType;
  order_index: number;
  position_x: number;
  position_y: number;
  config: NodeConfig;
  created_at: string;
}

export type NodeConfig = TriggerConfig | FormFillConfig | SubmitConfig | AssertConfig;

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
  execution_source: 'chromium';
}

export interface WorkflowNodeWithFields extends WorkflowNode {
  field: WorkflowFormField | null;
}

export interface WorkflowEdge {
  id: string;
  workflow_id: string;
  source_node_id: string;
  target_node_id: string;
  created_at: string;
}

export interface WorkflowWithDetails extends FormWorkflow {
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
}

export interface ExecutionResponse {
  success: boolean;
  result_id: string;
  status: ExecutionStatus;
  duration_ms: number;
  assertions: AssertionResult[];
  screenshot_url: string | null;
  step_trace: Array<Record<string, unknown>>;
  final_url: string | null;
  network_summary: Record<string, unknown>;
  execution_source: 'chromium';
  error?: string | null;
}

export interface StatusBadgeProps {
  status: WorkflowStatus | ExecutionStatus;
  size?: 'sm' | 'md';
}

export interface WorkflowBuilderProps {
  workflowId: string;
  isOperator: boolean;
}

export interface FieldConfigPanelProps {
  field: WorkflowFormField;
  onUpdate: (fieldId: string, value: string) => Promise<void>;
  onResuggest: (fieldId: string) => Promise<void>;
  isLoading: boolean;
}
