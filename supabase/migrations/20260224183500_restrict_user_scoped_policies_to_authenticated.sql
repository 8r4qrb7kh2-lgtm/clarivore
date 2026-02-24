-- Restrict user-scoped RLS policies from role "public" to "authenticated".
-- These policies already depend on auth.uid()/auth.role() checks, so limiting the role
-- removes unnecessary anonymous exposure without changing expected behavior.

ALTER POLICY "Users can delete own diner device tokens"
  ON public.diner_device_tokens
  TO authenticated;

ALTER POLICY "Users can insert own diner device tokens"
  ON public.diner_device_tokens
  TO authenticated;

ALTER POLICY "Users can read own diner device tokens"
  ON public.diner_device_tokens
  TO authenticated;

ALTER POLICY "Users can update own diner device tokens"
  ON public.diner_device_tokens
  TO authenticated;

ALTER POLICY "Users can delete own diner push subscriptions"
  ON public.diner_push_subscriptions
  TO authenticated;

ALTER POLICY "Users can insert own diner push subscriptions"
  ON public.diner_push_subscriptions
  TO authenticated;

ALTER POLICY "Users can read own diner push subscriptions"
  ON public.diner_push_subscriptions
  TO authenticated;

ALTER POLICY "Users can update own diner push subscriptions"
  ON public.diner_push_subscriptions
  TO authenticated;

ALTER POLICY "Authenticated users can read locks"
  ON public.editor_locks
  TO authenticated;

ALTER POLICY "Users can delete own locks"
  ON public.editor_locks
  TO authenticated;

ALTER POLICY "Users can insert own locks"
  ON public.editor_locks
  TO authenticated;

ALTER POLICY "Users can update own locks"
  ON public.editor_locks
  TO authenticated;

ALTER POLICY "Users can delete own device tokens"
  ON public.manager_device_tokens
  TO authenticated;

ALTER POLICY "Users can insert own device tokens"
  ON public.manager_device_tokens
  TO authenticated;

ALTER POLICY "Users can read own device tokens"
  ON public.manager_device_tokens
  TO authenticated;

ALTER POLICY "Users can update own device tokens"
  ON public.manager_device_tokens
  TO authenticated;

ALTER POLICY "Users can delete own push subscriptions"
  ON public.manager_push_subscriptions
  TO authenticated;

ALTER POLICY "Users can insert own push subscriptions"
  ON public.manager_push_subscriptions
  TO authenticated;

ALTER POLICY "Users can read own push subscriptions"
  ON public.manager_push_subscriptions
  TO authenticated;

ALTER POLICY "Users can update own push subscriptions"
  ON public.manager_push_subscriptions
  TO authenticated;

ALTER POLICY "Users manage own allergies"
  ON public.user_allergies
  TO authenticated;

ALTER POLICY "Favorites deletable by owner"
  ON public.user_favorites
  TO authenticated;

ALTER POLICY "Favorites insertable by owner"
  ON public.user_favorites
  TO authenticated;

ALTER POLICY "Favorites readable by owner"
  ON public.user_favorites
  TO authenticated;

ALTER POLICY "Authenticated users can see loved dishes for recommendations"
  ON public.user_loved_dishes
  TO authenticated;

ALTER POLICY "Users can delete their own loved dishes"
  ON public.user_loved_dishes
  TO authenticated;

ALTER POLICY "Users can insert their own loved dishes"
  ON public.user_loved_dishes
  TO authenticated;

ALTER POLICY "Users can view their own loved dishes"
  ON public.user_loved_dishes
  TO authenticated;
