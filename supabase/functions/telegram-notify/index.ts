import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fmtDateBR(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function fmtMoney(cents: number): string {
  return `R$${(cents / 100).toFixed(2).replace(".", ",")}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendTelegram(text: string) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) {
    console.error("TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não configurados");
    return { ok: false, error: "telegram_not_configured" };
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) console.error("Telegram error:", res.status, JSON.stringify(data));
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const payload = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const type = (payload.type as string) || (new URL(req.url).searchParams.get("type")) || "reservation";

    // ===== Backup diário =====
    if (type === "backup") {
      const now = new Date();
      // Janela: últimas 24h
      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("reservations")
        .select("id", { count: "exact", head: true })
        .eq("status", "confirmed")
        .gte("created_at", since);

      const { count: totalAtivas } = await supabase
        .from("reservations")
        .select("id", { count: "exact", head: true })
        .eq("status", "confirmed")
        .gte("class_date", new Date().toISOString().slice(0, 10));

      const dataBr = now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const horaBr = now.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

      const text =
        `📦 <b>Backup ${dataBr} às ${horaBr}</b>\n` +
        `Últimas 24h: <b>${count ?? 0}</b> reserva(s) confirmada(s)\n` +
        `Reservas futuras ativas: <b>${totalAtivas ?? 0}</b>`;

      const result = await sendTelegram(text);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ===== Notificação de reserva confirmada =====
    const reservationIds: string[] = Array.isArray(payload.reservation_ids)
      ? payload.reservation_ids
      : payload.reservation_id ? [payload.reservation_id] : [];
    const transactionId: string | null = payload.transaction_id || null;
    const totalCents: number | null = typeof payload.total_cents === "number" ? payload.total_cents : null;
    const comboApplied: boolean = !!payload.combo_applied;

    if (reservationIds.length === 0) {
      return new Response(JSON.stringify({ error: "reservation_ids obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: reservations, error } = await supabase
      .from("reservations")
      .select("id, class_date, classes(title, time), users(name, phone, email)")
      .in("id", reservationIds);

    if (error || !reservations || reservations.length === 0) {
      throw new Error(`Reservas não encontradas: ${error?.message}`);
    }

    const first = reservations[0] as any;
    const user = first.users;
    const linhasAulas = reservations
      .map((r: any) => {
        const t = (r.classes?.time || "").slice(0, 5);
        return `🗓️ ${fmtDateBR(r.class_date)} às ${t} — ${escapeHtml(r.classes?.title || "Aula")}`;
      })
      .join("\n");

    const valorLinha = totalCents != null
      ? `💰 ${fmtMoney(totalCents)}${comboApplied ? " (combo)" : ""}`
      : "";

    const text =
      `✅ <b>Reserva Confirmada</b>\n` +
      `👤 ${escapeHtml(user?.name || "")}\n` +
      (user?.phone ? `📱 ${escapeHtml(user.phone)}\n` : "") +
      (user?.email ? `✉️ ${escapeHtml(user.email)}\n` : "") +
      (valorLinha ? `${valorLinha}\n` : "") +
      `${linhasAulas}` +
      (transactionId ? `\n🆔 MP: ${escapeHtml(transactionId)}` : "");

    const result = await sendTelegram(text);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erro interno";
    console.error("telegram-notify error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});