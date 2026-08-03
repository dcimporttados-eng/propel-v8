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

  // Require shared internal secret — prevents anyone on the internet from
  // triggering reservation cancellations (DoS / business logic abuse).
  const provided = req.headers.get("x-internal-secret") || "";
  const expected = Deno.env.get("INTERNAL_FUNCTION_SECRET") || "";
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1) Pedidos (booking_orders) vencidos: a RPC expira o pedido e libera as
    //    reservas numa única transação. As vagas, porém, já são liberadas na
    //    prática assim que expires_at passa — a disponibilidade filtra por isso.
    const { data: orderResult, error: orderError } = await supabase.rpc("expire_booking_orders");
    if (orderError) {
      console.error("expire_booking_orders failed:", orderError.message);
      throw orderError;
    }
    const orders = orderResult as { orders_expired: number; reservations_freed: number };

    // 2) Reservas legadas (sem pedido vinculado, anteriores a booking_orders):
    //    seguem a regra antiga, baseada em created_at.
    const legacyThreshold = new Date(Date.now() - 35 * 60 * 1000).toISOString();
    const { data: legacyExpired, error: fetchError } = await supabase
      .from("reservations")
      .select("id")
      .eq("status", "pending")
      .is("order_id", null)
      .lt("created_at", legacyThreshold);

    if (fetchError) {
      console.error("Error fetching legacy expired reservations:", fetchError.message);
      throw fetchError;
    }

    let legacyCanceled = 0;
    if (legacyExpired && legacyExpired.length > 0) {
      const ids = legacyExpired.map((r) => r.id);
      const { error: updateError } = await supabase
        .from("reservations")
        .update({ status: "canceled" })
        .in("id", ids);
      if (updateError) {
        console.error("Error canceling legacy reservations:", updateError.message);
        throw updateError;
      }
      legacyCanceled = ids.length;
    }

    const totalFreed = (orders?.reservations_freed || 0) + legacyCanceled;
    if (totalFreed > 0) {
      console.log(
        `Expirados: ${orders?.orders_expired || 0} pedido(s), ` +
        `${orders?.reservations_freed || 0} reserva(s) + ${legacyCanceled} legada(s)`
      );
    }

    return new Response(
      JSON.stringify({
        orders_expired: orders?.orders_expired || 0,
        reservations_freed: orders?.reservations_freed || 0,
        legacy_canceled: legacyCanceled,
        canceled: totalFreed,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Expire error:", error);
    const message = error instanceof Error ? error.message : "Erro interno";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
