import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Check, Loader2, AlertCircle, ArrowLeft, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const Confirmacao = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const reservationId = searchParams.get("src") || searchParams.get("reservation_id");

  const [loading, setLoading] = useState(true);
  const [reservation, setReservation] = useState<{
    id: string;
    status: string;
    class_id: string;
    class_title: string;
    class_time: string;
    class_date: string | null;
    user_name: string;
    user_email: string;
    already_confirmed: boolean;
    items?: Array<{ id: string; status: string; class_title: string; class_time: string; class_date: string | null }>;
    combo?: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reservationId) {
      setError("Reserva não encontrada. Verifique o link.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 20; // ~40s de polling

    const fetchReservation = async (isPoll = false) => {
      try {
        const { data, error: fnError } = await supabase.functions.invoke(
          `get-reservation-public?id=${encodeURIComponent(reservationId)}`,
          { method: "GET" },
        );
        if (fnError || !data || data.error) {
          if (!isPoll) {
            setError("Reserva não encontrada.");
            setLoading(false);
          }
          return null;
        }
        const next = {
          id: data.id,
          status: data.status,
          class_id: data.class_id,
          class_title: data.class_title,
          class_time: data.class_time,
          class_date: data.class_date,
          user_name: data.user_first_name,
          user_email: data.user_email_masked,
          already_confirmed: data.status === "confirmed",
          items: data.items,
          combo: data.combo,
        };
        if (!cancelled) setReservation(next);
        return next;
      } catch (_e) {
        if (!isPoll) setError("Reserva não encontrada.");
        return null;
      } finally {
        if (!isPoll) setLoading(false);
      }
    };

    (async () => {
      const initial = await fetchReservation(false);
      if (!initial || initial.status === "confirmed") return;
      // Poll enquanto pendente — aguarda webhook do Asaas
      while (!cancelled && attempts < maxAttempts) {
        attempts++;
        await new Promise((r) => setTimeout(r, 2000));
        const r = await fetchReservation(true);
        if (r?.status === "confirmed") return;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reservationId]);

  const formattedDate = reservation?.class_date
    ? new Date(`${reservation.class_date}T12:00:00`).toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
      })
    : null;

  const formatItemDate = (d: string | null) =>
    d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }) : "";

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
            <h1 className="text-2xl font-bold text-foreground">
              {reservation.combo ? "Reservas confirmadas! ✅" : "Reserva confirmada! ✅"}
            </h1>
            {reservation.items && reservation.items.length > 1 ? (
              <div className="space-y-2">
                {reservation.items.map((it) => (
                  <div key={it.id} className="bg-secondary rounded-xl p-3">
                    <p className="font-semibold text-foreground">{it.class_title}</p>
                    <p className="text-sm text-muted-foreground capitalize">
                      {formatItemDate(it.class_date)} · {it.class_time}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-lg font-semibold text-foreground">{reservation.class_title}</p>
                {formattedDate && <p className="text-muted-foreground capitalize">{formattedDate}</p>}
                <p className="text-muted-foreground">Horário: {reservation.class_time}</p>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              {reservation.user_name}, sua{reservation.combo ? "s vagas estão" : " vaga está"} garantida{reservation.combo ? "s" : ""}. Nos vemos na aula! 💪
            </p>
            <Button onClick={() => navigate("/")} variant="outline" className="rounded-full mt-4">
              <ArrowLeft className="w-4 h-4 mr-2" /> Voltar ao início
            </Button>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-2xl p-8 text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mx-auto">
              <Clock className="w-8 h-8 text-primary animate-pulse" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Aguardando confirmação do pagamento</h1>
            <div className="bg-secondary rounded-xl p-4 space-y-1">
              <p className="text-lg font-semibold text-foreground">{reservation?.class_title}</p>
              {formattedDate && <p className="text-muted-foreground capitalize">{formattedDate}</p>}
              <p className="text-muted-foreground">Horário: {reservation?.class_time}</p>
              <p className="text-sm text-muted-foreground mt-2">{reservation?.user_name} · {reservation?.user_email}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Assim que o pagamento for confirmado, sua reserva aparecerá aqui automaticamente. Se você ainda não pagou, retorne ao checkout. Caso já tenha pago, aguarde alguns instantes.
            </p>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Verificando pagamento...
            </div>
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