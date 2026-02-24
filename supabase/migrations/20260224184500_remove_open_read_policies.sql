-- Remove remaining broad public-read policies on sensitive operational tables.

-- feedback_email_queue
DROP POLICY IF EXISTS "Anyone can read email queue" ON public.feedback_email_queue;

CREATE POLICY "Admins can read email queue"
  ON public.feedback_email_queue
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Service role can manage email queue"
  ON public.feedback_email_queue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- change_logs
DROP POLICY IF EXISTS "Anyone can read change logs" ON public.change_logs;

ALTER POLICY "Anyone can view change logs"
  ON public.change_logs
  TO authenticated;
