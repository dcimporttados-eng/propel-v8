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

    // Clean up pending checkout attempts older than 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { data: expired, error: fetchError } = await supabase
      .from("reservations")
      .select("id")
      .eq("status", "pending")
      .lt("created_at", fiveMinutesAgo);

    if (fetchError) {
      console.error("Error fetching expired reservations:", fetchError.message);
      throw fetchError;
    }

    if (!expired || expired.length === 0) {
      console.log("No expired reservations found");
      return new Response(
        JSON.stringify({ canceled: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ids = expired.map((r) => r.id);

    const { error: updateError } = await supabase
      .from("reservations")
      .update({ status: "canceled" })
      .in("id", ids);

    if (updateError) {
      console.error("Error canceling reservations:", updateError.message);
      throw updateError;
    }

    console.log(`Canceled ${ids.length} expired reservations`);

    return new Response(
      JSON.stringify({ canceled: ids.length }),
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
