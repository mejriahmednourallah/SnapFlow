import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));

const statusBadgeSource = readFileSync(resolve(currentDir, '../components/form-tester/StatusBadge.tsx'), 'utf8');
const workflowListSource = readFileSync(resolve(currentDir, '../components/form-tester/WorkflowList.tsx'), 'utf8');

describe('form tester status labels', () => {
  it('shows the approved workflow state as Accepté without renaming internal statuses', () => {
    expect(statusBadgeSource).toContain("approved: { label: 'Accepté'");
    expect(workflowListSource).toContain('<option value="approved">Accepté</option>');
    expect(statusBadgeSource).not.toContain("label: 'Approuve'");
  });
});
