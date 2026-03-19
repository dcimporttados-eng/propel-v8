CREATE POLICY "Anon users can read"
  ON public.users
  FOR SELECT
  TO anon
  USING (true);