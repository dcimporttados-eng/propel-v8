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

    const reservationId = payment.external_reference;
    const mpStatus = payment.status; // approved, pending, rejected, cancelled, refunded
    const amount = Math.round((payment.transaction_amount || 0) * 100); // MP uses decimal, convert to cents
    const transactionId = String(payment.id);
    const payerEmail = payment.payer?.email?.toLowerCase() || null;

    if (!reservationId) {
      console.error("No external_reference (reservation_id) in MP payment");
      return new Response(JSON.stringify({ received: true, warning: "no_reservation_ref" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the reservation
    const { data: reservation, error: resError } = await supabase
      .from("reservations")
      .select("id, class_id, user_id, status")
      .eq("id", reservationId)
      .maybeSingle();

    if (resError || !reservation) {
      console.error(`Reservation ${reservationId} not found: ${resError?.message}`);
      return new Response(JSON.stringify({ received: true, warning: "reservation_not_found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mpStatus === "approved") {
      // Check if payment already exists
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
          paid_at: new Date().toISOString(),
        }).eq("id", dbPaymentId);
      } else {
        const { data: newPayment, error: payError } = await supabase
          .from("payments")
          .insert({
            user_id: reservation.user_id,
            reservation_id: reservation.id,
            amount,
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

      // Confirm the reservation
      await supabase.from("reservations").update({
        status: "confirmed",
        payment_id: dbPaymentId,
      }).eq("id", reservation.id);

      console.log(`✅ Reservation ${reservation.id} confirmed via Mercado Pago payment ${transactionId}`);

    } else if (mpStatus === "refunded" || mpStatus === "cancelled" || mpStatus === "rejected") {
      // Cancel the reservation
      await supabase.from("reservations").update({ status: "canceled" }).eq("id", reservation.id);
      console.log(`❌ Reservation ${reservation.id} canceled (MP status: ${mpStatus})`);

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
