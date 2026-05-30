
-- ============================================================
-- FASE 2: Lockdown RLS — bloqueia escritas anon em tabelas críticas
-- ============================================================

-- ===== classes =====
DROP POLICY IF EXISTS "Anyone can insert classes" ON public.classes;
DROP POLICY IF EXISTS "Anyone can update classes" ON public.classes;
DROP POLICY IF EXISTS "Anyone can delete classes" ON public.classes;
REVOKE INSERT, UPDATE, DELETE ON public.classes FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.classes FROM authenticated;

-- ===== class_suspensions =====
DROP POLICY IF EXISTS "Anyone can insert suspensions" ON public.class_suspensions;
DROP POLICY IF EXISTS "Anyone can delete suspensions" ON public.class_suspensions;
REVOKE INSERT, UPDATE, DELETE ON public.class_suspensions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.class_suspensions FROM authenticated;

-- ===== payments — totalmente fechado pro anon (só edge fns) =====
DROP POLICY IF EXISTS "Anyone can read payments" ON public.payments;
DROP POLICY IF EXISTS "Anyone can insert payments" ON public.payments;
DROP POLICY IF EXISTS "Anyone can update payments" ON public.payments;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.payments FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.payments FROM authenticated;

-- ===== reservations — fechado pro anon (só edge fns + RPC pública) =====
DROP POLICY IF EXISTS "Anyone can insert reservations" ON public.reservations;
DROP POLICY IF EXISTS "Anyone can read own reservations" ON public.reservations;
DROP POLICY IF EXISTS "Service role can update reservations" ON public.reservations;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.reservations FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.reservations FROM authenticated;

-- ===== users — revoga INSERT anon (reserve usa service_role) =====
DROP POLICY IF EXISTS "Anon users can insert" ON public.users;
REVOKE INSERT ON public.users FROM anon;

-- ===== RPC pública para ScheduleModal calcular vagas sem ler reservations =====
CREATE OR REPLACE FUNCTION public.get_class_occupancy(p_dates date[])
RETURNS TABLE(class_id uuid, class_date date, confirmed_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.class_id, r.class_date, COUNT(*)::int AS confirmed_count
  FROM public.reservations r
  WHERE r.status = 'confirmed'
    AND r.class_date = ANY(p_dates)
  GROUP BY r.class_id, r.class_date;
$$;

GRANT EXECUTE ON FUNCTION public.get_class_occupancy(date[]) TO anon, authenticated;
