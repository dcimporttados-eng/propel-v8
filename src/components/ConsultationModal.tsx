import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
 import { Calendar, Clock, Loader2, Search, CheckCircle2, XCircle, ShieldCheck } from "lucide-react";
 import { Badge } from "@/components/ui/badge";
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
        .neq("status", "canceled")
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

   const isPastDate = (dateStr: string) => {
     if (!dateStr) return false;
     const today = new Date();
     today.setHours(0, 0, 0, 0);
     const [year, month, day] = dateStr.split("-").map(Number);
     const classDate = new Date(year, month - 1, day);
     return classDate < today;
   };
 
   const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const [year, month, day] = dateStr.split("-");
    return `${day}/${month}/${year}`;
  };

   const getStatusBadge = (status: string) => {
     switch (status) {
       case "confirmed":
         return (
           <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20 flex items-center gap-1 py-0.5">
             <CheckCircle2 className="w-3 h-3" /> Confirmada
           </Badge>
         );
       case "pending":
         return (
           <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20 flex items-center gap-1 py-0.5">
             <Clock className="w-3 h-3" /> Aguardando Pagamento
           </Badge>
         );
       default:
         return <Badge variant="secondary">{status}</Badge>;
     }
   };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-md">
         <DialogHeader>
           <DialogTitle className="text-xl font-bold">Minhas Reservas</DialogTitle>
           <p className="text-xs text-muted-foreground">Acompanhe o status e garanta seu horário.</p>
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

              {reservations.map((res) => {
                const isPast = isPastDate(res.class_date);
                const isConfirmed = res.status === "confirmed";
                return (
                  <div 
                    key={res.id} 
                    className={`p-4 rounded-xl border border-border bg-secondary/40 space-y-2 relative overflow-hidden transition-all hover:bg-secondary/60 ${
                      isPast ? "bg-muted/50 grayscale-[0.5]" : 
                      isConfirmed ? "border-l-4 border-l-green-500 bg-green-500/[0.02]" : 
                      res.status === "pending" ? "border-l-4 border-l-yellow-500 bg-yellow-500/[0.02]" : ""
                    }`}
                  >
                   <div className="flex justify-between items-start">
                     <div className="flex flex-col">
                        <h4 className="font-bold text-foreground text-base leading-tight">{res.classes.title}</h4>
                        <div className="flex gap-2 mt-1">
                          {isPast && (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded w-fit">
                              Aula Passada
                            </span>
                          )}
                          {!isPast && isConfirmed && (
                            <span className="text-[10px] font-bold uppercase tracking-wider text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded w-fit flex items-center gap-1">
                              <ShieldCheck className="w-3 h-3" /> Vaga Garantida
                            </span>
                          )}
                        </div>
                      </div>
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
                    {!isPast && res.status === "pending" && (
                      <p className="text-[10px] text-yellow-600 font-medium mt-2 leading-normal flex items-start gap-1 bg-yellow-500/10 p-2 rounded-lg border border-yellow-500/10">
                        <span className="shrink-0">•</span> Seu horário ainda não está garantido. Finalize o pagamento para confirmar sua vaga.
                      </p>
                    )}
                    {!isPast && isConfirmed && (
                      <p className="text-[10px] text-green-600 font-medium mt-2 leading-normal flex items-start gap-1 bg-green-500/10 p-2 rounded-lg border border-green-500/10">
                        <ShieldCheck className="w-3 h-3 shrink-0 mt-0.5" /> Tudo certo! Seu horário está reservado e confirmado no sistema.
                      </p>
                    )}
                 </div>
               );
             })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ConsultationModal;
