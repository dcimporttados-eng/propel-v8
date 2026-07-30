import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, asaas-access-token",
};

const CONFIRM_EVENTS = new Set(["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"]);
const CANCEL_EVENTS = new Set(["PAYMENT_OVERDUE", "PAYMENT_REFUNDED", "PAYMENT_DELETED"]);

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
    const asaasBaseUrl = asaasEnv === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Valida que a notificação realmente veio do Asaas
    const receivedToken = req.headers.get("asaas-access-token");
    if (!webhookToken || receivedToken !== webhookToken) {
      console.error("Invalid or missing asaas-access-token header");
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    console.log("Asaas webhook payload:", JSON.stringify(body, null, 2));

    const event = body.event as string | undefined;
    const payment = body.payment;

    if (!event || !payment) {
      return new Response(JSON.stringify({ received: true, ignored: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const externalRef = payment.externalReference as string | null;
    const checkoutSessionId = payment.checkoutSession as string | null;
    const amount = Math.round((payment.value || 0) * 100); // Asaas usa decimal, converte para centavos
    const transactionId = String(payment.id);

    // externalReference pode ser CSV (combo/múltiplas reservas) ou ID único.
    // A Asaas nem sempre propaga o externalReference da CheckoutSession pro Payment —
    // nesse caso, cai pro plano B: casar pelo checkoutSession que salvamos na reserva.
    type ReservationRow = {
      id: string;
      class_id: string;
      user_id: string;
      status: string;
      class_date: string | null;
      classes: { time: string; title: string } | null;
    };
    let reservations: ReservationRow[] | null = null;
    const SELECT_COLS = "id, class_id, user_id, status, class_date, classes(time, title)";

    if (externalRef) {
      const reservationIds = externalRef.split(",").map((s) => s.trim()).filter(Boolean);
      const { data } = await supabase
        .from("reservations")
        .select(SELECT_COLS)
        .in("id", reservationIds);
      if (data && data.length > 0) reservations = data as unknown as ReservationRow[];
    }

    if (!reservations && checkoutSessionId) {
      const { data } = await supabase
        .from("reservations")
        .select(SELECT_COLS)
        .eq("asaas_checkout_id", checkoutSessionId);
      if (data && data.length > 0) reservations = data as unknown as ReservationRow[];
    }

    if (!reservations || reservations.length === 0) {
      console.error(`No reservations found for externalRef=${externalRef} checkoutSession=${checkoutSessionId}`);
      return new Response(JSON.stringify({ received: true, warning: "reservation_not_found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const reservationIds = reservations.map((r) => r.id);

    if (CONFIRM_EVENTS.has(event)) {
      const firstReservation = reservations[0];

      const { data: existingPayment } = await supabase
        .from("payments")
        .select("id")
        .eq("transaction_id", transactionId)
        .maybeSingle();

      let dbPaymentId: string;
      if (existingPayment) {
        dbPaymentId = existingPayment.id;
        await supabase.from("payments").update({
          status: "paid",
          amount,
          paid_at: new Date().toISOString(),
        }).eq("id", dbPaymentId);
      } else {
        const { data: newPayment, error: payError } = await supabase
          .from("payments")
          .insert({
            user_id: firstReservation.user_id,
            reservation_id: firstReservation.id,
            amount, // valor TOTAL pago (combo já considerado)
            status: "paid",
            transaction_id: transactionId,
            paid_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (payError || !newPayment) {
          console.error("Error creating payment:", payError?.message);
          return new Response(JSON.stringify({ received: true, error: "payment_create_error" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        dbPaymentId = newPayment.id;
      }

      await supabase.from("reservations").update({
        status: "confirmed",
        payment_id: dbPaymentId,
      }).in("id", reservationIds);

      console.log(`✅ ${reservationIds.length} reserva(s) confirmada(s) via Asaas payment ${transactionId}`);

      // A Asaas não propaga a descrição do item da CheckoutSession pro Payment final —
      // atualiza a descrição do pagamento direto pela API, já com data/horário da reserva.
      try {
        const scheduleDesc = reservations
          .map((r) => {
            const [y, m, d] = (r.class_date || "").split("-");
            const dateBr = y && m && d ? `${d}/${m}` : "";
            const time = (r.classes?.time || "").slice(0, 5);
            return `${dateBr} ${time}`.trim();
          })
          .filter(Boolean)
          .join(", ");
        if (scheduleDesc) {
          const descResp = await fetch(`${asaasBaseUrl}/payments/${transactionId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", access_token: asaasApiKey },
            body: JSON.stringify({ description: `Reserva Pavilhão 8 — ${scheduleDesc}` }),
          });
          if (!descResp.ok) {
            console.error("Erro ao atualizar descrição do pagamento na Asaas:", await descResp.text());
          }
        }
      } catch (e) {
        console.error("Erro ao atualizar descrição do pagamento:", e);
      }

      try {
        const notifyUrl = `${supabaseUrl}/functions/v1/telegram-notify`;
        fetch(notifyUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
            "x-internal-secret": Deno.env.get("INTERNAL_FUNCTION_SECRET") || "",
          },
          body: JSON.stringify({
            type: "reservation",
            reservation_ids: reservationIds,
            transaction_id: transactionId,
            total_cents: amount,
            combo_applied: reservationIds.length >= 2,
          }),
        }).catch((e) => console.error("telegram-notify dispatch error:", e));
      } catch (e) {
        console.error("telegram-notify trigger error:", e);
      }
    } else if (CANCEL_EVENTS.has(event)) {
      const cancelable = reservations.filter((r) => r.status !== "confirmed").map((r) => r.id);
      const alreadyConfirmed = reservations.filter((r) => r.status === "confirmed");
      if (alreadyConfirmed.length > 0) {
        console.log(`⚠️ ${alreadyConfirmed.length} reserva(s) já confirmada(s) — ignoradas no evento ${event}`);
      }
      if (cancelable.length > 0) {
        await supabase.from("reservations").update({ status: "canceled" }).in("id", cancelable);
        console.log(`❌ ${cancelable.length} reserva(s) cancelada(s) (evento Asaas: ${event})`);
      }
    } else {
      console.log(`⏳ Evento ${event} não tratado — nenhuma ação tomada`);
    }

    return new Response(JSON.stringify({ received: true, processed: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Webhook error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
