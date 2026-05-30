import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function firstName(full: string | null | undefined): string {
  if (!full) return "";
  return full.trim().split(/\s+/)[0] || "";
}

function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const [u, d] = email.split("@");
  if (!d) return "";
  const head = u.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, u.length - 2))}@${d}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const reservationId = url.searchParams.get("id");
    if (!reservationId || !/^[0-9a-f-]{36}$/i.test(reservationId)) {
      return new Response(JSON.stringify({ error: "invalid_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: res } = await supabase
      .from("reservations")
      .select("id, status, class_id, user_id, class_date")
      .eq("id", reservationId)
      .maybeSingle();

    if (!res) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: user }, { data: cls }] = await Promise.all([
      supabase.from("users").select("name, email").eq("id", res.user_id).maybeSingle(),
      supabase.from("classes").select("title, time, price").eq("id", res.class_id).maybeSingle(),
    ]);

    return new Response(JSON.stringify({
      id: res.id,
      status: res.status,
      class_id: res.class_id,
      class_date: res.class_date,
      class_title: cls?.title || "Aula",
      class_time: (cls?.time || "").slice(0, 5),
      class_price: cls?.price ?? 0,
      user_first_name: firstName(user?.name),
      user_email_masked: maskEmail(user?.email),
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erro interno";
    console.error("get-reservation-public error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});