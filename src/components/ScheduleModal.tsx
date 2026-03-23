import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Clock, Users, Loader2, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
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

const LAUNCH_DATE = new Date(2026, 2, 30); // March 30, 2026

function getNextWeekdays(): { date: string; dayOfWeek: number; label: string }[] {
  const days: { date: string; dayOfWeek: number; label: string }[] = [];
  const now = new Date();
  // Start from today or launch date, whichever is later
  const start = now >= LAUNCH_DATE ? now : LAUNCH_DATE;
  
  for (let i = 0; days.length < 15; i++) {
    const candidate = new Date(start);
    candidate.setDate(start.getDate() + i);
    const dow = candidate.getDay(); // 0=Sun, 1=Mon...5=Fri, 6=Sat
    if (dow >= 1 && dow <= 6) {
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
  const [templates, setTemplates] = useState<ClassTemplate[]>([]);
  const [suspSet, setSuspSet] = useState<Set<string>>(new Set());
  const [reservationCounts, setReservationCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [lastReservationId, setLastReservationId] = useState<string>("");
  const [checkoutUrl, setCheckoutUrl] = useState<string>("");
  const [weekdays, setWeekdays] = useState<{ date: string; dayOfWeek: number; label: string }[]>([]);
  const [weekIndex, setWeekIndex] = useState(0);

  useEffect(() => {
    if (!open) return;

    const fetchData = async () => {
      setLoading(true);
      const days = getNextWeekdays();
      setWeekdays(days);
      if (days.length > 0) setSelectedDay(days[0].date);

      const dates = days.map((d) => d.date);

      // Fetch templates, suspensions, and reservations in parallel
      const [templatesRes, suspensionsRes, reservationsRes] = await Promise.all([
        supabase.from("classes").select("*").order("time", { ascending: true }),
        supabase.from("class_suspensions").select("*").in("suspended_date", dates),
        supabase.from("reservations").select("class_id, class_date").in("status", ["pending", "confirmed"]).in("class_date", dates),
      ]);

      const allTemplates = ((templatesRes.data || []) as ClassTemplate[]).filter(
        (t) => !initialModality || t.title === initialModality
      );
      setTemplates(allTemplates);

      setSuspSet(new Set(
        (suspensionsRes.data || []).map((s: { class_id: string; suspended_date: string }) => `${s.class_id}_${s.suspended_date}`)
      ));

      // Count reservations per class+date
      const counts = new Map<string, number>();
      for (const r of (reservationsRes.data || []) as { class_id: string; class_date: string }[]) {
        const key = `${r.class_id}_${r.class_date}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      setReservationCounts(counts);

      setLoading(false);
    };

    fetchData();
  }, [open, initialModality]);

  const resetAndClose = () => {
    setStep(1);
    setSelectedOccurrence(null);
    setForm({ name: "", phone: "", email: "" });
    setSelectedDay("");
    setLastReservationId("");
    setCheckoutUrl("");
    setWeekIndex(0);
    onOpenChange(false);
  };

  // Split weekdays into weeks of 6 (Mon-Sat)
  const weeks: typeof weekdays[] = [];
  for (let i = 0; i < weekdays.length; i += 6) {
    weeks.push(weekdays.slice(i, i + 6));
  }
  const currentWeek = weeks[weekIndex] || [];
  const weekLabel = currentWeek.length > 0
    ? `Semana ${weekIndex + 1} de ${weeks.length}`
    : "";

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
        // Open checkout in new tab and show step 3 with return link
        setLastReservationId(data.reservation_id || "");
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

  const currentDayOccurrences: ClassOccurrence[] = (() => {
    const dayInfo = weekdays.find((d) => d.date === selectedDay);
    if (!dayInfo) return [];
    return templates
      .filter((t) => {
        if (t.day_of_week !== null && t.day_of_week !== dayInfo.dayOfWeek) return false;
        if (suspSet.has(`${t.id}_${selectedDay}`)) return false;
        return true;
      })
      .map((t) => {
        const reserved = reservationCounts.get(`${t.id}_${selectedDay}`) || 0;
        return {
          template: t,
          date: selectedDay,
          dayOfWeek: dayInfo.dayOfWeek,
          available: t.capacity - reserved,
        };
      });
  })();

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
                   {/* Week navigation */}
                   <div className="flex items-center justify-between mb-2">
                     <button
                       onClick={() => setWeekIndex((i) => Math.max(0, i - 1))}
                       disabled={weekIndex === 0}
                       className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                     >
                       <ChevronLeft className="w-4 h-4" />
                     </button>
                     <span className="text-xs text-muted-foreground font-medium">{weekLabel}</span>
                     <button
                       onClick={() => setWeekIndex((i) => Math.min(weeks.length - 1, i + 1))}
                       disabled={weekIndex >= weeks.length - 1}
                       className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                     >
                       <ChevronRight className="w-4 h-4" />
                     </button>
                   </div>

                   {/* Day buttons - one week at a time */}
                   <div className="grid grid-cols-6 gap-1.5">
                     {currentWeek.map((day) => {
                       const [dayName, dateStr] = day.label.split(" ");
                       const shortDay = dayName.slice(0, 3);
                       return (
                         <button
                           key={day.date}
                           onClick={() => setSelectedDay(day.date)}
                           className={`flex flex-col items-center py-2 rounded-xl text-xs font-semibold transition-colors border ${
                             selectedDay === day.date
                               ? "bg-primary text-primary-foreground border-primary"
                               : "bg-secondary border-border text-muted-foreground hover:border-primary/50"
                           }`}
                         >
                           <span className="text-[10px] uppercase">{shortDay}</span>
                           <span className="text-sm font-bold">{dateStr}</span>
                         </button>
                       );
                     })}
                   </div>

                   <p className="text-sm text-muted-foreground mt-2">Horários para {selectedDayLabel}:</p>

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
                          {occ.template.instructor && (
                            <p className="text-xs text-primary/80">Prof. {occ.template.instructor}</p>
                          )}
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
              <h3 className="text-lg font-bold mb-2">Quase lá!</h3>
              <p className="text-muted-foreground text-sm mb-1">Complete o pagamento na aba que abriu.</p>
              <p className="text-muted-foreground text-sm mb-4">
                {selectedOccurrence?.template.title} — {selectedDayLabel} — {selectedOccurrence?.template.time?.slice(0, 5)}
              </p>
              <p className="text-xs text-muted-foreground mb-6">Após pagar, clique no botão abaixo para confirmar sua reserva.</p>
              <Button
                onClick={() => {
                  resetAndClose();
                  // Navigate to confirmation page
                  window.location.href = `/confirmacao?src=${encodeURIComponent(
                    lastReservationId
                  )}`;
                }}
                className="rounded-full px-8 bg-gradient-primary text-primary-foreground font-bold"
              >
                <Check className="w-4 h-4 mr-2" /> Já paguei — confirmar reserva
              </Button>
              <Button onClick={resetAndClose} variant="ghost" className="text-muted-foreground text-sm w-full mt-2">Fechar</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
};

export default ScheduleModal;
