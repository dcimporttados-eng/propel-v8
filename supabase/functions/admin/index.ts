import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-password",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Constant-time string compare to mitigate timing attacks
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const adminPassword = req.headers.get("x-admin-password") || "";
  const expected = Deno.env.get("ADMIN_PASSWORD") || "";
  if (!expected || !safeEqual(adminPassword, expected)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { action?: string; payload?: Record<string, unknown> } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { action, payload = {} } = body;
  if (!action) return json({ error: "Missing action" }, 400);

  try {
    switch (action) {
      // ===== CLASSES =====
      case "insert_class": {
        const { data, error } = await supabase.from("classes").insert(payload).select().single();
        if (error) throw error;
        return json({ data });
      }
      case "update_class": {
        const { id, ...patch } = payload as { id: string; [k: string]: unknown };
        const { error } = await supabase.from("classes").update(patch).eq("id", id);
        if (error) throw error;
        return json({ ok: true });
      }
      case "delete_class": {
        const classId = (payload as { id: string }).id;
        const CANNOT_DELETE_MSG =
          "Esse horário tem reservas vinculadas e não pode ser excluído sem apagar histórico (inclusive de reservas em combo com outras aulas). Em vez de excluir, defina Vagas = 0 para desativar sem perder o histórico.";

        const { count } = await supabase
          .from("reservations")
          .select("id", { count: "exact", head: true })
          .eq("class_id", classId);
        if (count && count > 0) {
          return json({ error: CANNOT_DELETE_MSG });
        }

        const { error } = await supabase.from("classes").delete().eq("id", classId);
        if (error) {
          if (error.code === "23503") return json({ error: CANNOT_DELETE_MSG });
          throw error;
        }
        return json({ ok: true });
      }

      // ===== CLASS SUSPENSIONS =====
      case "insert_suspension": {
        const { data, error } = await supabase
          .from("class_suspensions")
          .insert(payload)
          .select()
          .single();
        if (error) return json({ error: error.message, code: error.code }, 400);
        return json({ data });
      }
      case "delete_suspension": {
        const { error } = await supabase
          .from("class_suspensions")
          .delete()
          .eq("id", (payload as { id: string }).id);
        if (error) throw error;
        return json({ ok: true });
      }

      // ===== RESERVATIONS =====
      case "list_reservations": {
        const { status, classDate, classId, limit } = payload as {
          status?: "confirmed" | "pending" | "all";
          classDate?: string;
          classId?: string;
          limit?: number;
        };
        let q = supabase
          .from("reservations")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit ?? 200);
        if (status === "confirmed") q = q.eq("status", "confirmed");
        else if (status === "pending") q = q.eq("status", "pending");
        else q = q.in("status", ["pending", "confirmed", "canceled"]);
        if (classDate) q = q.eq("class_date", classDate);
        if (classId) q = q.eq("class_id", classId);
        const { data, error } = await q;
        if (error) throw error;
        return json({ data });
      }
      case "list_weekly_reservations": {
        const { dates } = payload as { dates: string[] };
        const { data, error } = await supabase
          .from("reservations")
          .select("*")
          .in("status", ["confirmed", "pending"])
          .in("class_date", dates);
        if (error) throw error;
        return json({ data });
      }
      case "list_payments_for_reservations": {
        const { reservationIds } = payload as { reservationIds: string[] };
        const { data, error } = await supabase
          .from("payments")
          .select("id, reservation_id, status, transaction_id, paid_at, created_at")
          .in("reservation_id", reservationIds)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return json({ data });
      }
      case "list_payments_by_ids": {
        const { paymentIds } = payload as { paymentIds: string[] };
        if (!paymentIds || paymentIds.length === 0) return json({ data: [] });
        const { data, error } = await supabase
          .from("payments")
          .select("id, status, transaction_id, paid_at")
          .in("id", paymentIds);
        if (error) throw error;
        return json({ data });
      }
      case "cancel_reservation": {
        const { error } = await supabase
          .from("reservations")
          .update({ status: "canceled" })
          .eq("id", (payload as { id: string }).id);
        if (error) throw error;
        return json({ ok: true });
      }
      case "mark_paid": {
        const { reservationId, userId, classId, transactionCode } = payload as {
          reservationId: string;
          userId: string;
          classId: string;
          transactionCode?: string;
        };
        const { data: cls } = await supabase.from("classes").select("price").eq("id", classId).maybeSingle();
        const amount = cls?.price ?? 0;
        const paidAt = new Date().toISOString();
        const transactionId = transactionCode?.trim() || `MANUAL-${reservationId.slice(0, 8)}`;

        const { data: existingPayment } = await supabase
          .from("payments")
          .select("id")
          .eq("reservation_id", reservationId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        let paymentId = existingPayment?.id ?? null;
        if (paymentId) {
          await supabase.from("payments").update({
            status: "paid", transaction_id: transactionId, paid_at: paidAt, amount, user_id: userId,
          }).eq("id", paymentId);
        } else {
          const { data: created, error: payErr } = await supabase.from("payments").insert({
            reservation_id: reservationId, user_id: userId, amount, status: "paid",
            transaction_id: transactionId, paid_at: paidAt,
          }).select("id").single();
          if (payErr || !created) throw payErr || new Error("payment create failed");
          paymentId = created.id;
        }
        const { error: resErr } = await supabase.from("reservations")
          .update({ status: "confirmed", payment_id: paymentId }).eq("id", reservationId);
        if (resErr) throw resErr;
        return json({ ok: true, paymentId, transactionId, paidAt });
      }
      case "manual_reservation": {
        const { name, email, phone, classId, classDate, transactionCode } = payload as {
          name: string; email: string; phone?: string; classId: string; classDate: string; transactionCode?: string;
        };
        const normEmail = email.trim().toLowerCase();
        const normPhone = (phone || "").replace(/\D/g, "");
        const { data: existingUser } = await supabase.from("users").select("id").ilike("email", normEmail).maybeSingle();
        let userId = existingUser?.id ?? null;
        if (!userId) {
          const { data: nu, error: ue } = await supabase.from("users")
            .insert({ name: name.trim(), email: normEmail, phone: normPhone || null })
            .select("id").single();
          if (ue || !nu) throw ue || new Error("user create failed");
          userId = nu.id;
        }
        const { data: newRes, error: re } = await supabase.from("reservations")
          .insert({ user_id: userId, class_id: classId, class_date: classDate, status: "confirmed" })
          .select("id").single();
        if (re || !newRes) throw re || new Error("reservation create failed");
        const { data: cls } = await supabase.from("classes").select("price").eq("id", classId).maybeSingle();
        const amount = cls?.price ?? 0;
        const txId = transactionCode?.trim() || `MANUAL-${newRes.id.slice(0, 8)}`;
        const { data: newPay, error: pe } = await supabase.from("payments")
          .insert({ reservation_id: newRes.id, user_id: userId, amount, status: "paid", transaction_id: txId, paid_at: new Date().toISOString() })
          .select("id").single();
        if (pe || !newPay) throw pe || new Error("payment create failed");
        await supabase.from("reservations").update({ payment_id: newPay.id }).eq("id", newRes.id);
        return json({ ok: true, reservationId: newRes.id });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal error";
    console.error("admin error:", action, message);
    return json({ error: message }, 500);
  }
});