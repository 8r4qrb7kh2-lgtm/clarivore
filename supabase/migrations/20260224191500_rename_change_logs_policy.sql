-- Clarify policy naming to match current scope.
ALTER POLICY "Anyone can view change logs"
  ON public.change_logs
  RENAME TO "Managers can view change logs";
