import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Clock, Users, Loader2, ExternalLink, CalendarDays } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const DAY_NAMES = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

interface ClassTemplate {
  id: string;
  title: string;
  time: string;
  capacity: number;
  price: number;
  day_of_week: number | null;
  checkout_url: string | null;
  instructor: string | null;
}

interface ClassOccurrence {
  template: ClassTemplate;
  date: string; // YYYY-MM-DD
  dayOfWeek: number;
  available: number;
}

interface ScheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialModality?: string;
}

function getNextWeekdays(): { date: string; dayOfWeek: number; label: string }[] {
  const days: { date: string; dayOfWeek: number; label: string }[] = [];
  const now = new Date();
  let d = new Date(now);
  
  // Start from today or tomorrow based on current time
  for (let i = 0; i < 14 && days.length < 5; i++) {
    const candidate = new Date(d);
    candidate.setDate(d.getDate() + i);
    const dow = candidate.getDay(); // 0=Sun, 1=Mon...5=Fri, 6=Sat
    if (dow >= 1 && dow <= 5) {
      const yyyy = candidate.getFullYear();
      const mm = String(candidate.getMonth() + 1).padStart(2, "0");
      const dd = String(candidate.getDate()).padStart(2, "0");
      const dateStr = `${yyyy}-${mm}-${dd}`;
      const label = `${DAY_NAMES[dow]} ${dd}/${mm}`;
      days.push({ date: dateStr, dayOfWeek: dow, label });
    }
  }
  return days;
}

