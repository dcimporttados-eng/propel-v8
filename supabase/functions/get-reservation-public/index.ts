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
      .select("id, status, class_id, user_id, class_date, payment_id")
      .eq("id", reservationId)
      .maybeSingle();

    if (!res) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Combo: busca TODAS as reservas do mesmo pedido (mesmo payment_id) OU
    // do mesmo usuário criadas no mesmo segundo (pending sem payment ainda).
    let siblings: Array<{ id: string; status: string; class_id: string; class_date: string | null }> = [
      { id: res.id, status: res.status, class_id: res.class_id, class_date: res.class_date },
    ];
    if (res.payment_id) {
      const { data: sibs } = await supabase
        .from("reservations")
        .select("id, status, class_id, class_date")
        .eq("payment_id", res.payment_id);
      if (sibs && sibs.length > 0) siblings = sibs;
    }

    const classIds = [...new Set(siblings.map((s) => s.class_id))];
    const [{ data: user }, { data: classesData }] = await Promise.all([
      supabase.from("users").select("name, email").eq("id", res.user_id).maybeSingle(),
      supabase.from("classes").select("id, title, time, price").in("id", classIds),
    ]);
    const classesMap = new Map((classesData || []).map((c) => [c.id, c]));
    const cls = classesMap.get(res.class_id);

    const items = siblings
      .map((s) => {
        const c = classesMap.get(s.class_id);
        return {
          id: s.id,
          status: s.status,
          class_id: s.class_id,
          class_date: s.class_date,
          class_title: c?.title || "Aula",
          class_time: (c?.time || "").slice(0, 5),
          class_price: c?.price ?? 0,
        };
      })
      .sort((a, b) => (a.class_date || "").localeCompare(b.class_date || ""));

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
      items,
      combo: items.length > 1,
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