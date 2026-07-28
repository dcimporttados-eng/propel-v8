-- Guarda o ID da sessão de Checkout da Asaas, usado como plano B para casar
-- o webhook de pagamento com a reserva quando o externalReference não é
-- propagado da CheckoutSession para o Payment (comportamento observado da Asaas).
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS asaas_checkout_id text;
