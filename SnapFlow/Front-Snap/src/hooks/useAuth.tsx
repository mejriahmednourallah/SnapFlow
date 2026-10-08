import { useState, useEffect, createContext, useContext, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { getUserDisplayName } from '@/lib/userDisplay';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  userRole: string | null;
  isAdmin: boolean;
  displayName: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  userRole: null,
  isAdmin: false,
  displayName: null,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const role = useQuery({
    queryKey: ['user-role', user?.id],
    enabled: !!user,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.from('user_roles').select('role')
        .eq('user_id', user!.id).abortSignal(signal).maybeSingle();
      if (error) throw error;
      return data?.role ?? null;
    },
  });
  const userRole = user ? role.data ?? null : null;
  const loading = loadingSession || (!!user && role.isPending);

  useEffect(() => {
    let disposed = false;
    let eventReceived = false;
    let currentUserId: string | null = null;
    const applySession = (next: Session | null) => {
      if (disposed) return;
      const nextId = next?.user.id ?? null;
      if (currentUserId !== nextId) {
        // Cancel old reads and remove all data from the previous account.
        queryClient.clear();
        currentUserId = nextId;
      }
      setSession(next);
      setUser(next?.user ?? null);
      setLoadingSession(false);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      eventReceived = true;
      applySession(next);
    });
    void supabase.auth.getSession().then(({ data: { session: next } }) => {
      if (!eventReceived) applySession(next);
    }).catch(() => { if (!eventReceived) applySession(null); });
    return () => { disposed = true; subscription.unsubscribe(); };
  }, []);

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    queryClient.clear();
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, userRole, isAdmin: userRole === 'admin', displayName: getUserDisplayName(user), signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
