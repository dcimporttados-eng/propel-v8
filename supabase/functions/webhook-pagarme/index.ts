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
    console.log("Webhook received:", JSON.stringify(body));

    const eventType = body.type;

    if (eventType === "charge.paid" || eventType === "order.paid") {
      const charge = body.data;
      const chargeId = String(charge?.id || "");

      if (!chargeId) {
        console.error("No charge ID in webhook");
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Find payment by transaction_id
      const { data: payment, error: findError } = await supabase
        .from("payments")
        .select("id, reservation_id")
        .eq("transaction_id", chargeId)
        .maybeSingle();

      if (findError) {
        console.error("Error finding payment:", findError.message);
      }

      if (payment) {
        // Update payment status
        await supabase
          .from("payments")
          .update({ status: "paid", paid_at: new Date().toISOString() })
          .eq("id", payment.id);

        // Confirm reservation
        await supabase
          .from("reservations")
          .update({ status: "confirmed" })
          .eq("id", payment.reservation_id);

        console.log(`Payment ${payment.id} confirmed, reservation ${payment.reservation_id} activated`);
      } else {
        // Try matching by order ID from metadata
        const reservationId = charge?.metadata?.reservation_id;
        if (reservationId) {
          const { data: paymentByRes } = await supabase
            .from("payments")
            .select("id")
            .eq("reservation_id", reservationId)
            .maybeSingle();

          if (paymentByRes) {
            await supabase
              .from("payments")
              .update({ status: "paid", paid_at: new Date().toISOString(), transaction_id: chargeId })
              .eq("id", paymentByRes.id);

            await supabase
              .from("reservations")
              .update({ status: "confirmed" })
              .eq("id", reservationId);

            console.log(`Payment confirmed via metadata for reservation ${reservationId}`);
          }
        }
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
