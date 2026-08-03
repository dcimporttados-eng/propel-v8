import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REGULAR_PRICE_CENTS = 2990; // R$29,90 por aula

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
    const { name, email, phone, cpfCnpj, postalCode, address, addressNumber, complement, province } = payload;

    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedPhone = typeof phone === "string" ? phone.replace(/\D/g, "") : "";
    const normalizedCpfCnpj = typeof cpfCnpj === "string" ? cpfCnpj.replace(/\D/g, "") : "";
    const normalizedPostalCode = typeof postalCode === "string" ? postalCode.replace(/\D/g, "") : "";
    const normalizedAddress = typeof address === "string" ? address.trim() : "";
    const normalizedAddressNumber = typeof addressNumber === "string" ? addressNumber.trim() : "";
    const normalizedComplement = typeof complement === "string" ? complement.trim() : "";
    const normalizedProvince = typeof province === "string" ? province.trim() : "";

    // Aceita modo legado (class_id + class_date) ou novo (items[])
    let items: CartItem[] = [];
    if (Array.isArray(payload.items) && payload.items.length > 0) {
      items = payload.items
        .filter((it: CartItem) => it && typeof it.class_id === "string")
        .map((it: CartItem) => ({ class_id: it.class_id, class_date: it.class_date }));
    } else if (payload.class_id) {
      items = [{ class_id: payload.class_id, class_date: payload.class_date }];
    }

    if (
      items.length === 0 || !normalizedName || !normalizedEmail || !normalizedPhone ||
      !normalizedPostalCode || !normalizedAddress || !normalizedAddressNumber || !normalizedProvince ||
      (normalizedCpfCnpj.length !== 11 && normalizedCpfCnpj.length !== 14)
    ) {
      return new Response(
        JSON.stringify({ error: "Campos obrigatórios: items, name, email, phone, cpfCnpj, postalCode, address, addressNumber, province" }),
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
    let totalCents = 0;
    for (const e of enriched) {
      totalCents += e.classData.price || REGULAR_PRICE_CENTS;
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

    // Cria N reservas pendentes
    const rowsToInsert = enriched.map((e) => {
      const row: Record<string, unknown> = {
        user_id: userId,
        class_id: e.item.class_id,
        status: "pending",
        combo_aplicado: false,
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

    const itemsTitle = enriched.length === 1
      ? `${enriched[0].classData.title} — ${enriched[0].item.class_date || ""}`
      : `${enriched.length} aulas — Pavilhão 8`;

    // Data(s)/horário(s) da(s) aula(s) reservada(s), pra aparecer na descrição da cobrança na Asaas
    const scheduleDesc = enriched
      .map((e) => {
        const [y, m, d] = (e.item.class_date || "").split("-");
        const dateBr = y && m && d ? `${d}/${m}` : "";
        const time = (e.classData.time || "").slice(0, 5);
        return `${dateBr} ${time}`.trim();
      })
      .filter(Boolean)
      .join(", ");

    // Asaas desconta a própria taxa (cartão/Pix) ANTES de aplicar os splits, e o valor
    // final da taxa só é conhecido depois que o cliente escolhe o método de pagamento.
    // Reserva-se uma margem de segurança (cobrindo o pior caso — taxa de cartão) para o
    // split não ultrapassar o valor líquido a receber. A conta dona da API key (agência)
    // fica automaticamente com o que sobrar do split da cliente — o alvo é ~R$0,70 de
    // comissão pra agência (pode variar um pouco pra mais ou menos dependendo da taxa real).
    const AGENCY_TARGET = 0.7;
    const feeBuffer = Math.max(1.1, totalDecimal * 0.037);
    const clientSplitValue = Math.max(0, Math.round((totalDecimal - AGENCY_TARGET - feeBuffer) * 100) / 100);
    const splits = clientSplitValue > 0
      ? [{ walletId: asaasClientWalletId, fixedValue: clientSplitValue }]
      : [];

    const checkoutPayload = {
      billingTypes: ["PIX", "CREDIT_CARD"],
      chargeTypes: ["DETACHED"],
      minutesToExpire: 30,
      callback: {
        successUrl: `https://pavilhao8.com.br/confirmacao?src=${reservationIds[0]}&status=approved`,
        cancelUrl: `https://pavilhao8.com.br/confirmacao?src=${reservationIds[0]}&status=failed`,
        expiredUrl: `https://pavilhao8.com.br/confirmacao?src=${reservationIds[0]}&status=pending`,
      },
      items: [
        {
          name: itemsTitle,
          description: `Reserva Pavilhão 8 — ${normalizedName}${scheduleDesc ? ` — ${scheduleDesc}` : ""}`,
          quantity: 1,
          value: totalDecimal,
        },
      ],
      customerData: {
        name: normalizedName,
        email: normalizedEmail,
        phone: normalizedPhone,
        cpfCnpj: normalizedCpfCnpj,
        postalCode: normalizedPostalCode,
        address: normalizedAddress,
        addressNumber: normalizedAddressNumber,
        complement: normalizedComplement || undefined,
        province: normalizedProvince,
      },
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

    // A Asaas não propaga o externalReference da CheckoutSession pro Payment gerado
    // ao concluir o pagamento — guardamos o ID da sessão como plano B para o webhook.
    if (asaasData.id) {
      await supabase.from("reservations").update({ asaas_checkout_id: asaasData.id }).in("id", reservationIds);
    }

    return new Response(
      JSON.stringify({
        reservation_id: reservationIds[0],
        reservation_ids: reservationIds,
        checkout_url: checkoutUrl,
        class_title: itemsTitle,
        total_cents: totalCents,
        combo_applied: false,
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
