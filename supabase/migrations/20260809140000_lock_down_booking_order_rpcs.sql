-- ============================================================================
-- Corrige falha crítica: as RPCs de pedido eram executáveis por anon/authenticated
-- via PostgREST (/rest/v1/rpc/...), apesar do REVOKE FROM anon, authenticated na
-- migração anterior. Causa: o Postgres concede EXECUTE a PUBLIC por padrão na
-- criação da função, e revogar de um role específico não remove o grant que
-- todo role herda de PUBLIC. Isso permitia confirmar um pedido como pago
-- (confirm_booking_order) sem pagamento real, direto pela API pública.
-- ============================================================================

REVOKE ALL ON FUNCTION public.create_booking_order(uuid, jsonb, text, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_booking_order(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_booking_orders() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_booking_order(uuid, jsonb, text, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_booking_order(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_booking_orders() TO service_role;
