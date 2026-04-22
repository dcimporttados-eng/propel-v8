import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar, Clock, Loader2, Search, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Reservation {
  id: string;
  class_date: string;
  status: string;
  classes: {
    title: string;
    time: string;
  };
}

interface ConsultationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ConsultationModal = ({ open, onOpenChange }: ConsultationModalProps) => {
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) return;

    setLoading(true);
    setHasSearched(false);
    try {
      const { data: users, error: userError } = await supabase
        .from("users")
        .select("id")
        .or(`email.ilike.${identifier.trim()},phone.eq.${identifier.trim()}`);

      if (userError) throw userError;

      if (!users || users.length === 0) {
        setReservations([]);
        setHasSearched(true);
        return;
      }

      const userIds = users.map(u => u.id);

      const { data: resData, error: resError } = await supabase
        .from("reservations")
        .select(`
          id,
          class_date,
          status,
          classes (
            title,
            time
          )
        `)
        .in("user_id", userIds)
        .order("class_date", { ascending: false });

      if (resError) throw resError;

      setReservations((resData as any) || []);
      setHasSearched(true);
    } catch (err: any) {
      console.error("Search error:", err);
      toast.error("Erro ao buscar reservas");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const [year, month, day] = dateStr.split("-");
    return `${day}/${month}/${year}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "confirmed":
        return <span className="flex items-center gap-1 text-xs font-bold text-green-500"><CheckCircle2 className="w-3 h-3" /> Confirmada</span>;
      case "pending":
        return <span className="flex items-center gap-1 text-xs font-bold text-yellow-500"><Clock className="w-3 h-3" /> Pendente</span>;
      case "cancelled":
        return <span className="flex items-center gap-1 text-xs font-bold text-destructive"><XCircle className="w-3 h-3" /> Cancelada</span>;
      default:
        return <span className="text-xs font-bold text-muted-foreground">{status}</span>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Consultar Minha Reserva</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">E-mail ou Telefone</Label>
              <div className="flex gap-2">
                <Input
                  id="identifier"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Digite seu e-mail ou telefone"
                  className="bg-secondary border-border"
                  required
                />
                <Button type="submit" disabled={loading} size="icon">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </form>

          <div className="max-h-[300px] overflow-y-auto space-y-3 pr-1">
            {hasSearched && reservations.length === 0 && (
              <p className="text-center py-8 text-muted-foreground text-sm">
                Nenhuma reserva encontrada para os dados informados.
              </p>
            )}

            {reservations.map((res) => (
              <div key={res.id} className="p-4 rounded-xl border border-border bg-secondary/50 space-y-2">
                <div className="flex justify-between items-start">
                  <h4 className="font-bold text-foreground">{res.classes.title}</h4>
                  {getStatusBadge(res.status)}
                </div>
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Calendar className="w-4 h-4 text-primary" />
                    {formatDate(res.class_date)}
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-4 h-4 text-primary" />
                    {res.classes.time.slice(0, 5)}
                  </div>
                </div>
                {res.status === "pending" && (
                  <p className="text-[10px] text-yellow-500/80 mt-1">
                    * Aguardando confirmação do pagamento
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ConsultationModal;
