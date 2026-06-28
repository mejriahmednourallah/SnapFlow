import { describe, expect, it } from 'vitest';
import { supabase } from '@/integrations/supabase/client';

const runLiveProjectSync = process.env.LIVE_PROJECT_SYNC === '1';
const describeLive = runLiveProjectSync ? describe : describe.skip;

describeLive('Live Project Sync Flow', () => {
  it('invokes sync_my_account_projects against the configured Supabase project', async () => {
    const email = process.env.SNAPFLOW_TEST_USER_EMAIL;
    const password = process.env.SNAPFLOW_TEST_USER_PASSWORD;

    expect(email, 'SNAPFLOW_TEST_USER_EMAIL is required for live project sync tests').toBeTruthy();
    expect(password, 'SNAPFLOW_TEST_USER_PASSWORD is required for live project sync tests').toBeTruthy();

    const signIn = await supabase.auth.signInWithPassword({
      email: email!,
      password: password!,
    });

    expect(signIn.error).toBeNull();

    const result = await supabase.functions.invoke('fetch-redmine', {
      body: { type: 'sync_my_account_projects' },
    });

    await supabase.auth.signOut();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(expect.objectContaining({
      success: true,
      matched: expect.any(Number),
      skipped: expect.any(Number),
      ambiguous: expect.any(Number),
      errors: expect.any(Number),
      details: expect.any(Array),
    }));
  });
});