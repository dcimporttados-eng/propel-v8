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

  // Internal-only endpoint: must be called with the shared internal secret.
  const provided = req.headers.get("x-internal-secret") || "";
  const expected = Deno.env.get("INTERNAL_FUNCTION_SECRET") || "";
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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
      const todayBr = new Date(
        now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }),
      );
      const todayIso = `${todayBr.getFullYear()}-${String(todayBr.getMonth() + 1).padStart(2, "0")}-${String(todayBr.getDate()).padStart(2, "0")}`;
      const nowHHMM = `${String(todayBr.getHours()).padStart(2, "0")}:${String(todayBr.getMinutes()).padStart(2, "0")}`;

      // Buscar todas reservas confirmadas a partir de hoje
      const { data: reservas, error: errRes } = await supabase
        .from("reservations")
        .select("id, class_id, class_date, user_id, payment_id, classes(title, time, capacity), users(name, phone)")
        .eq("status", "confirmed")
        .gte("class_date", todayIso)
        .order("class_date", { ascending: true });

      if (errRes) throw new Error(`Erro ao buscar reservas: ${errRes.message}`);

      // Filtra aulas do dia que já passaram do horário
      const futuras = (reservas || []).filter((r: any) => {
        if (r.class_date > todayIso) return true;
        if (r.class_date < todayIso) return false;
        const t = (r.classes?.time || "00:00").slice(0, 5);
        return t >= nowHHMM;
      });

      // Valor arrecadado por dia (via payments)
      const paymentIds = Array.from(new Set(futuras.map((r: any) => r.payment_id).filter(Boolean)));
      const paymentsMap = new Map<string, any>();
      if (paymentIds.length > 0) {
        const { data: pays } = await supabase
          .from("payments")
          .select("id, amount")
          .in("id", paymentIds);
        for (const p of pays || []) paymentsMap.set(p.id, p);
      }

      // Agrupa por dia → por aula (class_id+time+title)
      type Aula = { time: string; title: string; capacity: number; alunos: { name: string; phone: string }[] };
      const porDia = new Map<string, { aulas: Map<string, Aula>; total: number; valor: number; pagamentosContados: Set<string> }>();

      for (const r of futuras) {
        const dia = r.class_date as string;
        if (!porDia.has(dia)) porDia.set(dia, { aulas: new Map(), total: 0, valor: 0, pagamentosContados: new Set() });
        const entry = porDia.get(dia)!;
        const t = (r.classes?.time || "").slice(0, 5);
        const titulo = r.classes?.title || "Aula";
        const key = `${t}__${titulo}`;
        if (!entry.aulas.has(key)) {
          entry.aulas.set(key, { time: t, title: titulo, capacity: r.classes?.capacity ?? 0, alunos: [] });
        }
        entry.aulas.get(key)!.alunos.push({
          name: r.users?.name || "—",
          phone: r.users?.phone || "",
        });
        entry.total++;
        // Valor: conta cada pagamento uma vez (combo = 1 pagamento p/ 2 reservas)
        if (r.payment_id && !entry.pagamentosContados.has(r.payment_id)) {
          const pay = paymentsMap.get(r.payment_id);
          if (pay?.amount) entry.valor += pay.amount;
          entry.pagamentosContados.add(r.payment_id);
        }
      }

      const dataBr = now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const horaBr = now.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

      const totalReservas = futuras.length;
      const totalValor = Array.from(porDia.values()).reduce((s, d) => s + d.valor, 0);

      const header =
        `📦 <b>Backup ${dataBr} às ${horaBr}</b>\n` +
        `<b>${totalReservas}</b> reserva(s) • <b>${porDia.size}</b> dia(s) • <b>${fmtMoney(totalValor)}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━`;

      const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
      const blocks: string[] = [];
      const diasOrdenados = Array.from(porDia.keys()).sort();

      for (const dia of diasOrdenados) {
        const entry = porDia.get(dia)!;
        const [yy, mm, dd] = dia.split("-").map(Number);
        const dow = DIAS_SEMANA[new Date(yy, mm - 1, dd).getDay()];
        let bloco = `\n📅 <b>${fmtDateBR(dia)} (${dow})</b> — ${entry.total} reserva(s) • ${fmtMoney(entry.valor)}\n`;
        bloco += `─────────────────────────────\n`;
        const aulasOrd = Array.from(entry.aulas.values()).sort((a, b) => a.time.localeCompare(b.time));
        for (const a of aulasOrd) {
          bloco += `🕐 <b>${a.time} ${escapeHtml(a.title)}</b> — ${a.alunos.length}/${a.capacity} vagas\n`;
          for (const al of a.alunos) {
            bloco += `  • ${escapeHtml(al.name)}${al.phone ? ` — ${escapeHtml(al.phone)}` : ""}\n`;
          }
        }
        blocks.push(bloco);
      }

      if (blocks.length === 0) {
        await sendTelegram(`${header}\n\nNenhuma reserva futura ativa.`);
        return new Response(JSON.stringify({ ok: true, sent: 0 }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Quebra em mensagens de até ~3800 chars (limite Telegram = 4096)
      const MAX = 3800;
      const messages: string[] = [];
      let current = header;
      for (const b of blocks) {
        if ((current + b).length > MAX) {
          messages.push(current);
          current = b.trimStart();
        } else {
          current += b;
        }
      }
      if (current) messages.push(current);

      let sent = 0;
      for (let i = 0; i < messages.length; i++) {
        const suffix = messages.length > 1 ? `\n\n<i>Parte ${i + 1}/${messages.length}</i>` : "";
        const r = await sendTelegram(messages[i] + suffix);
        if (r.ok) sent++;
        // pequena pausa para evitar rate limit
        if (i < messages.length - 1) await new Promise((res) => setTimeout(res, 400));
      }

      return new Response(JSON.stringify({ ok: true, sent, total: messages.length, reservas: futuras.length }), {
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
      (transactionId ? `\n🆔 Asaas: ${escapeHtml(transactionId)}` : "");

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