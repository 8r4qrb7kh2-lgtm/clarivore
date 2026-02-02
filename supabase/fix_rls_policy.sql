-- Drop and recreate the INSERT policy with a simpler check
DROP POLICY IF EXISTS "Authenticated users can insert invitations" ON manager_invitations;

-- More permissive INSERT policy - any authenticated user can insert
CREATE POLICY "Authenticated users can insert invitations" ON manager_invitations
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
