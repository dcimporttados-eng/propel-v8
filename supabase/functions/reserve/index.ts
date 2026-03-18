import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAGARME_API_URL = "https://api.pagar.me/core/v5";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const PAGARME_SECRET_KEY = Deno.env.get("PAGARME_SECRET_KEY");
    if (!PAGARME_SECRET_KEY) {
      throw new Error("PAGARME_SECRET_KEY is not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { class_id, name, email, phone } = await req.json();

    if (!class_id || !name || !email || !phone) {
      return new Response(
        JSON.stringify({ error: "Campos obrigatórios: class_id, name, email, phone" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check available spots
    const { data: spots, error: spotsError } = await supabase.rpc("get_available_spots", {
      p_class_id: class_id,
    });

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
      .eq("email", email)
      .maybeSingle();

    let userId: string;
    if (existingUser) {
      userId = existingUser.id;
    } else {
      const { data: newUser, error: userError } = await supabase
        .from("users")
        .insert({ name, email, phone })
        .select("id")
        .single();
      if (userError || !newUser) throw new Error(`Erro ao criar usuário: ${userError?.message}`);
      userId = newUser.id;
    }

    // Create reservation (pending)
    const { data: reservation, error: resError } = await supabase
      .from("reservations")
      .insert({ user_id: userId, class_id, status: "pending" })
      .select("id")
      .single();

    if (resError || !reservation) throw new Error(`Erro ao criar reserva: ${resError?.message}`);

    // Create PIX payment via Pagar.me
    const pagarmeAuth = btoa(`${PAGARME_SECRET_KEY}:`);

    const pagarmeResponse = await fetch(`${PAGARME_API_URL}/orders`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${pagarmeAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [
          {
            amount: classData.price,
            description: `${classData.title} - ${classData.date} ${classData.time}`,
            quantity: 1,
          },
        ],
        customer: {
          name,
          email,
          type: "individual",
        },
        payments: [
          {
            payment_method: "pix",
            pix: {
              expires_in: 3600,
            },
          },
        ],
        metadata: {
          reservation_id: reservation.id,
        },
      }),
    });

    const pagarmeData = await pagarmeResponse.json();

    if (!pagarmeResponse.ok) {
      // Cancel reservation if payment creation fails
      await supabase
        .from("reservations")
        .update({ status: "canceled" })
        .eq("id", reservation.id);
      throw new Error(`Erro Pagar.me [${pagarmeResponse.status}]: ${JSON.stringify(pagarmeData)}`);
    }

    // Extract PIX data
    const charge = pagarmeData.charges?.[0];
    const lastTransaction = charge?.last_transaction;
    const pixQrCode = lastTransaction?.qr_code_url || lastTransaction?.qr_code;
    const pixCopyPaste = lastTransaction?.qr_code || "";
    const transactionId = charge?.id || pagarmeData.id;

    // Create payment record
    const { data: payment, error: payError } = await supabase
      .from("payments")
      .insert({
        user_id: userId,
        reservation_id: reservation.id,
        amount: classData.price,
        status: "pending",
        transaction_id: String(transactionId),
        pix_qr_code: pixQrCode,
        pix_copy_paste: pixCopyPaste,
      })
      .select("id")
      .single();

    if (payError || !payment) throw new Error(`Erro ao criar pagamento: ${payError?.message}`);

    // Link payment to reservation
    await supabase
      .from("reservations")
      .update({ payment_id: payment.id })
      .eq("id", reservation.id);

    return new Response(
      JSON.stringify({
        reservation_id: reservation.id,
        payment_id: payment.id,
        pix_qr_code: pixQrCode,
        pix_copy_paste: pixCopyPaste,
        amount: classData.price,
        expires_in: 3600,
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
