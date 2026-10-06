import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  user: { id: 'owned-user' } as { id: string } | null,
  rows: [] as { id: string; is_read: boolean }[],
  handlers: new Map<string, (payload: any) => void>(),
  snapshots: [] as ((result: { data: unknown[] }) => void)[],
  defer: false,
  remove: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: fake.user }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({
      limit: () => fake.defer
        ? new Promise(resolve => fake.snapshots.push(resolve))
        : Promise.resolve({ data: [...fake.rows] }),
    }) }) }) }),
    channel: () => {
      const channel = {
        on: (type: string, _filter: unknown, callback: (payload: any) => void) => {
          fake.handlers.set(type, callback); return channel;
        },
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: fake.remove,
  },
}));
import { useRealtimeNotifications } from '@/hooks/useRealtimeNotifications';

describe('notification snapshots across subscription startup', () => {
  beforeEach(() => {
    fake.user = { id: 'owned-user' };
    fake.rows = []; fake.handlers.clear(); fake.snapshots = []; fake.defer = false;
    fake.remove.mockClear();
  });

  it('includes an INSERT during the handshake without relying on a missed change event', async () => {
    const { result, unmount } = renderHook(() => useRealtimeNotifications('owned'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    fake.rows = [{ id: 'during-join', is_read: false }];
    await act(async () => fake.handlers.get('system')!({ extension: 'postgres_changes', status: 'ok' }));
    expect(result.current.notifications.map(row => row.id)).toEqual(['during-join']);
    expect(result.current.unreadCount).toBe(1);
    // Database readiness is sent again after a disconnected subscription returns.
    fake.rows.push({ id: 'during-disconnect', is_read: false });
    await act(async () => fake.handlers.get('system')!({ extension: 'postgres_changes', status: 'ok' }));
    expect(result.current.unreadCount).toBe(2);
    unmount(); expect(fake.remove).toHaveBeenCalledOnce();
  });

  it('keeps the newer snapshot when the initial request finishes last', async () => {
    fake.defer = true;
    const { result } = renderHook(() => useRealtimeNotifications('owned'));
    act(() => fake.handlers.get('system')!({ extension: 'postgres_changes', status: 'ok' }));
    await act(async () => fake.snapshots[1]({ data: [{ id: 'new', is_read: false }] }));
    await act(async () => fake.snapshots[0]({ data: [] }));
    expect(result.current.notifications.map(row => row.id)).toEqual(['new']);
  });

  it('clears the previous user snapshot at logout', async () => {
    fake.rows = [{ id: 'private-old-user', is_read: false }];
    const { result, rerender } = renderHook(() => useRealtimeNotifications('owned'));
    await waitFor(() => expect(result.current.unreadCount).toBe(1));
    fake.user = null; rerender();
    expect(result.current.notifications).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
