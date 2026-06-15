import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FieldConfigPanel } from '@/components/form-tester/FieldConfigPanel';
import type { WorkflowFormField } from '@/lib/form-tester/types';

function makeField(overrides: Partial<WorkflowFormField> = {}): WorkflowFormField {
  return {
    id: 'field-1',
    node_id: 'node-1',
    workflow_id: 'workflow-1',
    field_name: 'email',
    field_type: 'email',
    field_label: 'Email',
    field_selector: 'input[name="email"]',
    placeholder: 'contact@example.com',
    required: true,
    ai_suggestion: null,
    user_value: null,
    is_sensitive: true,
    created_at: '2026-06-08T10:00:00Z',
    ...overrides,
  };
}

describe('FieldConfigPanel', () => {
  it('does not block manual entry for fields masked in logs', () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);

    render(
      <FieldConfigPanel
        field={makeField()}
        onUpdate={onUpdate}
        isLoading={false}
      />,
    );

    const input = screen.getByPlaceholderText('contact@example.com');
    expect(input).not.toBeDisabled();

    fireEvent.change(input, { target: { value: 'qa@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /enregistrer la valeur/i }));

    expect(onUpdate).toHaveBeenCalledWith('field-1', 'qa@example.com');
    expect(screen.getByText(/la saisie reste autorisee/i)).toBeInTheDocument();
  });

  it('renders checkbox fields as controllable checklist values', () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);

    render(
      <FieldConfigPanel
        field={makeField({
          field_name: 'accept_ppdp',
          field_type: 'checkbox',
          field_label: 'J ai lu et j accepte le reglement',
          field_selector: 'input[name="accept_ppdp"]',
          placeholder: null,
          required: true,
          is_sensitive: false,
        })}
        onUpdate={onUpdate}
        isLoading={false}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /enregistrer la valeur/i }));

    expect(onUpdate).toHaveBeenCalledWith('field-1', 'true');
    expect(screen.getByText(/consentements, reglements, conditions et PPDP/i)).toBeInTheDocument();
  });
});
