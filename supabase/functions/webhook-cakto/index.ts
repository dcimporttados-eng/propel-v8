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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    console.log("Cakto webhook received:", JSON.stringify(body));

    // Cakto sends event type in the payload
    const eventType = body.event || body.type || body.event_type;

    // We care about purchase_approved
    if (eventType === "purchase_approved") {
      const customerEmail = body.customer?.email || body.buyer?.email || body.email;
      const transactionId = String(body.order?.id || body.transaction?.id || body.id || "");

      if (!customerEmail) {
        console.error("No customer email in webhook payload");
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Find the user by email
      const { data: user } = await supabase
        .from("users")
        .select("id")
        .eq("email", customerEmail)
        .maybeSingle();

      if (!user) {
        console.error(`User not found for email: ${customerEmail}`);
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Find pending reservation for this user (most recent)
      const { data: reservation } = await supabase
        .from("reservations")
        .select("id, class_id")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!reservation) {
        console.error(`No pending reservation found for user ${user.id}`);
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Create payment record
      const { data: payment, error: payError } = await supabase
        .from("payments")
        .insert({
          user_id: user.id,
          reservation_id: reservation.id,
          amount: body.order?.amount || body.product?.price || 0,
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
