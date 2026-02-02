-- Create user_loved_dishes table for storing dishes users have marked as loved
-- This allows users to build a personal library of favorite dishes

CREATE TABLE IF NOT EXISTS user_loved_dishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  dish_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, restaurant_id, dish_name)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_user_loved_dishes_user_id ON user_loved_dishes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_loved_dishes_restaurant_id ON user_loved_dishes(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_user_loved_dishes_dish_name ON user_loved_dishes(dish_name);

-- Enable RLS
ALTER TABLE user_loved_dishes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can only see their own loved dishes
CREATE POLICY "Users can view their own loved dishes"
  ON user_loved_dishes FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own loved dishes
CREATE POLICY "Users can insert their own loved dishes"
  ON user_loved_dishes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own loved dishes
CREATE POLICY "Users can delete their own loved dishes"
  ON user_loved_dishes FOR DELETE
  USING (auth.uid() = user_id);

-- Allow authenticated users to see loved dishes from other users (for recommendations)
-- This allows the dish search page to show recommendations from similar users
CREATE POLICY "Authenticated users can see loved dishes for recommendations"
  ON user_loved_dishes FOR SELECT
  USING (auth.role() = 'authenticated');

COMMENT ON TABLE user_loved_dishes IS 'Stores dishes that users have marked as loved in their personal library';

