-- ============================================================================
-- RPCs transacionais do pedido
-- ----------------------------------------------------------------------------
-- O cliente JS do Supabase (PostgREST) não suporta transação multi-comando,
-- então a atomicidade exigida (ou tudo, ou nada) só é possível dentro de uma
-- função plpgsql — cada chamada roda numa única transação.
-- ============================================================================

-- ===== 1. Criação do pedido: valida tudo, cria tudo, ou não cria nada =====
CREATE OR REPLACE FUNCTION public.create_booking_order(
  p_user_id          uuid,
  p_items            jsonb,   -- [{"class_id": "...", "class_date": "YYYY-MM-DD"}]
  p_campaign_id      text,
  p_discount_percent integer,
  p_ttl_minutes      integer,
  p_default_price    integer DEFAULT 2990
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item       RECORD;
  v_capacity   INTEGER;
  v_price      INTEGER;
  v_taken      INTEGER;
  v_subtotal   INTEGER := 0;
  v_discount   INTEGER := 0;
  v_total      INTEGER;
  v_count      INTEGER;
  v_order_id   UUID;
  v_expires    TIMESTAMPTZ;
  v_class_name TEXT;
BEGIN
  v_count := jsonb_array_length(p_items);
  IF v_count IS NULL OR v_count = 0 THEN
    RAISE EXCEPTION 'EMPTY_ORDER';
  END IF;

  v_expires := now() + make_interval(mins => p_ttl_minutes);

  -- Locks em ordem determinística (class_id, class_date): dois pedidos que
  -- compartilham horários são serializados sem risco de deadlock.
  FOR v_item IN
    SELECT (it->>'class_id')::uuid AS class_id,
           (it->>'class_date')::date AS class_date
    FROM jsonb_array_elements(p_items) it
    ORDER BY 1, 2
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_item.class_id::text || '|' || COALESCE(v_item.class_date::text, ''), 0)
    );
  END LOOP;

  -- Valida disponibilidade de TODOS os itens e soma o subtotal
  FOR v_item IN
    SELECT (it->>'class_id')::uuid AS class_id,
           (it->>'class_date')::date AS class_date
    FROM jsonb_array_elements(p_items) it
  LOOP
    SELECT c.capacity, COALESCE(c.price, p_default_price), c.title
      INTO v_capacity, v_price, v_class_name
    FROM classes c WHERE c.id = v_item.class_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CLASS_NOT_FOUND';
    END IF;

    IF v_capacity <= 0 THEN
      RAISE EXCEPTION 'CLASS_DISABLED:%', COALESCE(v_class_name, '');
    END IF;

    SELECT COUNT(*) INTO v_taken
    FROM reservations r
    WHERE r.class_id = v_item.class_id
      AND r.class_date = v_item.class_date
      AND (
        r.status = 'confirmed'
        OR (r.status = 'pending' AND r.expires_at IS NOT NULL AND r.expires_at > now())
      );

    IF v_taken >= v_capacity THEN
      RAISE EXCEPTION 'NO_SEATS:% em %',
        COALESCE(v_class_name, 'Aula'),
        to_char(v_item.class_date, 'DD/MM');
    END IF;

    v_subtotal := v_subtotal + v_price;
  END LOOP;

  -- Desconto em centavos, com divisão inteira (trunca) — nunca ponto flutuante.
  -- Ex.: 3 aulas x 2990 = 8970; 8970*5/100 = 448 (não 448,5) -> total 8522 = R$85,22
  IF p_discount_percent > 0 THEN
    v_discount := (v_subtotal * p_discount_percent) / 100;
  END IF;
  v_total := v_subtotal - v_discount;

  INSERT INTO booking_orders (
    user_id, status, items_count, subtotal_cents, discount_percent,
    discount_cents, total_cents, campaign_id, campaign_applied_at, expires_at
  ) VALUES (
    p_user_id, 'pending', v_count, v_subtotal, COALESCE(p_discount_percent, 0),
    v_discount, v_total,
    CASE WHEN p_discount_percent > 0 THEN p_campaign_id ELSE NULL END,
    CASE WHEN p_discount_percent > 0 THEN now() ELSE NULL END,
    v_expires
  ) RETURNING id INTO v_order_id;

  INSERT INTO reservations (user_id, class_id, class_date, status, order_id, expires_at, combo_aplicado)
  SELECT p_user_id,
         (it->>'class_id')::uuid,
         (it->>'class_date')::date,
         'pending',
         v_order_id,
         v_expires,
         false
  FROM jsonb_array_elements(p_items) it;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'items_count', v_count,
    'subtotal_cents', v_subtotal,
    'discount_percent', COALESCE(p_discount_percent, 0),
    'discount_cents', v_discount,
    'total_cents', v_total,
    'expires_at', v_expires,
    'reservation_ids', (SELECT jsonb_agg(r.id ORDER BY r.created_at)
                        FROM reservations r WHERE r.order_id = v_order_id)
  );
END;
$function$;

