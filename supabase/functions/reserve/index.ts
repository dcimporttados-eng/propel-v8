import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AGENCY_FEE_CENTS_PER_ITEM,
  CAMPAIGN,
  DEFAULT_PRICE_CENTS,
  MAX_ITEMS_PER_ORDER,
  ORDER_TTL_MINUTES,
  buildChargeDescription,
  computeCardSplitCents,
  computeExactPixSplitCents,
  getDiscountPercent,
} from "../_shared/campaign.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface CartItem {
  class_id: string;
  class_date?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Traduz os erros das RPCs para mensagens que o cliente entende. */
function friendlyError(message: string): { text: string; status: number } {
  if (message.includes("NO_SEATS:")) {
    const detail = message.split("NO_SEATS:")[1]?.split("\n")[0]?.trim() || "";
    return { text: `Sem vaga disponível: ${detail}. Escolha outro horário.`, status: 409 };
  }
  if (message.includes("CLASS_DISABLED:")) {
    return { text: "Um dos horários escolhidos não está mais disponível.", status: 409 };
  }
  if (message.includes("CLASS_NOT_FOUND")) return { text: "Aula não encontrada", status: 404 };
  if (message.includes("EMPTY_ORDER")) return { text: "Pedido sem itens", status: 400 };
  return { text: "Erro ao criar reserva", status: 500 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let createdOrderId: string | null = null;
  let supabaseForCleanup: ReturnType<typeof createClient> | null = null;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const asaasApiKey = Deno.env.get("ASAAS_API_KEY")!;
    // A API key é da própria agência: o que não for enviado à cliente via split
    // já fica automaticamente na conta da agência.
    const asaasClientWalletId = Deno.env.get("ASAAS_CLIENT_WALLET_ID")!;
    const asaasEnv = Deno.env.get("ASAAS_ENV") || "sandbox";
    const asaasBaseUrl = asaasEnv === "production"
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    supabaseForCleanup = supabase;

    const payload = await req.json();
    const { name, email, phone, cpfCnpj, postalCode, address, addressNumber, complement, province } = payload;
    const paymentMethod = payload.paymentMethod === "CREDIT_CARD" ? "CREDIT_CARD" : "PIX";

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
      return json({
        error: "Campos obrigatórios: items, name, email, phone, cpfCnpj, postalCode, address, addressNumber, province",
      }, 400);
    }

    if (items.length > MAX_ITEMS_PER_ORDER) {
      return json({ error: `Máximo de ${MAX_ITEMS_PER_ORDER} reservas por pedido` }, 400);
    }

    if (items.some((it) => !it.class_date)) {
      return json({ error: "Toda aula precisa de uma data" }, 400);
    }

    // Duplicados no mesmo pedido
    const seen = new Set<string>();
    for (const it of items) {
      const key = `${it.class_id}_${it.class_date}`;
      if (seen.has(key)) {
        return json({ error: "Há horários duplicados na seleção" }, 400);
      }
      seen.add(key);
    }

    // ===== Usuário =====
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .ilike("email", normalizedEmail)
      .maybeSingle();

    let userId: string;
    if (existingUser) {
      userId = existingUser.id as string;
      await supabase.from("users").update({ name: normalizedName, phone: normalizedPhone }).eq("id", userId);
    } else {
      const { data: newUser, error: userError } = await supabase
        .from("users")
        .insert({ name: normalizedName, email: normalizedEmail, phone: normalizedPhone })
        .select("id")
        .single();
      if (userError || !newUser) throw new Error(`Erro ao criar usuário: ${userError?.message}`);
      userId = newUser.id as string;
    }

    // ===== Pedido (atômico) =====
    // A RPC valida TODAS as vagas sob lock, cria o pedido e as reservas numa
    // única transação. Qualquer horário indisponível => nada é criado.
    const discountPercent = getDiscountPercent(items.length);

    const { data: orderData, error: orderError } = await supabase.rpc("create_booking_order", {
      p_user_id: userId,
      p_items: items.map((it) => ({ class_id: it.class_id, class_date: it.class_date })),
      p_campaign_id: CAMPAIGN.id,
      p_discount_percent: discountPercent,
      p_ttl_minutes: ORDER_TTL_MINUTES,
      p_default_price: DEFAULT_PRICE_CENTS,
    });

    if (orderError) {
      const { text, status } = friendlyError(orderError.message || "");
      console.error("create_booking_order failed:", orderError.message);
      return json({ error: text }, status);
    }

    const order = orderData as {
      order_id: string;
      items_count: number;
      subtotal_cents: number;
      discount_percent: number;
      discount_cents: number;
      total_cents: number;
      reservation_ids: string[];
    };
    createdOrderId = order.order_id;

    const reservationIds = order.reservation_ids || [];
    const totalCents = order.total_cents;

    // ===== Dados para o checkout =====
    const { data: classRows } = await supabase
      .from("classes")
      .select("id, title, time")
      .in("id", items.map((it) => it.class_id));
    const classMap = new Map((classRows || []).map((c) => [c.id as string, c]));

    const itemsTitle = items.length === 1
      ? `${classMap.get(items[0].class_id)?.title || "Aula"} — ${items[0].class_date}`
      : `${items.length} aulas — Pavilhão 8`;

    const schedule = items
      .map((it) => {
        const [y, m, d] = (it.class_date || "").split("-");
        const dateBr = y && m && d ? `${d}/${m}` : "";
        const time = ((classMap.get(it.class_id)?.time as string) || "").slice(0, 5);
        return `${dateBr} ${time}`.trim();
      })
      .filter(Boolean);

    // A Asaas limita description a 150 caracteres — o helper compacta se preciso.
    const chargeDescription = buildChargeDescription(schedule, {
      customerName: normalizedName,
      itemsCount: order.items_count,
      discountPercent: order.discount_percent,
    });

    // ===== Cobrança Asaas =====
    // Pix: cobrança direta pela API de pagamentos, com a taxa fixa e conhecida
    // de antemão — o split fecha exato, sem sobra pra agência.
    // Cartão: continua no Checkout hospedado da Asaas (dados do cartão nunca
    // passam pelo nosso servidor); a taxa real só é conhecida depois do
    // pagamento, então reservamos o pior caso e retentamos com folga maior se
    // a Asaas recusar o split.
    let checkoutUrl: string | null = null;
    let asaasTxId: string | null = null;

    if (paymentMethod === "PIX") {
      const asaasHeaders = { "Content-Type": "application/json", access_token: asaasApiKey };

      // Busca ou cria o cliente na Asaas (a API de pagamento direto exige um customer ID).
      const searchResp = await fetch(
        `${asaasBaseUrl}/customers?cpfCnpj=${normalizedCpfCnpj}`,
        { headers: asaasHeaders },
      );
      const searchData = searchResp.ok ? await searchResp.json() : { data: [] };
      let customerId = (searchData.data && searchData.data[0]?.id) as string | undefined;

      if (!customerId) {
        const customerResp = await fetch(`${asaasBaseUrl}/customers`, {
          method: "POST",
          headers: asaasHeaders,
          body: JSON.stringify({
            name: normalizedName,
            email: normalizedEmail,
            phone: normalizedPhone,
            cpfCnpj: normalizedCpfCnpj,
            postalCode: normalizedPostalCode,
            address: normalizedAddress,
            addressNumber: normalizedAddressNumber,
            complement: normalizedComplement || undefined,
            province: normalizedProvince,
            // Evita SMS/WhatsApp cobrados pela Asaas — as notificações de
            // status ficam por conta do nosso Telegram/webhook.
            notificationDisabled: true,
          }),
        });
        if (!customerResp.ok) {
          console.error("Asaas customer create error:", await customerResp.text());
        } else {
          const customerData = await customerResp.json();
          customerId = customerData.id as string;
        }
      }

      if (customerId) {
        const dueDate = new Date().toISOString().slice(0, 10);
        const createPixPayment = (splitCents: number) =>
          fetch(`${asaasBaseUrl}/payments`, {
            method: "POST",
            headers: asaasHeaders,
            body: JSON.stringify({
              customer: customerId,
              billingType: "PIX",
              value: totalCents / 100,
              dueDate,
              description: chargeDescription,
              splits: splitCents > 0
                ? [{ walletId: asaasClientWalletId, fixedValue: splitCents / 100 }]
                : [],
              externalReference: order.order_id,
              // A Asaas exige domínio cadastrado em "Minha Conta" pra aceitar
              // callback/autoRedirect na API de pagamento direto — sem isso ela
              // recusa a cobrança inteira. A confirmação da reserva não depende
              // disso (o webhook já cuida), então deixamos de fora por ora.
            }),
          });

        // 1ª tentativa com a taxa Pix do config. Se a Asaas recusar o split,
        // ela mesma informa o "valor a receber" (total menos a taxa real) —
        // recalculamos a partir dele e tentamos uma única vez mais. Assim uma
        // mudança de taxa da Asaas não derruba as vendas.
        let splitCents = computeExactPixSplitCents(totalCents, order.items_count);
        for (let attempt = 0; attempt < 2; attempt++) {
          const paymentResp = await createPixPayment(splitCents);
          if (paymentResp.ok) {
            const paymentData = await paymentResp.json();
            checkoutUrl = paymentData.invoiceUrl as string;
            asaasTxId = paymentData.id as string;
            break;
          }

          const errText = await paymentResp.text();
          console.error(`Asaas Pix payment error ${paymentResp.status}:`, errText);

          const m = errText.match(/valor a receber[^R]*R\$\s*([\d.]*\d,\d{2})/);
          if (attempt === 0 && m) {
            const receivableCents = Math.round(
              parseFloat(m[1].replace(/\./g, "").replace(",", ".")) * 100,
            );
            const adjusted = receivableCents - AGENCY_FEE_CENTS_PER_ITEM * order.items_count;
            if (adjusted > 0 && adjusted !== splitCents) {
              console.log(`Split Pix ajustado pela taxa real da Asaas: ${splitCents} -> ${adjusted} centavos`);
              splitCents = adjusted;
              continue;
            }
          }
          break;
        }
      }
    } else {
      const buildCheckoutPayload = (feeInflationCents: number) => {
        const clientSplitCents = computeCardSplitCents(totalCents, order.items_count, feeInflationCents);
        const splits = clientSplitCents > 0
          ? [{ walletId: asaasClientWalletId, fixedValue: clientSplitCents / 100 }]
          : [];
        return {
          billingTypes: ["CREDIT_CARD"],
          chargeTypes: ["DETACHED"],
          minutesToExpire: ORDER_TTL_MINUTES,
          callback: {
            successUrl: `https://pavilhao8.com.br/confirmacao?src=${reservationIds[0]}&status=approved`,
            cancelUrl: `https://pavilhao8.com.br/confirmacao?src=${reservationIds[0]}&status=failed`,
            expiredUrl: `https://pavilhao8.com.br/confirmacao?src=${reservationIds[0]}&status=pending`,
          },
          items: [
            {
              name: itemsTitle,
              description: chargeDescription,
              quantity: 1,
              value: totalCents / 100,
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
          // Só o ID do pedido: o webhook resolve as reservas a partir dele.
          externalReference: order.order_id,
        };
      };

      let asaasData: Record<string, unknown> | null = null;
      for (const inflation of [0, 300, 1000]) {
        const resp = await fetch(`${asaasBaseUrl}/checkouts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", access_token: asaasApiKey },
          body: JSON.stringify(buildCheckoutPayload(inflation)),
        });

        if (resp.ok) {
          asaasData = await resp.json();
          break;
        }

        const errBody = await resp.text();
        console.error(`Asaas checkout error ${resp.status} (inflation=${inflation}): ${errBody}`);
        // Só vale repetir quando o split estourou o líquido; outros erros são finais.
        if (!errBody.includes("Split")) break;
      }

      if (asaasData) {
        checkoutUrl = (asaasData.link || asaasData.url || asaasData.checkoutUrl) as string;
        asaasTxId = asaasData.id as string;
      }
    }

    if (!checkoutUrl) {
      // Libera as vagas na hora, sem esperar a expiração.
      await supabase.from("reservations").update({ status: "canceled" }).eq("order_id", order.order_id);
      await supabase.from("booking_orders")
        .update({ status: "canceled", notes: "Falha ao criar cobrança na Asaas" })
        .eq("id", order.order_id);
      createdOrderId = null;
      return json({ error: "Erro ao gerar link de pagamento" }, 502);
    }

    console.log(`Order ${order.order_id}: ${paymentMethod} tx ${asaasTxId} — ${checkoutUrl}`);

    // Plano B do webhook: usado sobretudo pelo Checkout de cartão, que às
    // vezes não propaga o externalReference para o Payment gerado.
    if (paymentMethod === "CREDIT_CARD" && asaasTxId) {
      await supabase.from("booking_orders")
        .update({ asaas_checkout_id: asaasTxId })
        .eq("id", order.order_id);
      await supabase.from("reservations")
        .update({ asaas_checkout_id: asaasTxId })
        .eq("order_id", order.order_id);
    }

    return json({
      order_id: order.order_id,
      reservation_id: reservationIds[0],
      reservation_ids: reservationIds,
      checkout_url: checkoutUrl,
      class_title: itemsTitle,
      items_count: order.items_count,
      subtotal_cents: order.subtotal_cents,
      discount_percent: order.discount_percent,
      discount_cents: order.discount_cents,
      total_cents: totalCents,
      campaign_applied: order.discount_percent > 0,
    });
  } catch (error: unknown) {
    console.error("Reserve error:", error);
    // Nunca deixa vagas presas por um pedido que não chegou a virar cobrança.
    if (createdOrderId && supabaseForCleanup) {
      try {
        await supabaseForCleanup.from("reservations").update({ status: "canceled" }).eq("order_id", createdOrderId);
        await supabaseForCleanup.from("booking_orders")
          .update({ status: "canceled", notes: "Erro inesperado durante a criação do pedido" })
          .eq("id", createdOrderId);
      } catch (cleanupErr) {
        console.error("Cleanup failed:", cleanupErr);
      }
    }
    const message = error instanceof Error ? error.message : "Erro interno";
    const { text, status } = friendlyError(message);
    return json({ error: status === 500 ? message : text }, status);
  }
});
