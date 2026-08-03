import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Clock, Users, Loader2, ExternalLink, ChevronLeft, ChevronRight, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const DAY_NAMES = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const REGULAR_PRICE_CENTS = 2990;

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
  date: string;
  dayOfWeek: number;
  available: number;
}

interface CartItem {
  key: string; // class_id_date
  occurrence: ClassOccurrence;
}

interface ScheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialModality?: string;
}

const LAUNCH_DATE = new Date(2026, 2, 30);

function getNextWeekdays(): { date: string; dayOfWeek: number; label: string }[] {
  const days: { date: string; dayOfWeek: number; label: string }[] = [];
  const now = new Date();
  const start = now >= LAUNCH_DATE ? now : LAUNCH_DATE;

  for (let i = 0; days.length < 30; i++) {
    const candidate = new Date(start);
    candidate.setDate(start.getDate() + i);
    const dow = candidate.getDay();
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

const formatBRL = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const ScheduleModal = ({ open, onOpenChange, initialModality }: ScheduleModalProps) => {
  const [step, setStep] = useState(1); // 1=seleção, 2=resumo, 3=dados, 4=pagamento
  const [cart, setCart] = useState<CartItem[]>([]);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    cpfCnpj: "",
    postalCode: "",
    address: "",
    addressNumber: "",
    complement: "",
    province: "",
  });
  const [templates, setTemplates] = useState<ClassTemplate[]>([]);
  const [suspSet, setSuspSet] = useState<Set<string>>(new Set());
  const [reservationCounts, setReservationCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string>("");
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

      const [templatesRes, suspensionsRes, reservationsRes] = await Promise.all([
        supabase.from("classes").select("*").order("time", { ascending: true }),
        supabase.from("class_suspensions").select("*").in("suspended_date", dates),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.rpc as any)("get_class_occupancy", { p_dates: dates }),
      ]);

      const allTemplates = ((templatesRes.data || []) as ClassTemplate[]).filter(
        (t) =>
          t.capacity > 0 &&
          (!initialModality || t.title?.trim().toLowerCase() === initialModality.trim().toLowerCase())
      );
      setTemplates(allTemplates);

      setSuspSet(new Set(
        (suspensionsRes.data || []).map((s: { class_id: string; suspended_date: string }) => `${s.class_id}_${s.suspended_date}`)
      ));

      const counts = new Map<string, number>();
      for (const r of (reservationsRes.data || []) as { class_id: string; class_date: string; confirmed_count: number }[]) {
        const key = `${r.class_id}_${r.class_date}`;
        counts.set(key, r.confirmed_count);
      }
      setReservationCounts(counts);

      setLoading(false);
    };

    fetchData();
  }, [open, initialModality]);

  const resetAndClose = () => {
    setStep(1);
    setCart([]);
    setForm({ name: "", phone: "", email: "", cpfCnpj: "", postalCode: "", address: "", addressNumber: "", complement: "", province: "" });
    setSelectedDay("");
    setCheckoutUrl("");
    setWeekIndex(0);
    onOpenChange(false);
  };

  const weeks: typeof weekdays[] = [];
  for (let i = 0; i < weekdays.length; i += 6) {
    weeks.push(weekdays.slice(i, i + 6));
  }
  const currentWeek = weeks[weekIndex] || [];
  const weekLabel = currentWeek.length > 0 ? `Semana ${weekIndex + 1} de ${weeks.length}` : "";

  const toggleCartItem = (occ: ClassOccurrence) => {
    const key = `${occ.template.id}_${occ.date}`;
    setCart((prev) => {
      const exists = prev.find((c) => c.key === key);
      if (exists) return prev.filter((c) => c.key !== key);
      if (prev.length >= 10) {
        toast.error("Máximo de 10 reservas por pedido");
        return prev;
      }
      return [...prev, { key, occurrence: occ }];
    });
  };

  const removeFromCart = (key: string) => {
    setCart((prev) => prev.filter((c) => c.key !== key));
  };

  // Cálculo do total no front (espelha a lógica do servidor — servidor é a fonte da verdade)
  const priceBreakdown = useMemo(() => {
    const total = cart.reduce((a, c) => a + (c.occurrence.template.price || REGULAR_PRICE_CENTS), 0);
    return { total };
  }, [cart]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cpfDigits = form.cpfCnpj.replace(/\D/g, "");
    if (
      !form.name || !form.phone || !form.email || cart.length === 0 ||
      !form.postalCode || !form.address || !form.addressNumber || !form.province ||
      (cpfDigits.length !== 11 && cpfDigits.length !== 14)
    ) {
      toast.error("Preencha todos os dados, incluindo CPF/CNPJ e endereço válidos.");
      return;
    }

    setSubmitting(true);
    try {
      const items = cart.map((c) => ({
        class_id: c.occurrence.template.id,
        class_date: c.occurrence.date,
      }));

      const { data, error } = await supabase.functions.invoke("reserve", {
        body: {
          items,
          name: form.name,
          email: form.email,
          phone: form.phone,
          cpfCnpj: cpfDigits,
          postalCode: form.postalCode.replace(/\D/g, ""),
          address: form.address,
          addressNumber: form.addressNumber,
          complement: form.complement,
          province: form.province,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      if (data.checkout_url) {
        setCheckoutUrl(data.checkout_url);
        setStep(4);
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
        return { template: t, date: selectedDay, dayOfWeek: dayInfo.dayOfWeek, available: t.capacity - reserved };
      });
  })();

  const selectedDayLabel = weekdays.find((d) => d.date === selectedDay)?.label || "";
  const isInCart = (occ: ClassOccurrence) => cart.some((c) => c.key === `${occ.template.id}_${occ.date}`);

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? resetAndClose() : onOpenChange(v))}>
      <DialogContent className="bg-card border-border sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            {step === 1 && (initialModality || "Escolha seus horários")}
            {step === 2 && "Resumo do pedido"}
            {step === 3 && "Seus dados"}
            {step === 4 && "Finalize o pagamento"}
          </DialogTitle>
        </DialogHeader>

        {/* Progress */}
        <div className="flex gap-1 mb-2">
          {[1, 2, 3, 4].map((s) => (
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

                  {currentDayOccurrences.map((occ) => {
                    const inCart = isInCart(occ);
                    const isFull = occ.available <= 0;
                    return (
                      <button
                        key={`${occ.template.id}_${occ.date}`}
                        disabled={isFull}
                        onClick={() => toggleCartItem(occ)}
                        className={`w-full flex items-center justify-between p-4 rounded-xl border transition-colors ${
                          isFull
                            ? "bg-muted/50 border-border opacity-50 cursor-not-allowed"
                            : inCart
                              ? "bg-primary/15 border-primary"
                              : "bg-secondary border-border hover:border-primary/50"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <Clock className={`w-4 h-4 ${inCart ? "text-primary" : "text-primary"}`} />
                          <div className="text-left">
                            <span className="font-semibold">{occ.template.time?.slice(0, 5)}</span>
                            <span className="text-xs text-muted-foreground ml-2">{occ.template.title}</span>
                            {occ.template.instructor && (
                              <p className="text-xs text-primary/80">Prof. {occ.template.instructor}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {inCart ? (
                            <span className="text-xs font-bold text-primary">✓ Selecionada</span>
                          ) : (
                            <>
                              <Users className="w-4 h-4 text-muted-foreground" />
                              <span className={`text-sm ${isFull ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                                {isFull ? "Lotada" : `${occ.available} vagas`}
                              </span>
                            </>
                          )}
                        </div>
                      </button>
                    );
                  })}

                  {/* Mini-resumo flutuante */}
                  {cart.length > 0 && (
                    <div className="sticky bottom-0 -mx-6 px-6 pt-3 pb-1 bg-card border-t border-border">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-muted-foreground">
                          {cart.length} {cart.length === 1 ? "aula" : "aulas"} selecionada{cart.length === 1 ? "" : "s"}
                        </span>
                        <span className="font-bold text-lg">{formatBRL(priceBreakdown.total)}</span>
                      </div>
                      <Button
                        onClick={() => setStep(2)}
                        className="w-full bg-gradient-primary text-primary-foreground font-bold rounded-full py-5 hover:scale-[1.02] transition-transform"
                      >
                        Continuar →
                      </Button>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
              <div className="space-y-2">
                {cart.map((c) => {
                  const dayLabel = weekdays.find((d) => d.date === c.occurrence.date)?.label || c.occurrence.date;
                  return (
                    <div key={c.key} className="flex items-center justify-between p-3 rounded-xl bg-secondary border border-border">
                      <div className="text-left text-sm">
                        <p className="font-semibold">{c.occurrence.template.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {dayLabel} — {c.occurrence.template.time?.slice(0, 5)}
                        </p>
                      </div>
                      <button
                        onClick={() => removeFromCart(c.key)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive transition-colors"
                        aria-label="Remover"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-border pt-3 space-y-1">
                <div className="flex justify-between font-bold text-lg pt-1">
                  <span>Total</span>
                  <span>{formatBRL(priceBreakdown.total)}</span>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="ghost" onClick={() => setStep(1)} className="flex-1 text-muted-foreground">← Voltar</Button>
                <Button
                  onClick={() => setStep(3)}
                  disabled={cart.length === 0}
                  className="flex-1 bg-gradient-primary text-primary-foreground font-bold rounded-full hover:scale-[1.02] transition-transform"
                >
                  Continuar →
                </Button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <p className="text-sm text-muted-foreground mb-4">
                {cart.length} {cart.length === 1 ? "aula" : "aulas"} — Total {formatBRL(priceBreakdown.total)}
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
                <div>
                  <Label htmlFor="cpfCnpj">CPF</Label>
                  <Input id="cpfCnpj" value={form.cpfCnpj} onChange={(e) => setForm({ ...form, cpfCnpj: e.target.value })} placeholder="000.000.000-00" className="bg-secondary border-border mt-1" required maxLength={18} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="postalCode">CEP</Label>
                    <Input id="postalCode" value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} placeholder="00000-000" className="bg-secondary border-border mt-1" required maxLength={9} />
                  </div>
                  <div>
                    <Label htmlFor="province">Bairro</Label>
                    <Input id="province" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} placeholder="Seu bairro" className="bg-secondary border-border mt-1" required maxLength={100} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <Label htmlFor="address">Endereço</Label>
                    <Input id="address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Rua/Av." className="bg-secondary border-border mt-1" required maxLength={150} />
                  </div>
                  <div>
                    <Label htmlFor="addressNumber">Número</Label>
                    <Input id="addressNumber" value={form.addressNumber} onChange={(e) => setForm({ ...form, addressNumber: e.target.value })} placeholder="Nº" className="bg-secondary border-border mt-1" required maxLength={20} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="complement">Complemento (opcional)</Label>
                  <Input id="complement" value={form.complement} onChange={(e) => setForm({ ...form, complement: e.target.value })} placeholder="Apto, bloco, etc." className="bg-secondary border-border mt-1" maxLength={100} />
                </div>
                <Button type="submit" disabled={submitting} className="w-full bg-gradient-primary text-primary-foreground font-bold rounded-full py-6 hover:scale-[1.02] transition-transform">
                  {submitting ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Processando...</> : <>Reservar e pagar {formatBRL(priceBreakdown.total)} <ExternalLink className="w-4 h-4 ml-2" /></>}
                </Button>
                <Button variant="ghost" type="button" onClick={() => setStep(2)} className="text-muted-foreground text-sm w-full">← Voltar</Button>
              </form>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div key="step4" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-6">
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                <ExternalLink className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-bold mb-2">Reserva criada!</h3>
              <p className="text-muted-foreground text-sm mb-1">
                {cart.length} {cart.length === 1 ? "aula reservada" : "aulas reservadas"} — Total {formatBRL(priceBreakdown.total)}
              </p>
              <p className="text-muted-foreground text-sm mb-4">Clique no botão abaixo para realizar o pagamento:</p>

              <a
                href={checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center w-full rounded-full px-8 py-4 bg-gradient-primary text-primary-foreground font-bold text-lg hover:scale-[1.02] transition-transform mb-4"
              >
                <ExternalLink className="w-5 h-5 mr-2" /> Pagar agora
              </a>

              <p className="text-xs text-muted-foreground mb-4">Após o pagamento, sua reserva será confirmada automaticamente.</p>
              <Button onClick={resetAndClose} variant="ghost" className="text-muted-foreground text-sm w-full">Fechar</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
};

export default ScheduleModal;
