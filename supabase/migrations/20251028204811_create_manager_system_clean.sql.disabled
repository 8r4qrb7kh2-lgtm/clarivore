-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can read unused invitations" ON manager_invitations;
DROP POLICY IF EXISTS "Authenticated users can insert invitations" ON manager_invitations;
DROP POLICY IF EXISTS "Authenticated users can update invitations" ON manager_invitations;
DROP POLICY IF EXISTS "Users can read own manager relationships" ON restaurant_managers;
DROP POLICY IF EXISTS "Authenticated users can insert manager relationships" ON restaurant_managers;
DROP POLICY IF EXISTS "Users can delete own manager relationships" ON restaurant_managers;

-- Create manager_invitations table if it doesn't exist
CREATE TABLE IF NOT EXISTS manager_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  used BOOLEAN DEFAULT FALSE,
  used_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at TIMESTAMP WITH TIME ZONE
);

-- Create restaurant_managers table if it doesn't exist
CREATE TABLE IF NOT EXISTS restaurant_managers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, restaurant_id)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_manager_invitations_token ON manager_invitations(token);
CREATE INDEX IF NOT EXISTS idx_manager_invitations_restaurant ON manager_invitations(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_managers_user ON restaurant_managers(user_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_managers_restaurant ON restaurant_managers(restaurant_id);

-- Enable RLS
ALTER TABLE manager_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_managers ENABLE ROW LEVEL SECURITY;

-- RLS Policies for manager_invitations
-- Anyone can read unused invitations to validate tokens during signup
CREATE POLICY "Anyone can read unused invitations" ON manager_invitations
  FOR SELECT
  USING (used = FALSE);

-- Only authenticated users can insert invitations (admin tool)
CREATE POLICY "Authenticated users can insert invitations" ON manager_invitations
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Only authenticated users can update invitations (mark as used)
CREATE POLICY "Authenticated users can update invitations" ON manager_invitations
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- RLS Policies for restaurant_managers
-- Users can read their own manager relationships
CREATE POLICY "Users can read own manager relationships" ON restaurant_managers
  FOR SELECT
  USING (auth.uid() = user_id);

-- Authenticated users can insert manager relationships (during onboarding)
CREATE POLICY "Authenticated users can insert manager relationships" ON restaurant_managers
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own manager relationships
CREATE POLICY "Users can delete own manager relationships" ON restaurant_managers
  FOR DELETE
  USING (auth.uid() = user_id);

-- Create function to delete user account and all related data
CREATE OR REPLACE FUNCTION delete_user()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete user's allergen data
  DELETE FROM user_allergies WHERE user_id = auth.uid();

  -- Delete user's manager relationships
  DELETE FROM restaurant_managers WHERE user_id = auth.uid();

  -- Delete user's favorites (if table exists)
  DELETE FROM user_favorites WHERE user_id = auth.uid();

  -- Delete the auth user
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;
