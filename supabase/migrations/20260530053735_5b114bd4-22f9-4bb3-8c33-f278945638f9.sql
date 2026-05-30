DROP POLICY IF EXISTS "Anon users can read" ON public.users;
-- inserts via anon continuam permitidos (fluxo de booking público)
REVOKE SELECT ON public.users FROM anon;