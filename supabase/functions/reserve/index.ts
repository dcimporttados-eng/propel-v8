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
    const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { class_id, class_date, name, email, phone } = await req.json();

    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedPhone = typeof phone === "string" ? phone.trim() : "";

    if (!class_id || !normalizedName || !normalizedEmail || !normalizedPhone) {
      return new Response(
        JSON.stringify({ error: "Campos obrigatórios: class_id, name, email, phone" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check available spots
    const rpcParams: Record<string, unknown> = { p_class_id: class_id };
    if (class_date) rpcParams.p_date = class_date;

    const { data: spots, error: spotsError } = await supabase.rpc("get_available_spots", rpcParams);
    if (spotsError) throw new Error(`Erro ao verificar vagas: ${spotsError.message}`);
    if (spots <= 0) {
      return new Response(
        JSON.stringify({ error: "Aula lotada, não há vagas disponíveis" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get class info
    const { data: classData, error: classError } = await supabase
      .from("classes")
      .select("*")
      .eq("id", class_id)
      .single();

    if (classError || !classData) throw new Error("Aula não encontrada");

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

    // Create reservation (pending)
    const reservationData: Record<string, unknown> = { user_id: userId, class_id, status: "pending" };
    if (class_date) reservationData.class_date = class_date;

    const { data: reservation, error: resError } = await supabase
      .from("reservations")
      .insert(reservationData)
      .select("id")
      .single();

    if (resError || !reservation) throw new Error(`Erro ao criar reserva: ${resError?.message}`);

    // Create Mercado Pago Checkout Pro preference
    const priceInDecimal = classData.price / 100; // DB stores in cents, MP expects decimal
    const webhookUrl = `${supabaseUrl}/functions/v1/webhook-mercadopago`;

    const preference = {
      items: [
        {
          title: `${classData.title} — ${class_date || ""}`,
          quantity: 1,
          unit_price: priceInDecimal,
          currency_id: "BRL",
        },
      ],
      payer: {
        email: normalizedEmail,
        name: normalizedName,
      },
      external_reference: reservation.id,
      notification_url: webhookUrl,
      back_urls: {
        success: `https://propel-v8.lovable.app/confirmacao?src=${reservation.id}&status=approved`,
        failure: `https://propel-v8.lovable.app/confirmacao?src=${reservation.id}&status=failed`,
        pending: `https://propel-v8.lovable.app/confirmacao?src=${reservation.id}&status=pending`,
      },
      auto_return: "approved",
      statement_descriptor: "PAVILHAO8",
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
    };

    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mpAccessToken}`,
      },
      body: JSON.stringify(preference),
    });

    if (!mpResponse.ok) {
      const errBody = await mpResponse.text();
      console.error(`MP preference error ${mpResponse.status}: ${errBody}`);
      throw new Error("Erro ao gerar link de pagamento");
    }

    const mpData = await mpResponse.json();
    console.log("MP preference created:", mpData.id, "init_point:", mpData.init_point);

    return new Response(
      JSON.stringify({
        reservation_id: reservation.id,
        checkout_url: mpData.init_point,
        class_title: classData.title,
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
