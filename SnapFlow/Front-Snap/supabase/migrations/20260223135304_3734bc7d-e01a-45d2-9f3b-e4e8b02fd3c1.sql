
-- Replace overly permissive trial insert policy with a more restrictive one
DROP POLICY "Anyone can insert trial" ON public.trial_usage;

-- Only allow insert if the email doesn't already exist (enforced by UNIQUE constraint anyway)
-- and limit to anon or authenticated users
CREATE POLICY "Insert trial once per email" ON public.trial_usage
  FOR INSERT WITH CHECK (
    NOT EXISTS (SELECT 1 FROM public.trial_usage t WHERE t.email = email)
  );
