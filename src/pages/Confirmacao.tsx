import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Check, Loader2, AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const Confirmacao = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const reservationId = searchParams.get("src") || searchParams.get("reservation_id");

  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [reservation, setReservation] = useState<{
    id: string;
    status: string;
    class_id: string;
    class_title: string;
    class_time: string;
    class_date: string | null;
    user_id: string;
    user_name: string;
    user_email: string;
    already_confirmed: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reservationId) {
      setError("Reserva não encontrada. Verifique o link.");
      setLoading(false);
      return;
    }

    const fetchReservation = async () => {
      const { data: res, error: resError } = await supabase
        .from("reservations")
        .select("id, status, class_id, user_id, class_date")
        .eq("id", reservationId)
        .maybeSingle();

      if (resError || !res) {
        setError("Reserva não encontrada.");
        setLoading(false);
        return;
      }

      const [userRes, classRes] = await Promise.all([
        supabase.from("users").select("name, email").eq("id", res.user_id).maybeSingle(),
        supabase.from("classes").select("title, time, price").eq("id", res.class_id).maybeSingle(),
      ]);

      setReservation({
        id: res.id,
        status: res.status,
        class_id: res.class_id,
        class_title: classRes.data?.title || "Aula",
        class_time: classRes.data?.time?.slice(0, 5) || "",
        class_date: res.class_date,
        user_id: res.user_id,
        user_name: userRes.data?.name || "",
        user_email: userRes.data?.email || "",
        already_confirmed: res.status === "confirmed",
      });
      setLoading(false);
    };

    fetchReservation();
  }, [reservationId]);

  const handleConfirm = async () => {
    if (!reservation) return;
    setConfirming(true);

    // Get price
    const { data: classData } = await supabase
      .from("classes")
      .select("price")
      .eq("id", reservation.class_id)
      .maybeSingle();
    const amount = classData?.price ?? 0;

    // Check if payment already exists
    const { data: existingPayment } = await supabase
      .from("payments")
      .select("id")
      .eq("reservation_id", reservation.id)
      .maybeSingle();

    let paymentId: string | null = null;

    if (existingPayment) {
      await supabase
        .from("payments")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", existingPayment.id);
      paymentId = existingPayment.id;
    } else {
      const { data: newPayment } = await supabase
        .from("payments")
        .insert({
          reservation_id: reservation.id,
          user_id: reservation.user_id,
          amount,
          status: "paid",
          transaction_id: `USER-CONFIRMED-${reservation.id.slice(0, 8)}`,
          paid_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      paymentId = newPayment?.id ?? null;
    }

    // Update reservation
    const { error: updateError } = await supabase
      .from("reservations")
      .update({ status: "confirmed", payment_id: paymentId })
      .eq("id", reservation.id);

    if (updateError) {
      toast.error("Erro ao confirmar. Tente novamente.");
      setConfirming(false);
      return;
    }

    setReservation((prev) => prev ? { ...prev, status: "confirmed", already_confirmed: true } : prev);
    setConfirming(false);
    toast.success("Pagamento confirmado!");
  };

  const formattedDate = reservation?.class_date
    ? new Date(`${reservation.class_date}T12:00:00`).toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
      })
    : null;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {loading ? (
          <div className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Carregando reserva...</p>
          </div>
        ) : error ? (
          <div className="bg-card border border-border rounded-2xl p-8 text-center space-y-4">
            <AlertCircle className="w-12 h-12 text-destructive mx-auto" />
            <h1 className="text-xl font-bold text-foreground">{error}</h1>
            <Button variant="outline" onClick={() => navigate("/")} className="rounded-full">
              <ArrowLeft className="w-4 h-4 mr-2" /> Voltar ao início
            </Button>
          </div>
        ) : reservation?.already_confirmed ? (
          <div className="bg-card border border-border rounded-2xl p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto">
              <Check className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Reserva confirmada! ✅</h1>
            <div className="space-y-1">
              <p className="text-lg font-semibold text-foreground">{reservation.class_title}</p>
              {formattedDate && <p className="text-muted-foreground capitalize">{formattedDate}</p>}
              <p className="text-muted-foreground">Horário: {reservation.class_time}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              {reservation.user_name}, sua vaga está garantida. Nos vemos na aula! 💪
            </p>
            <Button onClick={() => navigate("/")} variant="outline" className="rounded-full mt-4">
              <ArrowLeft className="w-4 h-4 mr-2" /> Voltar ao início
            </Button>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-2xl p-8 text-center space-y-6">
            <h1 className="text-2xl font-bold text-foreground">Confirme seu pagamento</h1>
            <div className="bg-secondary rounded-xl p-4 space-y-1">
              <p className="text-lg font-semibold text-foreground">{reservation?.class_title}</p>
              {formattedDate && <p className="text-muted-foreground capitalize">{formattedDate}</p>}
              <p className="text-muted-foreground">Horário: {reservation?.class_time}</p>
              <p className="text-sm text-muted-foreground mt-2">{reservation?.user_name} · {reservation?.user_email}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Após realizar o pagamento na Cakto, clique no botão abaixo para confirmar sua reserva.
            </p>
            <Button
              onClick={handleConfirm}
              disabled={confirming}
              className="w-full bg-gradient-primary text-primary-foreground font-bold rounded-full py-6 text-lg hover:scale-[1.02] transition-transform"
            >
              {confirming ? (
                <><Loader2 className="w-5 h-5 animate-spin mr-2" /> Confirmando...</>
              ) : (
                <><Check className="w-5 h-5 mr-2" /> Já paguei — confirmar reserva</>
              )}
            </Button>
            <Button onClick={() => navigate("/")} variant="ghost" className="text-muted-foreground text-sm">
              <ArrowLeft className="w-4 h-4 mr-2" /> Voltar ao início
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Confirmacao;