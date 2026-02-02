-- Fix RLS policies for change_logs table

-- Drop existing policies if any
DROP POLICY IF EXISTS "Anyone can read change logs" ON change_logs;
DROP POLICY IF EXISTS "Authenticated users can insert change logs" ON change_logs;

-- Enable RLS
ALTER TABLE change_logs ENABLE ROW LEVEL SECURITY;

-- Policy to allow anyone to read change logs
CREATE POLICY "Anyone can read change logs" ON change_logs
  FOR SELECT
  USING (true);

-- Policy to allow authenticated users to insert change logs
CREATE POLICY "Authenticated users can insert change logs" ON change_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
