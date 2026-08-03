import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildChargeDescription } from "../_shared/campaign.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, asaas-access-token",
};

const CONFIRM_EVENTS = new Set(["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"]);
const CANCEL_EVENTS = new Set(["PAYMENT_OVERDUE", "PAYMENT_REFUNDED", "PAYMENT_DELETED"]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const webhookToken = Deno.env.get("ASAAS_WEBHOOK_TOKEN")!;
    const asaasApiKey = Deno.env.get("ASAAS_API_KEY")!;
    const asaasEnv = Deno.env.get("ASAAS_ENV") || "sandbox";
    const asaasBaseUrl = asaasEnv === "production"
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Garante que a notificação veio mesmo da Asaas
    const receivedToken = req.headers.get("asaas-access-token");
    if (!webhookToken || receivedToken !== webhookToken) {
      console.error("Invalid or missing asaas-access-token header");
      return json({ error: "unauthorized" }, 401);
    }

    const body = await req.json();
    const event = body.event as string | undefined;
    const payment = body.payment;

    if (!event || !payment) {
      return json({ received: true, ignored: true });
    }

    const externalRef = (payment.externalReference as string | null)?.trim() || null;
    const checkoutSessionId = (payment.checkoutSession as string | null) || null;
    const amountCents = Math.round((payment.value || 0) * 100);
    const transactionId = String(payment.id);

    console.log(`Asaas ${event} | tx=${transactionId} ref=${externalRef} session=${checkoutSessionId}`);

    // ===== Resolve o pedido =====
    // 1) externalReference = order_id (formato atual)
    // 2) asaas_checkout_id (a Asaas nem sempre propaga o externalReference)
    // 3) CSV de reservation_ids (pedidos legados, anteriores a booking_orders)
    let orderId: string | null = null;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (externalRef && UUID_RE.test(externalRef)) {
      const { data } = await supabase
        .from("booking_orders").select("id").eq("id", externalRef).maybeSingle();
      if (data) orderId = data.id as string;
    }

    if (!orderId && checkoutSessionId) {
      const { data } = await supabase
        .from("booking_orders").select("id").eq("asaas_checkout_id", checkoutSessionId).maybeSingle();
      if (data) orderId = data.id as string;
    }

    // ===== Fluxo novo: pedido =====
    if (orderId) {
      if (CONFIRM_EVENTS.has(event)) {
        const { data: result, error } = await supabase.rpc("confirm_booking_order", {
          p_order_id: orderId,
          p_transaction_id: transactionId,
          p_amount_cents: amountCents,
        });

        if (error) {
          console.error("confirm_booking_order failed:", error.message);
          return json({ received: true, error: "confirm_failed" });
        }

        const res = result as { ok: boolean; reason: string; reservation_ids?: string[]; detail?: string };

        if (!res.ok) {
          // Pagamento recebido mas o pedido não pôde ser honrado por inteiro.
          // Nunca confirmamos parcialmente — avisa para estorno/realocação.
          console.error(`Order ${orderId} needs review: ${res.reason} ${res.detail || ""}`);
          await notifyTelegram(supabaseUrl, supabaseServiceKey, {
            type: "order_alert",
            order_id: orderId,
            transaction_id: transactionId,
            reason: res.reason,
            detail: res.detail || "",
            amount_cents: amountCents,
          });
          return json({ received: true, needs_review: true, reason: res.reason });
        }

        if (res.reason === "already_processed") {
          console.log(`Order ${orderId} already processed — idempotent no-op`);
          return json({ received: true, processed: true, idempotent: true });
        }

        console.log(`✅ Order ${orderId} confirmado (${res.reservation_ids?.length || 0} reservas)`);

        await updateAsaasDescription(supabase, asaasBaseUrl, asaasApiKey, orderId, transactionId);
        await notifyTelegram(supabaseUrl, supabaseServiceKey, {
          type: "reservation",
          reservation_ids: res.reservation_ids || [],
          transaction_id: transactionId,
          total_cents: amountCents,
          combo_applied: (res.reservation_ids?.length || 0) > 1,
        });

        return json({ received: true, processed: true });
      }

      if (CANCEL_EVENTS.has(event)) {
        const { data: ord } = await supabase
          .from("booking_orders").select("status").eq("id", orderId).maybeSingle();

        // Pedido já pago não é desfeito por evento de expiração/cancelamento.
        if (ord?.status === "paid") {
          console.log(`Order ${orderId} já pago — evento ${event} ignorado`);
          return json({ received: true, ignored: "already_paid" });
        }

        await supabase.from("reservations")
          .update({ status: "canceled" })
          .eq("order_id", orderId)
          .neq("status", "confirmed");
        await supabase.from("booking_orders")
          .update({ status: event === "PAYMENT_REFUNDED" ? "canceled" : "expired" })
          .eq("id", orderId);

        console.log(`❌ Order ${orderId} liberado (evento ${event})`);
        return json({ received: true, processed: true });
      }

      return json({ received: true, ignored: event });
    }

    // ===== Fluxo legado (pedidos criados antes de booking_orders) =====
    let reservations: { id: string; status: string; user_id: string }[] | null = null;

    if (externalRef) {
      const ids = externalRef.split(",").map((s) => s.trim()).filter(Boolean);
      const { data } = await supabase
        .from("reservations").select("id, status, user_id").in("id", ids);
      if (data && data.length > 0) reservations = data as typeof reservations;
    }
    if (!reservations && checkoutSessionId) {
      const { data } = await supabase
        .from("reservations").select("id, status, user_id").eq("asaas_checkout_id", checkoutSessionId);
      if (data && data.length > 0) reservations = data as typeof reservations;
    }

    if (!reservations || reservations.length === 0) {
      console.error(`Nenhum pedido/reserva para ref=${externalRef} session=${checkoutSessionId}`);
      return json({ received: true, warning: "order_not_found" });
    }

    const reservationIds = reservations.map((r) => r.id);

    if (CONFIRM_EVENTS.has(event)) {
      const { data: existingPayment } = await supabase
        .from("payments").select("id").eq("transaction_id", transactionId).maybeSingle();

      let dbPaymentId: string;
      if (existingPayment) {
        dbPaymentId = existingPayment.id as string;
      } else {
        const { data: newPayment, error: payError } = await supabase
          .from("payments")
          .insert({
            user_id: reservations[0].user_id,
            reservation_id: reservations[0].id,
            amount: amountCents,
            status: "paid",
            transaction_id: transactionId,
            paid_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (payError || !newPayment) {
          // Corrida entre webhooks: o UNIQUE barrou, então já existe.
          const { data: retry } = await supabase
            .from("payments").select("id").eq("transaction_id", transactionId).maybeSingle();
          if (!retry) {
            console.error("Error creating payment:", payError?.message);
            return json({ received: true, error: "payment_create_error" });
          }
          dbPaymentId = retry.id as string;
        } else {
          dbPaymentId = newPayment.id as string;
        }
      }

      await supabase.from("reservations")
        .update({ status: "confirmed", payment_id: dbPaymentId })
        .in("id", reservationIds);

      console.log(`✅ [legado] ${reservationIds.length} reserva(s) via tx ${transactionId}`);
      await notifyTelegram(supabaseUrl, supabaseServiceKey, {
        type: "reservation",
        reservation_ids: reservationIds,
        transaction_id: transactionId,
        total_cents: amountCents,
        combo_applied: reservationIds.length >= 2,
      });
      return json({ received: true, processed: true, legacy: true });
    }

    if (CANCEL_EVENTS.has(event)) {
      const cancelable = reservations.filter((r) => r.status !== "confirmed").map((r) => r.id);
      if (cancelable.length > 0) {
        await supabase.from("reservations").update({ status: "canceled" }).in("id", cancelable);
        console.log(`❌ [legado] ${cancelable.length} reserva(s) canceladas (${event})`);
      }
      return json({ received: true, processed: true, legacy: true });
    }

    return json({ received: true, ignored: event });
  } catch (error: unknown) {
    console.error("Webhook error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return json({ error: message }, 500);
  }
});

/** Grava data/horário na descrição da cobrança (a Asaas não propaga a do checkout). */
async function updateAsaasDescription(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  asaasBaseUrl: string,
  asaasApiKey: string,
  orderId: string,
  transactionId: string,
) {
  try {
    const { data: rows } = await supabase
      .from("reservations")
      .select("class_date, classes(time)")
      .eq("order_id", orderId);

    const schedule = (rows || [])
      // deno-lint-ignore no-explicit-any
      .map((r: any) => {
        const [y, m, d] = (r.class_date || "").split("-");
        const dateBr = y && m && d ? `${d}/${m}` : "";
        const time = (r.classes?.time || "").slice(0, 5);
        return `${dateBr} ${time}`.trim();
      })
      .filter(Boolean);

    if (schedule.length === 0) return;
    // Respeita o limite de 150 caracteres da Asaas.
    const description = buildChargeDescription(schedule, { itemsCount: schedule.length });

    const resp = await fetch(`${asaasBaseUrl}/payments/${transactionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", access_token: asaasApiKey },
      body: JSON.stringify({ description }),
    });
    if (!resp.ok) console.error("Erro ao atualizar descrição na Asaas:", await resp.text());
  } catch (e) {
    console.error("updateAsaasDescription error:", e);
  }
}

/** Dispara notificação sem bloquear a resposta do webhook. */
async function notifyTelegram(
  supabaseUrl: string,
  serviceKey: string,
  payload: Record<string, unknown>,
) {
  try {
    await fetch(`${supabaseUrl}/functions/v1/telegram-notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        "x-internal-secret": Deno.env.get("INTERNAL_FUNCTION_SECRET") || "",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("telegram-notify dispatch error:", e);
  }
}
