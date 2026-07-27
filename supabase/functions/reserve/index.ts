import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Promo "Combo 2 aulas por R$39,90" — válida até 01/07/2026
const PROMO_START = "2026-04-29";
const PROMO_END = "2026-07-01";
const COMBO_PRICE_CENTS = 3990; // R$39,90 total para 2 aulas
const REGULAR_PRICE_CENTS = 2990; // R$29,90 por aula

function isPromoActive(today = new Date()): boolean {
  const iso = today.toISOString().slice(0, 10);
  return iso >= PROMO_START && iso <= PROMO_END;
}

interface CartItem {
  class_id: string;
  class_date?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const asaasApiKey = Deno.env.get("ASAAS_API_KEY")!;
    // ASAAS_FEE_WALLET_ID não é mais usado em split explícito: a API key é da própria
    // agência, então o que não for enviado à cliente via split já fica automaticamente
    // na conta da agência — não há necessidade de um split "de volta para si mesmo".
    const asaasClientWalletId = Deno.env.get("ASAAS_CLIENT_WALLET_ID")!; // recebe a maior parte via split
    const asaasEnv = Deno.env.get("ASAAS_ENV") || "sandbox"; // "sandbox" ou "production"
    const asaasBaseUrl = asaasEnv === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload = await req.json();
    const { name, email, phone } = payload;

    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedPhone = typeof phone === "string" ? phone.replace(/\D/g, "") : "";

    // Aceita modo legado (class_id + class_date) ou novo (items[])
    let items: CartItem[] = [];
    if (Array.isArray(payload.items) && payload.items.length > 0) {
      items = payload.items
        .filter((it: CartItem) => it && typeof it.class_id === "string")
        .map((it: CartItem) => ({ class_id: it.class_id, class_date: it.class_date }));
    } else if (payload.class_id) {
      items = [{ class_id: payload.class_id, class_date: payload.class_date }];
    }

