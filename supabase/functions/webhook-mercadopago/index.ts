import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // MP sends GET requests for webhook validation
  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    console.log("MP webhook payload:", JSON.stringify(body, null, 2));

    // Mercado Pago sends IPN notifications with type and data.id
    // We only care about payment notifications
    if (body.type !== "payment" && body.action !== "payment.created" && body.action !== "payment.updated") {
      console.log(`Ignored webhook type: ${body.type} action: ${body.action}`);
      return new Response(JSON.stringify({ received: true, ignored: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get payment ID from the notification
    const paymentId = body.data?.id;
    if (!paymentId) {
      console.log("No payment ID in webhook");
      return new Response(JSON.stringify({ received: true, warning: "no_payment_id" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch payment details from Mercado Pago API
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${mpAccessToken}` },
    });

    if (!mpResponse.ok) {
      const errText = await mpResponse.text();
      console.error(`MP API error ${mpResponse.status}: ${errText}`);
      return new Response(JSON.stringify({ received: true, error: "mp_api_error" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payment = await mpResponse.json();
    console.log("MP payment details:", JSON.stringify({
      id: payment.id,
      status: payment.status,
      external_reference: payment.external_reference,
      transaction_amount: payment.transaction_amount,
      payer_email: payment.payer?.email,
    }));

    const externalRef = payment.external_reference as string | null;
    const mpStatus = payment.status; // approved, pending, rejected, cancelled, refunded
    const amount = Math.round((payment.transaction_amount || 0) * 100); // MP uses decimal, convert to cents
    const transactionId = String(payment.id);
    const payerEmail = payment.payer?.email?.toLowerCase() || null;

    if (!externalRef) {
      console.error("No external_reference (reservation_id) in MP payment");
      return new Response(JSON.stringify({ received: true, warning: "no_reservation_ref" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // external_reference pode ser CSV (combo/múltiplas reservas) ou ID único (legado)
    const reservationIds = externalRef.split(",").map((s) => s.trim()).filter(Boolean);

    const { data: reservations, error: resError } = await supabase
      .from("reservations")
      .select("id, class_id, user_id, status")
      .in("id", reservationIds);

    if (resError || !reservations || reservations.length === 0) {
      console.error(`Reservations [${externalRef}] not found: ${resError?.message}`);
      return new Response(JSON.stringify({ received: true, warning: "reservation_not_found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mpStatus === "approved") {
      // Cria/atualiza um único payment vinculado à PRIMEIRA reserva como referência
      // (todas as reservas do pedido apontam pro mesmo transaction_id via payment_id)
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

      // Confirma TODAS as reservas do pedido
      await supabase.from("reservations").update({
        status: "confirmed",
        payment_id: dbPaymentId,
      }).in("id", reservationIds);

      console.log(`✅ ${reservationIds.length} reserva(s) confirmada(s) via MP payment ${transactionId}`);

      // Notificação Telegram (fire-and-forget — nunca bloqueia resposta pro MP)
      try {
        const notifyUrl = `${supabaseUrl}/functions/v1/telegram-notify`;
        fetch(notifyUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
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

    } else if (mpStatus === "refunded" || mpStatus === "cancelled" || mpStatus === "rejected") {
      // Só cancela as que ainda não estão confirmadas
      const cancelable = reservations.filter((r) => r.status !== "confirmed").map((r) => r.id);
      const alreadyConfirmed = reservations.filter((r) => r.status === "confirmed");
      if (alreadyConfirmed.length > 0) {
        console.log(`⚠️ ${alreadyConfirmed.length} reserva(s) já confirmada(s) — ignoradas no ${mpStatus}`);
      }
      if (cancelable.length > 0) {
        await supabase.from("reservations").update({ status: "canceled" }).in("id", cancelable);
        console.log(`❌ ${cancelable.length} reserva(s) cancelada(s) (MP status: ${mpStatus})`);
      }
    } else {
      console.log(`⏳ Payment ${transactionId} status: ${mpStatus} — no action taken`);
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
