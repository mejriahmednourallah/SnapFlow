import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const executionFunction = fs.readFileSync(
  path.join(root, 'supabase/functions/form-executions/index.ts'),
  'utf8',
);
const cleanupFunction = fs.readFileSync(
  path.join(root, 'supabase/functions/cleanup-form-test-artifacts/index.ts'),
  'utf8',
);
const workflowFunction = fs.readFileSync(
  path.join(root, 'supabase/functions/form-workflows/index.ts'),
  'utf8',
);
const executionNormalizer = fs.readFileSync(
  path.join(root, 'src/lib/form-tester/normalizeExecution.ts'),
  'utf8',
);
const executorStorage = fs.readFileSync(
  path.join(root, '../V3-Microservices/v3-form-executor/storage.py'),
  'utf8',
);
const executorSettings = fs.readFileSync(
  path.join(root, '../V3-Microservices/v3-form-executor/settings.py'),
  'utf8',
);
const executorMain = fs.readFileSync(
  path.join(root, '../V3-Microservices/v3-form-executor/main.py'),
  'utf8',
);

describe('Form Tester artifact and compilation contracts', () => {
  it('signs only available Supabase artifacts and uses a private bucket contract', () => {
    expect(executionFunction).toContain("metadata.storage_backend === 'supabase'");
    expect(executionFunction).toContain("metadata.upload_status === 'available'");
    expect(executionFunction).toContain('SIGNED_URL_TTL_SECONDS = 15 * 60');
    expect(executionFunction).toContain('createSignedUrls');
    expect(executionFunction).toContain('FORM_TESTER_PUBLIC_STORAGE_ORIGIN');
    expect(executionFunction).toContain('exposeSignedUrl');
    expect(executionFunction).toContain('signed_path');
    expect(executionNormalizer).toContain('VITE_SUPABASE_URL');
    expect(executionNormalizer).toContain("'kong'");
  });

  it('provides a 30 day artifact cleanup endpoint', () => {
    expect(cleanupFunction).toContain('RETENTION_DAYS = 30');
    expect(cleanupFunction).toContain('.remove(remotePaths)');
    expect(cleanupFunction).toContain("from('workflow_artifacts')");
  });

  it('fills required generated-case values before compilation', () => {
    expect(workflowFunction).toContain('deterministicFieldValue');
    expect(workflowFunction).toContain('valeur requise manquante');
    expect(workflowFunction).toContain("testCase.expected_outcome === 'validation_error'");
    expect(workflowFunction).toContain('inferValidationTarget');
    expect(workflowFunction).toContain("validationScope ?? 'form'");
  });

  it('uses three workers while serializing executions per target domain', () => {
    expect(executorSettings).toContain('FORM_EXECUTOR_CONCURRENCY');
    expect(executorMain).toContain('range(settings.concurrency)');
    expect(executorStorage).toContain('pg_try_advisory_xact_lock');
    expect(executorStorage).toContain('active_workflow.target_url');
  });

  it('expires local fallback artifacts using the same retention policy', () => {
    expect(executorSettings).toContain('FORM_EXECUTOR_ARTIFACT_RETENTION_DAYS');
    expect(executorStorage).toContain('cleanup_local_artifacts');
    expect(executorStorage).toContain('path.unlink()');
  });
});
