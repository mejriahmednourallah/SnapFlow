import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { queryClient } from '@/lib/queryClient';

const mocks = vi.hoisted(() => ({ callback: null as any, getSession: vi.fn(), role: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: {
    onAuthStateChange: (callback: any) => { mocks.callback = callback; return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }; },
    getSession: () => mocks.getSession(),
  },
  from: () => {
    const builder: any = {};
    builder.select = builder.abortSignal = () => builder;
    builder.eq = (_column: string, userId: string) => { builder.userId = userId; return builder; };
    builder.maybeSingle = () => mocks.role(builder.userId);
    return builder;
  },
} }));
const session = (id: string) => ({ user: { id, email: `${id}@example.invalid` } });
function Display() {
  const auth = useAuth();
  return <span>{auth.loading ? 'Loading' : `${auth.user?.id ?? 'none'}:${auth.userRole ?? 'none'}`}</span>;
}
function mount() {
  return render(<QueryClientProvider client={queryClient}><AuthProvider><Display /></AuthProvider></QueryClientProvider>);
}
beforeEach(() => {
  queryClient.clear(); vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ data: { session: session('one') } });
  mocks.role.mockResolvedValue({ data: { role: 'admin' } });
});
afterEach(() => { cleanup(); queryClient.clear(); });

describe('user-scoped project cache lifecycle', () => {
  it('deduplicates initial-session and token-refresh role reads', async () => {
    mount();
    await screen.findByText('one:admin');
    act(() => mocks.callback('INITIAL_SESSION', session('one')));
    act(() => mocks.callback('TOKEN_REFRESHED', session('one')));
    expect(mocks.role).toHaveBeenCalledTimes(1);
  });

  it('clears the previous account data on account change and logout', async () => {
    mount(); await screen.findByText('one:admin');
    queryClient.setQueryData(['project-list','one'], ['private-project']);
    act(() => mocks.callback('SIGNED_IN', session('two')));
    await screen.findByText('two:admin');
    expect(queryClient.getQueryData(['project-list','one'])).toBeUndefined();
    queryClient.setQueryData(['project-list','two'], ['second-project']);
    act(() => mocks.callback('SIGNED_OUT', null));
    await screen.findByText('none:none');
    expect(queryClient.getQueryData(['project-list','two'])).toBeUndefined();
  });

  it('does not let a slow initial session overwrite a later login', async () => {
    let resolve!: (value: any) => void;
    mocks.getSession.mockReturnValue(new Promise(done => { resolve = done; }));
    mount();
    act(() => mocks.callback('SIGNED_IN', session('two')));
    await screen.findByText('two:admin');
    await act(async () => resolve({ data: { session: session('one') } }));
    expect(screen.getByText('two:admin')).toBeVisible();
  });

  it('ignores the result of a previous account role request', async () => {
    let resolveOld!: (value: any) => void;
    mocks.role.mockReturnValueOnce(new Promise(done => { resolveOld = done; }))
      .mockResolvedValueOnce({ data: { role: 'rapporteur' } });
    mount();
    await waitFor(() => expect(mocks.role).toHaveBeenCalledWith('one'));
    act(() => mocks.callback('SIGNED_IN', session('two')));
    await screen.findByText('two:rapporteur');
    await act(async () => resolveOld({ data: { role: 'admin' } }));
    expect(screen.getByText('two:rapporteur')).toBeVisible();
  });
});
