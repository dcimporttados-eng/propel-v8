DO $$
BEGIN
  -- Defensive: ensure payments and reservations are NOT published via Realtime.
  -- Existing restrictive "Deny all" RLS already blocks client reads, but
  -- removing them from the publication eliminates any possibility of leakage
  -- via realtime channel subscriptions.
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'payments'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.payments';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'reservations'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.reservations';
  END IF;
END $$;

-- Force RLS so even table owners (other than service_role) cannot bypass it.
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reservations FORCE ROW LEVEL SECURITY;