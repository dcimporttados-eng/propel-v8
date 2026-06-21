import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Endpoint público: aluno consulta as próprias reservas pelo e-mail ou telefone.
// Retorna apenas dados não-sensíveis (sem id de usuário, sem outros alunos).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { identifier } = await req.json();
    if (typeof identifier !== "string" || identifier.trim().length < 3) {
      return new Response(JSON.stringify({ error: "Identificador inválido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const clean = identifier.trim();
    const digits = clean.replace(/\D/g, "");

    // Match exato por email OU telefone (com tratamento do prefixo 55).
    // Match exato evita enumeração por substring de telefone (vazava cross-user).
    let users: { id: string }[] = [];
    if (clean.includes("@")) {
      const { data } = await supabase
        .from("users")
        .select("id")
        .ilike("email", clean.toLowerCase())
        .limit(5);
      users = data || [];
    } else if (digits.length >= 10) {
      // Normaliza removendo prefixo "55" se vier no formato internacional
      const local = digits.startsWith("55") && digits.length > 10 ? digits.substring(2) : digits;
      // Match exato em ambas as formas (com e sem 55) — sem ILIKE substring.
      const { data } = await supabase
        .from("users")
        .select("id")
        .in("phone", [local, `55${local}`])
        .limit(5);
      users = data || [];
    }

    if (users.length === 0) {
      return new Response(JSON.stringify({ reservations: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userIds = users.map((u) => u.id);
    const { data: resData } = await supabase
      .from("reservations")
      .select("id, class_date, status, class_id")
      .in("user_id", userIds)
      .neq("status", "canceled")
      .order("class_date", { ascending: false })
      .limit(50);

    const classIds = [...new Set((resData || []).map((r) => r.class_id))];
    const { data: classes } = await supabase.from("classes").select("id, title, time").in("id", classIds);
    const classMap = new Map((classes || []).map((c) => [c.id, c]));

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const reservations = (resData || [])
      .filter((r) => {
        if (!r.class_date) return true;
        const d = new Date(`${r.class_date}T12:00:00`);
        const isPast = d < today;
        if (isPast && r.status === "pending") return false;
        return true;
      })
      .map((r) => {
        const c = classMap.get(r.class_id);
        return {
          id: r.id,
          class_date: r.class_date,
          status: r.status,
          classes: { title: c?.title || "?", time: c?.time || "" },
        };
      });

    return new Response(JSON.stringify({ reservations }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro interno";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});