-- ===== 2. Confirmação do pedido: tudo ou nada, idempotente =====
CREATE OR REPLACE FUNCTION public.confirm_booking_order(
  p_order_id       uuid,
  p_transaction_id text,
  p_amount_cents   integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order      booking_orders%ROWTYPE;
  v_item       RECORD;
  v_capacity   INTEGER;
  v_taken      INTEGER;
  v_blocked    TEXT := NULL;
  v_payment_id UUID;
  v_first_res  UUID;
  v_note       TEXT;
BEGIN
  -- Serializa webhooks concorrentes do mesmo pedido
  SELECT * INTO v_order FROM booking_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;

  -- Idempotência: pedido já processado não é erro
  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_processed', 'order_id', p_order_id);
  END IF;

  -- Revalida as vagas. Essencial quando o pagamento chega após a expiração:
  -- se ninguém tomou o lugar, o pedido é honrado normalmente.
  FOR v_item IN
    SELECT r.id, r.class_id, r.class_date FROM reservations r WHERE r.order_id = p_order_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_item.class_id::text || '|' || COALESCE(v_item.class_date::text, ''), 0)
    );

    SELECT c.capacity INTO v_capacity FROM classes c WHERE c.id = v_item.class_id;

    SELECT COUNT(*) INTO v_taken
    FROM reservations r2
    WHERE r2.class_id = v_item.class_id
      AND r2.class_date = v_item.class_date
      AND r2.id <> v_item.id
      AND (
        r2.status = 'confirmed'
        OR (r2.status = 'pending' AND r2.expires_at IS NOT NULL AND r2.expires_at > now())
      );

    IF v_taken >= COALESCE(v_capacity, 0) THEN
      v_blocked := COALESCE(v_blocked || ', ', '') || to_char(v_item.class_date, 'DD/MM');
    END IF;
  END LOOP;

  -- Nunca confirma parcialmente: se qualquer vaga caiu, o pedido inteiro vai
  -- para revisão manual (estorno), com o pagamento registrado para auditoria.
  IF v_blocked IS NOT NULL THEN
    UPDATE booking_orders
      SET status = 'needs_review',
          paid_amount_cents = p_amount_cents,
          notes = 'Pagamento recebido (tx ' || COALESCE(p_transaction_id, '?') ||
                  ') mas vagas já ocupadas em: ' || v_blocked || '. Requer estorno ou realocação.'
      WHERE id = p_order_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'seats_taken', 'detail', v_blocked, 'order_id', p_order_id);
  END IF;

  -- Divergência de valor: registra, mas só bloqueia se pagou MENOS que o devido
  IF p_amount_cents IS NOT NULL AND p_amount_cents <> v_order.total_cents THEN
    v_note := 'Valor divergente: esperado ' || v_order.total_cents ||
              ', recebido ' || p_amount_cents || '. ';
    IF p_amount_cents < v_order.total_cents THEN
      UPDATE booking_orders
        SET status = 'needs_review', paid_amount_cents = p_amount_cents,
            notes = v_note || 'Pagamento insuficiente — não confirmado.'
        WHERE id = p_order_id;
      RETURN jsonb_build_object('ok', false, 'reason', 'amount_mismatch',
                                'expected', v_order.total_cents, 'received', p_amount_cents);
    END IF;
  END IF;

  SELECT id INTO v_first_res FROM reservations
    WHERE order_id = p_order_id ORDER BY created_at LIMIT 1;

  -- Pagamento idempotente: UNIQUE(transaction_id) trata corrida entre webhooks
  SELECT id INTO v_payment_id FROM payments WHERE transaction_id = p_transaction_id;
  IF v_payment_id IS NULL THEN
    INSERT INTO payments (user_id, reservation_id, order_id, amount, status, transaction_id, paid_at)
    VALUES (v_order.user_id, v_first_res, p_order_id, p_amount_cents, 'paid', p_transaction_id, now())
    ON CONFLICT (transaction_id) WHERE transaction_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_payment_id;

    IF v_payment_id IS NULL THEN
      SELECT id INTO v_payment_id FROM payments WHERE transaction_id = p_transaction_id;
    END IF;
  END IF;

  UPDATE reservations
    SET status = 'confirmed', payment_id = v_payment_id, expires_at = NULL
    WHERE order_id = p_order_id AND status <> 'confirmed';

  UPDATE booking_orders
    SET status = 'paid', paid_at = now(), paid_amount_cents = p_amount_cents,
        notes = COALESCE(v_note, notes)
    WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'ok', true, 'reason', 'confirmed', 'order_id', p_order_id,
    'payment_id', v_payment_id,
    'reservation_ids', (SELECT jsonb_agg(r.id) FROM reservations r WHERE r.order_id = p_order_id)
  );
END;
$function$;

-- ===== 3. Expiração: libera as vagas dos pedidos não pagos =====
CREATE OR REPLACE FUNCTION public.expire_booking_orders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orders INTEGER := 0;
  v_res    INTEGER := 0;
BEGIN
  WITH expired AS (
    UPDATE booking_orders
      SET status = 'expired'
      WHERE status = 'pending'
        AND expires_at IS NOT NULL
        AND expires_at < now()
      RETURNING id
  ), freed AS (
    UPDATE reservations
      SET status = 'canceled'
      WHERE order_id IN (SELECT id FROM expired)
        AND status = 'pending'
      RETURNING 1
  )
  SELECT (SELECT COUNT(*) FROM expired), (SELECT COUNT(*) FROM freed)
    INTO v_orders, v_res;

  RETURN jsonb_build_object('orders_expired', v_orders, 'reservations_freed', v_res);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_booking_order(uuid, jsonb, text, integer, integer, integer) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_booking_order(uuid, text, integer) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_booking_orders() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_order(uuid, jsonb, text, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_booking_order(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_booking_orders() TO service_role;