const ScheduleModal = ({ open, onOpenChange, initialModality }: ScheduleModalProps) => {
  const [step, setStep] = useState(1);
  const [selectedOccurrence, setSelectedOccurrence] = useState<ClassOccurrence | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const [occurrences, setOccurrences] = useState<Map<string, ClassOccurrence[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [weekdays, setWeekdays] = useState<{ date: string; dayOfWeek: number; label: string }[]>([]);

  useEffect(() => {
    if (!open) return;

    const fetchData = async () => {
      setLoading(true);
      const days = getNextWeekdays();
      setWeekdays(days);
      if (days.length > 0) setSelectedDay(days[0].date);

      // Fetch templates
      const { data: templates } = await supabase
        .from("classes")
        .select("*")
        .order("time", { ascending: true });

      // Fetch suspensions for upcoming dates
      const dates = days.map((d) => d.date);
      const { data: suspensions } = await supabase
        .from("class_suspensions")
        .select("*")
        .in("suspended_date", dates);

      const suspSet = new Set(
        (suspensions || []).map((s: { class_id: string; suspended_date: string }) => `${s.class_id}_${s.suspended_date}`)
      );

      // Generate occurrences per day
      const occMap = new Map<string, ClassOccurrence[]>();

      for (const day of days) {
        const dayOccurrences: ClassOccurrence[] = [];
        for (const t of (templates || []) as ClassTemplate[]) {
          // Check if template applies to this day
          if (t.day_of_week !== null && t.day_of_week !== day.dayOfWeek) continue;
          // Check if suspended
          if (suspSet.has(`${t.id}_${day.date}`)) continue;
          // Filter by modality
          if (initialModality && t.title !== initialModality) continue;

          // Get available spots for this template+date
          const { data: spots } = await supabase.rpc("get_available_spots", {
            p_class_id: t.id,
            p_date: day.date,
          });

          dayOccurrences.push({
            template: t,
            date: day.date,
            dayOfWeek: day.dayOfWeek,
            available: spots ?? t.capacity,
          });
        }
        occMap.set(day.date, dayOccurrences);
      }

      setOccurrences(occMap);
      setLoading(false);
    };

    fetchData();
  }, [open, initialModality]);

  const resetAndClose = () => {
    setStep(1);
    setSelectedOccurrence(null);
    setForm({ name: "", phone: "", email: "" });
    setSelectedDay("");
    onOpenChange(false);
  };

  const handleSelectTime = (occ: ClassOccurrence) => {
    setSelectedOccurrence(occ);
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.phone || !form.email || !selectedOccurrence) return;

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("reserve", {
        body: {
          class_id: selectedOccurrence.template.id,
          class_date: selectedOccurrence.date,
          name: form.name,
          email: form.email,
          phone: form.phone,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      if (data.checkout_url) {
        window.open(data.checkout_url, "_blank");
        setStep(3);
      } else {
        throw new Error("URL de checkout não disponível");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro ao criar reserva";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const currentDayOccurrences = occurrences.get(selectedDay) || [];

  const formattedPrice = selectedOccurrence
    ? (selectedOccurrence.template.price / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "";

  const selectedDayLabel = weekdays.find((d) => d.date === selectedDay)?.label || "";

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? resetAndClose() : onOpenChange(v))}>
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            {step === 1 && (initialModality || "Escolha o horário")}
            {step === 2 && "Seus dados"}
            {step === 3 && "Finalize o pagamento"}
          </DialogTitle>
        </DialogHeader>

        {/* Progress */}
        <div className="flex gap-1 mb-2">
          {[1, 2, 3].map((s) => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${s <= step ? "bg-primary" : "bg-muted"}`} />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
              {loading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
              ) : (
                <>
                  {/* Day selector */}
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {weekdays.map((day) => (
                      <button
                        key={day.date}
                        onClick={() => setSelectedDay(day.date)}
                        className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-semibold transition-colors border ${
                          selectedDay === day.date
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-secondary border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        <CalendarDays className="w-3 h-3 inline mr-1" />
                        {day.label}
                      </button>
                    ))}
                  </div>

                  <p className="text-sm text-muted-foreground">Horários para {selectedDayLabel}:</p>

                  {currentDayOccurrences.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">Nenhuma aula disponível neste dia</p>
                  )}

                  {currentDayOccurrences.map((occ) => (
                    <button
                      key={`${occ.template.id}_${occ.date}`}
                      disabled={occ.available <= 0}
                      onClick={() => handleSelectTime(occ)}
                      className={`w-full flex items-center justify-between p-4 rounded-xl border transition-colors ${
                        occ.available <= 0
                          ? "bg-muted/50 border-border opacity-50 cursor-not-allowed"
                          : "bg-secondary border-border hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Clock className="w-4 h-4 text-primary" />
                        <div className="text-left">
                          <span className="font-semibold">{occ.template.time?.slice(0, 5)}</span>
                          <span className="text-xs text-muted-foreground ml-2">{occ.template.title}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-muted-foreground" />
                        <span className={`text-sm ${occ.available <= 0 ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                          {occ.available <= 0 ? "Lotada" : `${occ.available} vagas`}
                        </span>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <p className="text-sm text-muted-foreground mb-4">
                {selectedOccurrence?.template.title} — {selectedDayLabel} — {selectedOccurrence?.template.time?.slice(0, 5)} — {formattedPrice}
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="name">Nome</Label>
                  <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Seu nome completo" className="bg-secondary border-border mt-1" required maxLength={100} />
                </div>
                <div>
                  <Label htmlFor="phone">Telefone</Label>
                  <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(00) 00000-0000" className="bg-secondary border-border mt-1" required maxLength={20} />
                </div>
                <div>
                  <Label htmlFor="email">E-mail</Label>
                  <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="seu@email.com" className="bg-secondary border-border mt-1" required maxLength={255} />
                </div>
                <Button type="submit" disabled={submitting} className="w-full bg-gradient-primary text-primary-foreground font-bold rounded-full py-6 hover:scale-[1.02] transition-transform">
                  {submitting ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Processando...</> : <>Reservar e pagar <ExternalLink className="w-4 h-4 ml-2" /></>}
                </Button>
                <Button variant="ghost" type="button" onClick={() => setStep(1)} className="text-muted-foreground text-sm w-full">← Voltar</Button>
              </form>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-6">
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-bold mb-2">Reserva criada!</h3>
              <p className="text-muted-foreground text-sm mb-1">Complete o pagamento na página que abriu.</p>
              <p className="text-muted-foreground text-sm mb-4">
                {selectedOccurrence?.template.title} — {selectedDayLabel} — {selectedOccurrence?.template.time?.slice(0, 5)}
              </p>
              <p className="text-xs text-muted-foreground mb-6">Sua vaga será confirmada automaticamente após o pagamento.</p>
              <Button onClick={resetAndClose} variant="outline" className="rounded-full px-8">Fechar</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
};

export default ScheduleModal;
