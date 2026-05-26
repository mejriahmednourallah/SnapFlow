import { supabase } from '@/integrations/supabase/client';

export type UserRole = 'admin' | 'charge_de_projet' | 'testeur' | 'rapporteur';

export interface CreateUserParams {
  email: string;
  password: string;
  full_name: string;
  role: UserRole;
}

/** Invoke the create-user edge function. */
export async function createUser(params: CreateUserParams): Promise<void> {
  const { data, error } = await supabase.functions.invoke('create-user', { body: params });
  if (error) {
    // Attempt to unwrap the actual error message from FunctionsHttpError
    let msg = error.message;
    try {
      if ((error as any).context?.body) {
        const body = await (error as any).context.json();
        msg = body?.error || msg;
      }
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
}

/** Invoke the update-role edge function. */
export async function updateRole(userId: string, role: string): Promise<void> {
  const { error } = await supabase.functions.invoke('update-role', {
    body: { user_id: userId, role },
  });
  if (error) throw error;
}

/** Invoke the delete-user edge function. */
export async function deleteUser(userId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-user', {
    body: { user_id: userId },
  });
  if (error) throw error;
}
