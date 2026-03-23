import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const APPROVED_EVENTS = new Set([
  "purchase_approved",
  "purchase_paid",
  "payment_approved",
  "payment_paid",
  "order_paid",
]);

const REVERSAL_EVENTS = new Set([
  "purchase_refunded",
  "purchase_chargeback",
  "purchase_canceled",
  "payment_refunded",
  "payment_chargeback",
  "order_refunded",
  "order_canceled",
]);

const RESERVATION_FALLBACK_WINDOW_HOURS = 72;

type ReservationMatch = {
  id: string;
  class_id: string;
  user_id: string;
  status: "pending" | "confirmed" | "canceled";
};

const normalizeEventType = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[.\s-]+/g, "_");
};

const extractEventType = (body: Record<string, unknown>): string => {
  return normalizeEventType(
    body.event ?? body.type ?? body.event_type ?? (body.data as Record<string, unknown> | undefined)?.event
  );
};

const extractCustomerEmail = (body: Record<string, unknown>): string | null => {
  const email =
    (body.customer as Record<string, unknown> | undefined)?.email ||
    (body.buyer as Record<string, unknown> | undefined)?.email ||
    ((body.buyer as Record<string, unknown> | undefined)?.contact as Record<string, unknown> | undefined)?.email ||
    body.email;

  if (typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const extractTransactionId = (body: Record<string, unknown>): string | null => {
  const raw =
    (body.order as Record<string, unknown> | undefined)?.id ||
    (body.transaction as Record<string, unknown> | undefined)?.id ||
    body.transaction_id ||
    body.id;

  if (!raw) return null;
  const normalized = String(raw).trim();
  return normalized.length > 0 ? normalized : null;
};

const extractReservationId = (body: Record<string, unknown>): string | null => {
  const reservationId =
    body.src ||
    body.reservation_id ||
    (body.metadata as Record<string, unknown> | undefined)?.src ||
    (body.metadata as Record<string, unknown> | undefined)?.reservation_id ||
    (body.extra as Record<string, unknown> | undefined)?.src ||
    (body.extra as Record<string, unknown> | undefined)?.reservation_id ||
    (body.checkout_data as Record<string, unknown> | undefined)?.src ||
    (body.checkout_data as Record<string, unknown> | undefined)?.reservation_id ||
    (body.custom_fields as Record<string, unknown> | undefined)?.src ||
    (body.custom_fields as Record<string, unknown> | undefined)?.reservation_id;

  if (!reservationId) return null;
  const normalized = String(reservationId).trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeAmountToCents = (body: Record<string, unknown>): number => {
  const raw =
    (body.order as Record<string, unknown> | undefined)?.amount ||
    (body.product as Record<string, unknown> | undefined)?.price ||
    body.amount ||
    0;

  const numericRaw =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw.replace(".", "").replace(",", "."))
        : 0;

  if (!Number.isFinite(numericRaw) || numericRaw <= 0) return 0;
  if (numericRaw >= 1000) return Math.round(numericRaw);
  return Math.round(numericRaw * 100);
};

const findUserIdByEmail = async (supabase: ReturnType<typeof createClient>, customerEmail: string) => {
  const { data: user } = await supabase.from("users").select("id").eq("email", customerEmail).maybeSingle();
  return user?.id ?? null;
};

const findReservationForApproval = async (
  supabase: ReturnType<typeof createClient>,
  reservationId: string | null,
  customerEmail: string | null,
  transactionId: string | null
): Promise<ReservationMatch | null> => {
  if (reservationId) {
    const { data } = await supabase
      .from("reservations")
      .select("id, class_id, user_id, status")
      .eq("id", reservationId)
      .in("status", ["pending", "confirmed", "canceled"])
      .maybeSingle();

    if (data) return data as ReservationMatch;
  }

  if (transactionId) {
    const { data: existingPayment } = await supabase
      .from("payments")
      .select("reservation_id")
      .eq("transaction_id", transactionId)
      .maybeSingle();

    if (existingPayment?.reservation_id) {
      const { data } = await supabase
        .from("reservations")
        .select("id, class_id, user_id, status")
        .eq("id", existingPayment.reservation_id)
        .in("status", ["pending", "confirmed", "canceled"])
        .maybeSingle();

      if (data) return data as ReservationMatch;
    }
  }

  if (!customerEmail) return null;

  const userId = await findUserIdByEmail(supabase, customerEmail);
  if (!userId) return null;

  const threshold = new Date(Date.now() - RESERVATION_FALLBACK_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const { data: pendingReservation } = await supabase
    .from("reservations")
    .select("id, class_id, user_id, status")
    .eq("user_id", userId)
    .eq("status", "pending")
    .gte("created_at", threshold)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingReservation) return pendingReservation as ReservationMatch;

  const { data: canceledReservation } = await supabase
    .from("reservations")
    .select("id, class_id, user_id, status")
    .eq("user_id", userId)
    .eq("status", "canceled")
    .gte("created_at", threshold)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (canceledReservation as ReservationMatch | null) ?? null;
};

const ensurePaidPayment = async (
  supabase: ReturnType<typeof createClient>,
  params: { reservationId: string; userId: string; amount: number; transactionId: string | null; paidAt: string }
): Promise<string | null> => {
  const { reservationId, userId, amount, transactionId, paidAt } = params;

  if (transactionId) {
    const { data: existingByTx } = await supabase
      .from("payments")
      .select("id, status, paid_at")
      .eq("transaction_id", transactionId)
      .maybeSingle();

    if (existingByTx) {
      await supabase
        .from("payments")
        .update({
          status: "paid",
          paid_at: existingByTx.paid_at ?? paidAt,
          reservation_id: reservationId,
          user_id: userId,
          amount,
        })
        .eq("id", existingByTx.id);

      return existingByTx.id;
    }
  }

  const { data: existingByReservation } = await supabase
    .from("payments")
    .select("id")
    .eq("reservation_id", reservationId)
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingByReservation?.id) return existingByReservation.id;

  const fallbackTransactionId = transactionId ?? `cakto-manual-${reservationId}`;

  const { data: payment, error: payError } = await supabase
    .from("payments")
    .insert({
      user_id: userId,
      reservation_id: reservationId,
      amount,
      status: "paid",
      transaction_id: fallbackTransactionId,
      paid_at: paidAt,
    })
    .select("id")
    .single();

  if (payError) {
    console.error("Error creating payment:", payError.message);
    if (transactionId) {
      const { data: existingAfterError } = await supabase
        .from("payments")
        .select("id")
        .eq("transaction_id", transactionId)
        .maybeSingle();

      if (existingAfterError?.id) return existingAfterError.id;
    }

    return null;
  }

  return payment?.id ?? null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, handler: "webhook-cakto" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = (await req.json()) as Record<string, unknown>;
    const eventType = extractEventType(body);
    const customerEmail = extractCustomerEmail(body);
    const transactionId = extractTransactionId(body);
    const reservationId = extractReservationId(body);
    const amount = normalizeAmountToCents(body);
    const paidAt = new Date().toISOString();

    console.log("Cakto webhook full payload:", JSON.stringify(body, null, 2));
    console.log("Normalized eventType:", eventType);
    console.log("Extracted reservationId:", reservationId);
    console.log("Extracted customerEmail:", customerEmail);
    console.log("Extracted transactionId:", transactionId);

    if (!APPROVED_EVENTS.has(eventType) && !REVERSAL_EVENTS.has(eventType)) {
      console.log(`Ignored event type: ${eventType || "unknown"}`);
      return new Response(JSON.stringify({ received: true, ignored: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (APPROVED_EVENTS.has(eventType)) {
      const reservation = await findReservationForApproval(supabase, reservationId, customerEmail, transactionId);

      if (!reservation) {
        console.error(
          `CRITICAL: No reservation found for payment. event=${eventType} email=${customerEmail} reservationId=${reservationId} transactionId=${transactionId}`
        );
        return new Response(JSON.stringify({ received: true, warning: "reservation_not_found" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const paymentId = await ensurePaidPayment(supabase, {
        reservationId: reservation.id,
        userId: reservation.user_id,
        amount,
        transactionId,
        paidAt,
      });

      const { error: reservationError } = await supabase
        .from("reservations")
        .update({
          status: "confirmed",
          payment_id: paymentId,
        })
        .eq("id", reservation.id);

      if (reservationError) {
        console.error("Error confirming reservation:", reservationError.message);
      }

      console.log(`Reservation ${reservation.id} confirmed via Cakto webhook`);
    }

    if (REVERSAL_EVENTS.has(eventType)) {
      let reservation: { id: string } | null = null;

      if (reservationId) {
        const { data } = await supabase.from("reservations").select("id").eq("id", reservationId).maybeSingle();
        if (data) reservation = data;
      }

      if (!reservation && transactionId) {
        const { data: payment } = await supabase.from("payments").select("reservation_id").eq("transaction_id", transactionId).maybeSingle();
        if (payment?.reservation_id) reservation = { id: payment.reservation_id };
      }

      if (!reservation) {
        console.error(`No reservation found for reversal event ${eventType}`);
        return new Response(JSON.stringify({ received: true, warning: "reservation_not_found" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase
        .from("reservations")
        .update({ status: "canceled" })
        .eq("id", reservation.id);

      await supabase
        .from("payments")
        .update({ status: "failed" })
        .eq("reservation_id", reservation.id);

      if (transactionId) {
        await supabase
          .from("payments")
          .update({ status: "failed" })
          .eq("transaction_id", transactionId);
      }

      console.log(`Reservation ${reservation.id} canceled due to ${eventType}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
