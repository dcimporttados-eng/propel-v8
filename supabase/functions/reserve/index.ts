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

    // Get class info (including checkout_url)
    const { data: classData, error: classError } = await supabase
      .from("classes")
      .select("*")
      .eq("id", class_id)
      .single();

    if (classError || !classData) throw new Error("Aula não encontrada");

    if (!classData.checkout_url) {
      throw new Error("Checkout não configurado para esta aula");
    }

    // Create or find user
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    let userId: string;
    if (existingUser) {
      userId = existingUser.id;
      // Update name/phone if changed
      await supabase.from("users").update({ name, phone }).eq("id", userId);
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

    // Build checkout URL with reservation context
    // Append email and reservation_id as query params so we can match on webhook
    const checkoutUrl = new URL(classData.checkout_url);
    checkoutUrl.searchParams.set("email", email);
    checkoutUrl.searchParams.set("src", reservation.id);

    return new Response(
      JSON.stringify({
        reservation_id: reservation.id,
        checkout_url: checkoutUrl.toString(),
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
