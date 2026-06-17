import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, update, eq } = vi.hoisted(() => ({
  invoke: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke },
    from: vi.fn(() => ({ update })),
  },
}));

import { ClientLogoSidebar } from '@/components/projects/ClientLogoSidebar';

describe('ClientLogoSidebar', () => {
  beforeEach(() => {
    invoke.mockReset();
    update.mockReset();
    eq.mockReset();
    eq.mockResolvedValue({ error: null });
    update.mockReturnValue({ eq });
  });

  it('saves a manual logo URL and updates the parent after persistence', async () => {
    const onApply = vi.fn();
    render(
      <ClientLogoSidebar
        siteUrl="https://client.example"
        projectId="project-1"
        currentUrl=""
        onApply={onApply}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('https://exemple.com/logo.png'), {
      target: { value: 'https://cdn.example/logo.png' },
    });
    fireEvent.click(screen.getByRole('button', { name: /enregistrer/i }));

    await waitFor(() => expect(eq).toHaveBeenCalledWith('id', 'project-1'));
    expect(update).toHaveBeenCalledWith({ logo_url: 'https://cdn.example/logo.png' });
    expect(onApply).toHaveBeenCalledWith('https://cdn.example/logo.png');
    expect(await screen.findByText(/sauvegarde/i)).toBeInTheDocument();
  });

  it('shows a detected logo as a suggestion without overwriting the saved field', async () => {
    invoke.mockResolvedValue({
      data: {
        logo_url: 'https://client.example/detected.svg',
        source: 'jsonld-logo',
        confidence: 0.9,
      },
      error: null,
    });

    render(
      <ClientLogoSidebar
        siteUrl="https://client.example"
        projectId="project-1"
        currentUrl="https://cdn.example/manual.png"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /detecter/i }));
    expect(await screen.findByText(/logo json-ld/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://exemple.com/logo.png')).toHaveValue('https://cdn.example/manual.png');

    fireEvent.click(screen.getByRole('button', { name: /utiliser ce logo/i }));
    expect(screen.getByPlaceholderText('https://exemple.com/logo.png')).toHaveValue('https://client.example/detected.svg');
  });
});
