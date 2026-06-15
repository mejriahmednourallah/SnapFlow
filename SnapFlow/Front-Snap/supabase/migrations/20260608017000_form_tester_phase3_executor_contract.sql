-- Form Tester V1 - Phase 3 executor contract.

ALTER TABLE public.workflow_nodes
  DROP CONSTRAINT IF EXISTS workflow_nodes_type_check;

ALTER TABLE public.workflow_nodes
  ADD CONSTRAINT workflow_nodes_type_check
    CHECK (
      type IN (
        'trigger', 'form_fill', 'submit', 'assert',
        'navigate', 'fill', 'select', 'check', 'upload', 'click',
        'wait', 'condition', 'screenshot', 'inspect_response'
      )
    );

CREATE INDEX IF NOT EXISTS idx_workflow_execution_commands_execution_pending
  ON public.workflow_execution_commands(execution_id, requested_at)
  WHERE status = 'pending';

COMMENT ON COLUMN public.workflow_nodes.type IS
  'Executable V1 node type. Legacy trigger/form_fill/submit/assert remain supported.';

COMMENT ON COLUMN public.workflow_nodes.config IS
  'Versioned executor configuration. Secrets must be referenced, never persisted as clear text.';
