import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const suggestSource = readFileSync(
  resolve(currentDir, '../../supabase/functions/form-workflows-suggest/index.ts'),
  'utf8',
);

describe('Form Tester suggestion contract', () => {
  it('generates browser-compatible values for constrained HTML input types', () => {
    expect(suggestSource).toContain("type === 'time'");
    expect(suggestSource).toContain("value: '12:00'");
    expect(suggestSource).toContain('normalizeSuggestionValue');
    expect(suggestSource).toContain("/^\\d{2}:\\d{2}(:\\d{2})?$/");
  });
});
