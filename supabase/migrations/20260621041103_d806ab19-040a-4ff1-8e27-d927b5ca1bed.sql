-- Reversão do burst de 174 reservas manuais criadas em 20/06/2026 18:35-18:48 UTC
-- Backup CSV em /mnt/documents/backup_reservas_a_reverter.csv

WITH alvo AS (
  SELECT r.id AS reservation_id, p.id AS payment_id
  FROM public.reservations r
  JOIN public.payments p ON p.reservation_id = r.id
  WHERE p.transaction_id LIKE 'MANUAL-%'
    AND p.amount = 2990
    AND r.created_at BETWEEN '2026-06-20 18:35:13+00' AND '2026-06-20 18:48:10+00'
),
del_res AS (
  DELETE FROM public.reservations
  WHERE id IN (SELECT reservation_id FROM alvo)
  RETURNING id
)
DELETE FROM public.payments
WHERE id IN (SELECT payment_id FROM alvo);