    if (items.length === 0 || !normalizedName || !normalizedEmail || !normalizedPhone) {
      return new Response(
        JSON.stringify({ error: "Campos obrigatórios: items, name, email, phone" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (items.length > 10) {
      return new Response(
        JSON.stringify({ error: "Máximo de 10 reservas por pedido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Detecta itens duplicados (mesma aula+data)
    const seen = new Set<string>();
    for (const it of items) {
      const key = `${it.class_id}_${it.class_date || ""}`;
      if (seen.has(key)) {
        return new Response(
          JSON.stringify({ error: "Há horários duplicados na seleção" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      seen.add(key);
    }

    // Verifica vagas e busca dados de cada aula em paralelo
    const enriched = await Promise.all(items.map(async (it) => {
      const rpcParams: Record<string, unknown> = { p_class_id: it.class_id };
      if (it.class_date) rpcParams.p_date = it.class_date;
      const [{ data: spots, error: spotsErr }, { data: cls, error: clsErr }] = await Promise.all([
        supabase.rpc("get_available_spots", rpcParams),
        supabase.from("classes").select("*").eq("id", it.class_id).single(),
      ]);
      if (spotsErr) throw new Error(`Erro ao verificar vagas: ${spotsErr.message}`);
      if (clsErr || !cls) throw new Error("Aula não encontrada");
      return { item: it, spots: spots as number, classData: cls };
    }));

    const lotada = enriched.find((e) => e.spots <= 0);
    if (lotada) {
      return new Response(
        JSON.stringify({ error: `Aula "${lotada.classData.title}" lotada` }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ===== Cálculo de preço (server-side, fonte da verdade) =====
    // Regra: combo R$39,90 nas 2 aulas mais baratas se houver 2+ itens e promo ativa.
    // Demais aulas: R$29,90 cada.
    const promoActive = isPromoActive();
    const sortedByPriceAsc = [...enriched].sort(
      (a, b) => (a.classData.price || REGULAR_PRICE_CENTS) - (b.classData.price || REGULAR_PRICE_CENTS)
    );
    const comboIds = new Set<string>();
    let totalCents = 0;
    if (promoActive && enriched.length >= 2) {
      // 2 mais baratas viram combo
      comboIds.add(`${sortedByPriceAsc[0].item.class_id}_${sortedByPriceAsc[0].item.class_date || ""}`);
      comboIds.add(`${sortedByPriceAsc[1].item.class_id}_${sortedByPriceAsc[1].item.class_date || ""}`);
      totalCents += COMBO_PRICE_CENTS;
      for (let i = 2; i < sortedByPriceAsc.length; i++) {
        totalCents += sortedByPriceAsc[i].classData.price || REGULAR_PRICE_CENTS;
      }
    } else {
      for (const e of enriched) {
        totalCents += e.classData.price || REGULAR_PRICE_CENTS;
      }
    }

    // Create or find user
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .ilike("email", normalizedEmail)
      .maybeSingle();

    let userId: string;
    if (existingUser) {
      userId = existingUser.id;
      await supabase.from("users").update({ name: normalizedName, phone: normalizedPhone }).eq("id", userId);
    } else {
      const { data: newUser, error: userError } = await supabase
        .from("users")
        .insert({ name: normalizedName, email: normalizedEmail, phone: normalizedPhone })
        .select("id")
        .single();
      if (userError || !newUser) throw new Error(`Erro ao criar usuário: ${userError?.message}`);
      userId = newUser.id;
    }

    // Cria N reservas pendentes — marca combo_aplicado nas que entraram no combo
    const rowsToInsert = enriched.map((e) => {
      const key = `${e.item.class_id}_${e.item.class_date || ""}`;
      const row: Record<string, unknown> = {
        user_id: userId,
        class_id: e.item.class_id,
        status: "pending",
        combo_aplicado: comboIds.has(key),
      };
      if (e.item.class_date) row.class_date = e.item.class_date;
      return row;
    });

    const { data: createdReservations, error: resError } = await supabase
      .from("reservations")
      .insert(rowsToInsert)
      .select("id");

    if (resError || !createdReservations || createdReservations.length === 0) {
      throw new Error(`Erro ao criar reservas: ${resError?.message}`);
    }

    const reservationIds = createdReservations.map((r) => r.id);
    // external_reference no formato CSV — webhook itera sobre todos
    const externalReference = reservationIds.join(",");

    // Create Asaas Checkout (com split de R$1,00 fixo para a conta do Pavilhão 8)
    const totalDecimal = totalCents / 100;

    const isCombo = promoActive && enriched.length >= 2;
    const itemsTitle = isCombo
      ? `Combo 2 aulas + ${enriched.length - 2} avulsa(s)`.replace(" + 0 avulsa(s)", "")
      : enriched.length === 1
        ? `${enriched[0].classData.title} — ${enriched[0].item.class_date || ""}`
        : `${enriched.length} aulas — Pavilhão 8`;

    // Asaas desconta a própria taxa (cartão/Pix) ANTES de aplicar os splits, e o valor
    // final da taxa só é conhecido depois que o cliente escolhe o método de pagamento.
    // Reserva-se uma margem de segurança (cobrindo o pior caso — taxa de cartão) para o
    // split não ultrapassar o valor líquido a receber. A conta dona da API key (agência)
    // fica automaticamente com o que sobrar do split da cliente, ou seja, o mínimo garantido
    // pra agência é R$1,00, podendo ser um pouco mais dependendo da taxa real cobrada.
    const feeBuffer = Math.max(1.2, totalDecimal * 0.05);
    const clientSplitValue = Math.max(0, Math.round((totalDecimal - 1.0 - feeBuffer) * 100) / 100);
    const splits = clientSplitValue > 0
      ? [{ walletId: asaasClientWalletId, fixedValue: clientSplitValue }]
      : [];

    const checkoutPayload = {
      billingTypes: ["PIX", "CREDIT_CARD"],
      chargeTypes: ["DETACHED"],
      minutesToExpire: 30,
      callback: {
        successUrl: `https://propel-v8.lovable.app/confirmacao?src=${reservationIds[0]}&status=approved`,
        cancelUrl: `https://propel-v8.lovable.app/confirmacao?src=${reservationIds[0]}&status=failed`,
        expiredUrl: `https://propel-v8.lovable.app/confirmacao?src=${reservationIds[0]}&status=pending`,
      },
      items: [
        {
          name: itemsTitle,
          description: `Reserva Pavilhão 8 — ${normalizedName}`,
          quantity: 1,
          value: totalDecimal,
        },
      ],
      splits,
      externalReference,
    };

    const asaasResponse = await fetch(`${asaasBaseUrl}/checkouts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        access_token: asaasApiKey,
      },
      body: JSON.stringify(checkoutPayload),
    });

    if (!asaasResponse.ok) {
      const errBody = await asaasResponse.text();
      console.error(`Asaas checkout error ${asaasResponse.status}: ${errBody}`);
      throw new Error("Erro ao gerar link de pagamento");
    }

    const asaasData = await asaasResponse.json();
    const checkoutUrl = asaasData.link || asaasData.url || asaasData.checkoutUrl;
    console.log("Asaas checkout created:", asaasData.id, "url:", checkoutUrl);

    return new Response(
      JSON.stringify({
        reservation_id: reservationIds[0],
        reservation_ids: reservationIds,
        checkout_url: checkoutUrl,
        class_title: itemsTitle,
        total_cents: totalCents,
        combo_applied: isCombo,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Reserve error:", error);
    const message = error instanceof Error ? error.message : "Erro interno";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
