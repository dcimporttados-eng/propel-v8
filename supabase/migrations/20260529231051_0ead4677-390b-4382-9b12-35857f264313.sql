WITH ranked AS (
  SELECT id, reservation_id,
    FIRST_VALUE(id) OVER (
      PARTITION BY reservation_id
      ORDER BY (status = 'paid') DESC, paid_at NULLS LAST, created_at
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS keeper_id,
    ROW_NUMBER() OVER (
      PARTITION BY reservation_id
      ORDER BY (status = 'paid') DESC, paid_at NULLS LAST, created_at
    ) AS rn
  FROM public.payments
)
UPDATE public.reservations r
SET payment_id = ranked.keeper_id
FROM ranked
WHERE r.payment_id = ranked.id
  AND ranked.rn > 1;

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY reservation_id
      ORDER BY (status = 'paid') DESC, paid_at NULLS LAST, created_at
    ) AS rn
  FROM public.payments
)
DELETE FROM public.payments p
USING ranked r
WHERE p.id = r.id AND r.rn > 1;

ALTER TABLE public.payments
  ADD CONSTRAINT unique_payment_per_reservation UNIQUE (reservation_id);