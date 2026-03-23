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
  "purchase_refused",
  "purchase_canceled",
  "chargeback",
  "refund",
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

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
};

const firstNonEmptyString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized.length > 0) return normalized;
  }
  return null;
};

const parseWebhookBody = (rawBody: string, contentType: string): Record<string, unknown> => {
  const trimmedBody = rawBody.trim();
  if (!trimmedBody) return {};

  const parseAsJson = (): Record<string, unknown> => {
    const parsed = JSON.parse(trimmedBody);
    const parsedObject = asObject(parsed);
    return parsedObject ?? { data: parsed };
  };

  const parseAsForm = (): Record<string, unknown> => {
    const params = new URLSearchParams(trimmedBody);
    const entries = Array.from(params.entries());
    if (entries.length === 0) return {};
    return Object.fromEntries(entries);
  };

  const loweredContentType = contentType.toLowerCase();

  if (loweredContentType.includes("application/json")) {
    try {
      return parseAsJson();
    } catch {
      try {
        return parseAsForm();
      } catch {
        return { raw: trimmedBody };
      }
    }
  }

  if (loweredContentType.includes("application/x-www-form-urlencoded")) {
    return parseAsForm();
  }

  try {
    return parseAsJson();
  } catch {
    try {
      return parseAsForm();
    } catch {
      return { raw: trimmedBody };
    }
  }
};

const normalizeEventType = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[.\s-]+/g, "_");
};

const extractEventType = (body: Record<string, unknown>): string => {
  const directEvent = body.event ?? body.type ?? body.event_type;
  const directObject = asObject(directEvent);

  if (directObject) {
    const objectEvent = directObject.custom_id ?? directObject.event ?? directObject.type ?? directObject.name;
    const normalized = normalizeEventType(objectEvent);
    if (normalized) return normalized;
  }

  const normalizedDirect = normalizeEventType(directEvent);
  if (normalizedDirect) return normalizedDirect;

  const data = asObject(body.data);
  if (!data) return "";

  const nestedEvent = data.event ?? data.type ?? data.event_type;
  const nestedObject = asObject(nestedEvent);
  if (nestedObject) {
    return normalizeEventType(nestedObject.custom_id ?? nestedObject.event ?? nestedObject.type ?? nestedObject.name);
  }

  return normalizeEventType(nestedEvent);
};

const extractCustomerEmail = (body: Record<string, unknown>): string | null => {
  const customer = asObject(body.customer);
  const buyer = asObject(body.buyer);
  const buyerContact = asObject(buyer?.contact);
  const order = asObject(body.order);
  const orderCustomer = asObject(order?.customer);
  const data = asObject(body.data);
  const dataCustomer = asObject(data?.customer);
  const dataBuyer = asObject(data?.buyer);
  const dataBuyerContact = asObject(dataBuyer?.contact);

  const email = firstNonEmptyString(
    body.email,
    body.customer_email,
    customer?.email,
    customer?.mail,
    buyer?.email,
    buyerContact?.email,
    orderCustomer?.email,
    dataCustomer?.email,
    dataCustomer?.mail,
    dataBuyer?.email,
    dataBuyerContact?.email,
  );

  if (!email) return null;
  const normalized = email.toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const extractTransactionId = (body: Record<string, unknown>): string | null => {
  const order = asObject(body.order);
  const transaction = asObject(body.transaction);
  const payment = asObject(body.payment);
  const data = asObject(body.data);
  const dataOrder = asObject(data?.order);
  const dataTransaction = asObject(data?.transaction);

  const raw = firstNonEmptyString(
    body.transaction_id,
    body.id,
    order?.id,
    order?.transaction_id,
    transaction?.id,
    payment?.id,
    payment?.transaction_id,
    data?.id,
    dataOrder?.id,
    dataOrder?.transaction_id,
    dataTransaction?.id,
  );

  if (!raw) return null;
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : null;
};

const extractReservationId = (body: Record<string, unknown>): string | null => {
  const metadata = asObject(body.metadata);
  const extra = asObject(body.extra);
  const checkoutData = asObject(body.checkout_data);
  const customFields = asObject(body.custom_fields);
  const fields = asObject(body.fields);
  const data = asObject(body.data);
  const dataMetadata = asObject(data?.metadata);
  const dataCheckoutData = asObject(data?.checkout_data);
  const dataCustomFields = asObject(data?.custom_fields);
  const dataExtra = asObject(data?.extra);

  const reservationId = firstNonEmptyString(
    body.src,
    body.reservation_id,
    body.reference,
    body.reference_id,
    metadata?.src,
    metadata?.reservation_id,
    metadata?.reference,
    metadata?.reference_id,
    extra?.src,
    extra?.reservation_id,
    checkoutData?.src,
    checkoutData?.reservation_id,
    customFields?.src,
    customFields?.reservation_id,
    fields?.src,
    fields?.reservation_id,
    data?.src,
    data?.reservation_id,
    dataMetadata?.src,
    dataMetadata?.reservation_id,
    dataCheckoutData?.src,
    dataCheckoutData?.reservation_id,
    dataCustomFields?.src,
    dataCustomFields?.reservation_id,
    dataExtra?.src,
    dataExtra?.reservation_id,
  );

  if (!reservationId) return null;
  const normalized = reservationId.trim();
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
  const { data: user } = await supabase.from("users").select("id").ilike("email", customerEmail).maybeSingle();
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

    const contentType = req.headers.get("content-type") ?? "";
    const rawBody = await req.text();
    const body = parseWebhookBody(rawBody, contentType);
    const eventType = extractEventType(body);
    const customerEmail = extractCustomerEmail(body);
    const transactionId = extractTransactionId(body);
    const reservationId = extractReservationId(body);
    const amount = normalizeAmountToCents(body);
    const paidAt = new Date().toISOString();

    console.log("Webhook content-type:", contentType || "unknown");
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
