import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    console.log("Cakto webhook full payload:", JSON.stringify(body, null, 2));

    const eventType = body.event || body.type || body.event_type;
    const customerEmail = body.customer?.email || body.buyer?.email || body.email;
    const transactionId = String(body.order?.id || body.transaction?.id || body.id || "");

    const reservationId =
      body.src ||
      body.reservation_id ||
      body.metadata?.src ||
      body.metadata?.reservation_id ||
      body.extra?.src ||
      body.checkout_data?.src ||
      body.custom_fields?.src ||
      null;

    console.log("Extracted reservationId:", reservationId);
    console.log("Extracted customerEmail:", customerEmail);

    // Normalize amount (Cakto may send in reais, we store in centavos)
    const rawAmount = body.order?.amount || body.product?.price || body.amount || 0;
    const amount = rawAmount < 1000 ? Math.round(rawAmount * 100) : rawAmount;

    if (eventType === "purchase_approved") {
      let reservation = null;

      // Strategy 1: Find by reservation_id (most reliable)
      if (reservationId) {
        const { data } = await supabase
          .from("reservations")
          .select("id, class_id, user_id")
          .eq("id", reservationId)
          .eq("status", "pending")
          .maybeSingle();
        reservation = data;
      }

      // Strategy 2: Fallback to email lookup (with 24h window)
      if (!reservation && customerEmail) {
        const { data: user } = await supabase
          .from("users")
          .select("id")
          .eq("email", customerEmail)
          .maybeSingle();

        if (user) {
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const { data } = await supabase
            .from("reservations")
            .select("id, class_id, user_id")
            .eq("user_id", user.id)
            .eq("status", "pending")
            .gte("created_at", oneDayAgo)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          reservation = data;
        }
      }

      if (!reservation) {
        console.error("No pending reservation found for this payment");
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Create payment record
      const { data: payment, error: payError } = await supabase
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

      if (payError) {
        console.error("Error creating payment:", payError.message);
      }

      // Confirm reservation
      await supabase
        .from("reservations")
        .update({
          status: "confirmed",
          payment_id: payment?.id || null,
        })
        .eq("id", reservation.id);

      console.log(`Reservation ${reservation.id} confirmed via Cakto webhook`);
    }

    // Handle refund, chargeback, and cancellation
    if (["purchase_refunded", "purchase_chargeback", "purchase_canceled"].includes(eventType)) {
      let reservation = null;

      if (reservationId) {
        const { data } = await supabase
          .from("reservations")
          .select("id, user_id")
          .eq("id", reservationId)
          .in("status", ["pending", "confirmed"])
          .maybeSingle();
        reservation = data;
      }

      if (!reservation && transactionId) {
        const { data: payment } = await supabase
          .from("payments")
          .select("reservation_id, user_id")
          .eq("transaction_id", transactionId)
          .maybeSingle();
        
        if (payment) {
          reservation = { id: payment.reservation_id, user_id: payment.user_id };
        }
      }

      if (reservation) {
        await supabase
          .from("reservations")
          .update({ status: "canceled" })
          .eq("id", reservation.id);

        await supabase
          .from("payments")
          .update({ status: "failed" })
          .eq("reservation_id", reservation.id);

        console.log(`Reservation ${reservation.id} canceled due to ${eventType}`);
      } else {
        console.error(`No reservation found for ${eventType} event`);
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
