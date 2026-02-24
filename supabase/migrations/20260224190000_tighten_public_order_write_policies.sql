-- Remove remaining anonymous/public write paths for order feedback and tablet orders.
-- Runtime writes now go through server APIs, so direct anon table writes are unnecessary.

-- order_feedback: no direct client-side inserts.
DROP POLICY IF EXISTS "Public can insert verified order feedback" ON public.order_feedback;

-- tablet_orders: disallow anonymous inserts.
DROP POLICY IF EXISTS "Anon can insert tablet orders" ON public.tablet_orders;
DROP POLICY IF EXISTS "Authenticated can insert tablet orders" ON public.tablet_orders;

CREATE POLICY "Diners can insert own tablet orders"
  ON public.tablet_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (payload ->> 'userId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND ((payload ->> 'userId')::uuid = auth.uid())
  );

CREATE POLICY "Managers and admins can insert tablet orders"
  ON public.tablet_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.restaurant_managers rm
      WHERE rm.user_id = auth.uid()
        AND rm.restaurant_id = public.tablet_orders.restaurant_id
    )
  );
