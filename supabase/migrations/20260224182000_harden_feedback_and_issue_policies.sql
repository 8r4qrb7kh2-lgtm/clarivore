-- Tighten RLS policies on feedback / issue tables that were previously broad.

-- allergen_detection_issues
DROP POLICY IF EXISTS "Authenticated users can read allergen issues" ON public.allergen_detection_issues;
DROP POLICY IF EXISTS "Authenticated users can update allergen issues" ON public.allergen_detection_issues;
DROP POLICY IF EXISTS "Managers can insert allergen issues" ON public.allergen_detection_issues;
DROP POLICY IF EXISTS "Service role can manage allergen issues" ON public.allergen_detection_issues;

CREATE POLICY "Managers and admins can read allergen issues"
  ON public.allergen_detection_issues
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.restaurant_managers AS rm
      WHERE rm.restaurant_id = public.allergen_detection_issues.restaurant_id
        AND rm.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers and admins can insert allergen issues"
  ON public.allergen_detection_issues
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.restaurant_managers AS rm
      WHERE rm.restaurant_id = public.allergen_detection_issues.restaurant_id
        AND rm.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers and admins can update allergen issues"
  ON public.allergen_detection_issues
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.restaurant_managers AS rm
      WHERE rm.restaurant_id = public.allergen_detection_issues.restaurant_id
        AND rm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.restaurant_managers AS rm
      WHERE rm.restaurant_id = public.allergen_detection_issues.restaurant_id
        AND rm.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage allergen issues"
  ON public.allergen_detection_issues
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- anonymous_feedback
DROP POLICY IF EXISTS "Anyone can submit anonymous feedback" ON public.anonymous_feedback;
DROP POLICY IF EXISTS "Authenticated users can view feedback" ON public.anonymous_feedback;

CREATE POLICY "Admins can read anonymous feedback"
  ON public.anonymous_feedback
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Service role can manage anonymous feedback"
  ON public.anonymous_feedback
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ingredient_scan_appeals
DROP POLICY IF EXISTS "Anyone can insert appeals" ON public.ingredient_scan_appeals;
DROP POLICY IF EXISTS "Anyone can read appeals" ON public.ingredient_scan_appeals;
DROP POLICY IF EXISTS "Authenticated users can delete appeals" ON public.ingredient_scan_appeals;
DROP POLICY IF EXISTS "Authenticated users can update appeals" ON public.ingredient_scan_appeals;
DROP POLICY IF EXISTS "Service role can manage all appeals" ON public.ingredient_scan_appeals;

CREATE POLICY "Managers and admins can read appeals"
  ON public.ingredient_scan_appeals
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.restaurant_managers AS rm
      WHERE rm.restaurant_id = public.ingredient_scan_appeals.restaurant_id
        AND rm.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers and admins can insert appeals"
  ON public.ingredient_scan_appeals
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.restaurant_managers AS rm
      WHERE rm.restaurant_id = public.ingredient_scan_appeals.restaurant_id
        AND rm.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can update appeals"
  ON public.ingredient_scan_appeals
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete appeals"
  ON public.ingredient_scan_appeals
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Service role can manage appeals"
  ON public.ingredient_scan_appeals
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- order_feedback
DROP POLICY IF EXISTS "Anyone can insert and read feedback" ON public.order_feedback;

CREATE POLICY "Public can insert verified order feedback"
  ON public.order_feedback
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    public.order_feedback.order_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.feedback_email_queue AS q
      WHERE q.order_id = public.order_feedback.order_id
        AND q.restaurant_id IS NOT DISTINCT FROM public.order_feedback.restaurant_id
        AND q.feedback_token IS NOT NULL
    )
    AND (
      public.order_feedback.user_id IS NULL
      OR public.order_feedback.user_id = auth.uid()
    )
    AND (
      public.order_feedback.user_email IS NULL
      OR char_length(btrim(public.order_feedback.user_email)) BETWEEN 3 AND 320
    )
  );

CREATE POLICY "Managers and admins can read order feedback"
  ON public.order_feedback
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR (
      public.order_feedback.user_id IS NOT NULL
      AND public.order_feedback.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.restaurant_managers AS rm
      WHERE rm.restaurant_id = public.order_feedback.restaurant_id
        AND rm.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage order feedback"
  ON public.order_feedback
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- product_issue_reports
DROP POLICY IF EXISTS "Anyone can insert reports" ON public.product_issue_reports;
DROP POLICY IF EXISTS "Authenticated can read reports" ON public.product_issue_reports;
DROP POLICY IF EXISTS "Authenticated can update reports" ON public.product_issue_reports;

CREATE POLICY "Admins can read product reports"
  ON public.product_issue_reports
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can update product reports"
  ON public.product_issue_reports
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Service role can manage product reports"
  ON public.product_issue_reports
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
