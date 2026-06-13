
-- Remove sensitive tables from Realtime publication to prevent change-event leakage
ALTER PUBLICATION supabase_realtime DROP TABLE public.payments;
ALTER PUBLICATION supabase_realtime DROP TABLE public.reservations;

-- Lock down payments table: deny all client access; service_role bypasses RLS
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payments FROM anon, authenticated;
GRANT ALL ON public.payments TO service_role;

DROP POLICY IF EXISTS "Deny all client access to payments" ON public.payments;
CREATE POLICY "Deny all client access to payments"
ON public.payments
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

-- Lock down reservations table: deny all client access; service_role bypasses RLS
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservations FROM anon, authenticated;
GRANT ALL ON public.reservations TO service_role;

DROP POLICY IF EXISTS "Deny all client access to reservations" ON public.reservations;
CREATE POLICY "Deny all client access to reservations"
ON public.reservations
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

-- Revoke EXECUTE on get_available_spots from public/anon/authenticated
-- (only used server-side by edge functions running as service_role)
REVOKE EXECUTE ON FUNCTION public.get_available_spots(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_available_spots(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_spots(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_available_spots(uuid, date) TO service_role;

-- get_class_occupancy is intentionally called from the public schedule UI (anon).
-- Keep it executable but ensure it's tightly scoped (already SECURITY DEFINER with fixed search_path).
GRANT EXECUTE ON FUNCTION public.get_class_occupancy(date[]) TO anon, authenticated, service_role;
