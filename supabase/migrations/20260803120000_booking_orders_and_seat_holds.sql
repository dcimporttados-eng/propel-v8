-- ============================================================================
-- Pedidos (booking_orders) + reserva temporária de vaga + idempotência
-- ----------------------------------------------------------------------------
-- Contexto: até aqui um "pedido" era só uma lista CSV de reservation_ids no
-- externalReference da Asaas. Sem entidade de pedido não havia onde registrar
-- os dados comerciais (subtotal/desconto/campanha) antes do pagamento, nem como
-- garantir atomicidade. Além disso, reservas `pending` NÃO seguravam vaga: duas
-- pessoas podiam pagar pela mesma última vaga.
-- ============================================================================

-- ===== 1. Tabela de pedidos =====
CREATE TABLE IF NOT EXISTS public.booking_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'pending',
  items_count         INTEGER NOT NULL,
  subtotal_cents      INTEGER NOT NULL,
  discount_percent    INTEGER NOT NULL DEFAULT 0,
  discount_cents      INTEGER NOT NULL DEFAULT 0,
  total_cents         INTEGER NOT NULL,
  campaign_id         TEXT,
  campaign_applied_at TIMESTAMPTZ,
  asaas_checkout_id   TEXT,
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at             TIMESTAMPTZ,
  paid_amount_cents   INTEGER,
  notes               TEXT,
  CONSTRAINT booking_orders_status_check
    CHECK (status IN ('pending', 'paid', 'expired', 'canceled', 'needs_review'))
);

ALTER TABLE public.booking_orders ENABLE ROW LEVEL SECURITY;
-- Sem policies: apenas service_role (edge functions) acessa. anon/authenticated ficam bloqueados.
REVOKE ALL ON public.booking_orders FROM anon, authenticated;

-- ===== 2. Vínculo das reservas com o pedido + validade da retenção de vaga =====
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS order_id   UUID REFERENCES public.booking_orders(id) ON DELETE SET NULL;
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.reservations.expires_at IS
  'Até quando uma reserva pending segura a vaga. NULL = não segura (reservas legadas).';

-- ===== 3. Pagamento vinculado ao pedido + idempotência real =====
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES public.booking_orders(id) ON DELETE SET NULL;

-- Idempotência do webhook: uma transação Asaas só pode gerar um pagamento.
-- (NULLs continuam permitidos e não colidem entre si no Postgres.)
CREATE UNIQUE INDEX IF NOT EXISTS payments_transaction_id_key
  ON public.payments (transaction_id)
  WHERE transaction_id IS NOT NULL;

-- ===== 4. Índices =====
CREATE INDEX IF NOT EXISTS idx_reservations_order_id
  ON public.reservations (order_id);
CREATE INDEX IF NOT EXISTS idx_reservations_seat_lookup
  ON public.reservations (class_id, class_date, status);
CREATE INDEX IF NOT EXISTS idx_booking_orders_expiry
  ON public.booking_orders (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_booking_orders_checkout
  ON public.booking_orders (asaas_checkout_id);

-- ===== 5. Disponibilidade passa a considerar pendentes válidas =====
-- Uma vaga está ocupada se a reserva está confirmada OU está pendente e ainda
-- dentro da janela de pagamento. Pendentes expiradas liberam a vaga sozinhas,
-- mesmo antes da rotina de limpeza rodar.
CREATE OR REPLACE FUNCTION public.get_available_spots(p_class_id uuid, p_date date DEFAULT NULL::date)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT c.capacity - COALESCE(
    (SELECT COUNT(*) FROM public.reservations r
     WHERE r.class_id = p_class_id
       AND (p_date IS NULL OR r.class_date = p_date)
       AND (
         r.status = 'confirmed'
         OR (r.status = 'pending' AND r.expires_at IS NOT NULL AND r.expires_at > now())
       )),
    0
  )::INTEGER
  FROM public.classes c
  WHERE c.id = p_class_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_class_occupancy(p_dates date[])
RETURNS TABLE(class_id uuid, class_date date, confirmed_count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT r.class_id, r.class_date, COUNT(*)::int AS confirmed_count
  FROM public.reservations r
  WHERE r.class_date = ANY(p_dates)
    AND (
      r.status = 'confirmed'
      OR (r.status = 'pending' AND r.expires_at IS NOT NULL AND r.expires_at > now())
    )
  GROUP BY r.class_id, r.class_date;
$function$;

GRANT EXECUTE ON FUNCTION public.get_available_spots(uuid, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_class_occupancy(date[]) TO anon, authenticated, service_role;
