import { describe, expect, it } from 'vitest';
import {
  buildHeuristicSuite,
  dynamicCaseBudget,
  type FormProfile,
  type SuiteField,
} from '../../supabase/functions/_shared/formTestSuite';

function profile(overrides: Partial<FormProfile> = {}): FormProfile {
  return {
    version: 2,
    form_type: 'contact',
    confidence: 0.8,
    alternative_types: [],
    action_url: '/submit',
    method: 'POST',
    submit_selector: 'button[type="submit"]',
    fields: [],
    steps: [],
    conditional_rules: [],
    success_candidates: [{ type: 'text_present', value: 'Merci', weight: 0.7 }],
    failure_candidates: [],
    possible_side_effects: [],
    ...overrides,
  };
}

function field(overrides: Partial<SuiteField> = {}): SuiteField {
  return {
    id: 'field-name',
    field_name: 'name',
    field_type: 'text',
    field_label: 'Nom',
    placeholder: null,
    required: true,
    user_value: 'Valeur configuree',
    ai_suggestion: null,
    field_selector: 'input[name="name"]',
    nominal_value: 'Valeur configuree',
    ...overrides,
  };
}

describe('dynamic Form Tester suite generation', () => {
  it('always creates at least four distinct cases and preserves configured values', () => {
    const cases = buildHeuristicSuite([field()], profile());
    expect(cases.length).toBeGreaterThanOrEqual(4);
    expect(cases.length).toBeLessThanOrEqual(12);
    expect(cases[0].field_mutations[0].value).toBe('Valeur configuree');
    expect(new Set(cases.map((item) => item.name)).size).toBe(cases.length);
  });

  it('increases the budget for special capabilities without exceeding twelve', () => {
    const fields = [
      field({ id: 'password', field_name: 'password', field_type: 'password' }),
      field({ id: 'upload', field_name: 'document', field_type: 'file', nominal_value: 'sample.txt' }),
      field({ id: 'consent', field_name: 'consent', field_type: 'checkbox' }),
    ];
    const budget = dynamicCaseBudget(
      profile({
        form_type: 'checkout_payment',
        steps: [{ inferred_multi_step: true }],
        conditional_rules: [{ controller_field: 'consent', options: [] }],
      }),
      fields,
    );
    expect(budget).toBeGreaterThan(4);
    expect(budget).toBeLessThanOrEqual(12);
  });

  it('does not duplicate a route already compiled by discovery', () => {
    const cases = buildHeuristicSuite(
      [field()],
      profile({
        route_compiled: true,
        steps: [{
          route_steps: [{ kind: 'click', selector: '#next', label: 'Next' }],
          inferred_multi_step: true,
        }],
      }),
    );
    expect(cases.every((item) => item.route_steps.length === 0)).toBe(true);
  });

  it('targets the intentionally invalid required field without blocking compilation', () => {
    const requiredField = field({
      id: 'required-name',
      field_name: 'customer_name',
      field_label: 'Nom',
    });
    const validationCase = buildHeuristicSuite([requiredField], profile())
      .find((item) => item.expected_outcome === 'validation_error');

    expect(validationCase).toBeDefined();
    expect(validationCase?.validation_scope).toBe('field');
    expect(validationCase?.target_field_id).toBe('required-name');
    expect(validationCase?.target_field_name).toBe('Nom');
    expect(validationCase?.expected_signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'form_invalid', field_id: 'required-name' }),
      ]),
    );
  });
});
