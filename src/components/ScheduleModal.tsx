import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Clock, Users, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import PaymentStep from "./PaymentStep";

interface ClassSlot {
  id: string;
  title: string;
  date: string;
  time: string;
  capacity: number;
  price: number;
  available?: number;
}

interface ScheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialModality?: string;
}

const ScheduleModal = ({ open, onOpenChange, initialModality }: ScheduleModalProps) => {
  const [step, setStep] = useState(1);
  const [selectedClass, setSelectedClass] = useState<ClassSlot | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const [classes, setClasses] = useState<ClassSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [paymentData, setPaymentData] = useState<{
    pixQrCode: string;
    pixCopyPaste: string;
    amount: number;
    paymentId: string;
    reservationId: string;
  } | null>(null);

  // Fetch classes from DB
  useEffect(() => {
    if (!open) return;

    const fetchClasses = async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("*")
        .order("date", { ascending: true })
        .order("time", { ascending: true });

      if (error) {
        console.error("Error fetching classes:", error);
        return;
      }

      // Get available spots for each class
      const classesWithSpots = await Promise.all(
        (data || []).map(async (cls) => {
          const { data: spots } = await supabase.rpc("get_available_spots", {
            p_class_id: cls.id,
          });
          return { ...cls, available: spots ?? cls.capacity };
        })
      );

      setClasses(classesWithSpots);

      // Auto-advance if initialModality is set
      if (initialModality) {
        setStep(1); // Show time selection directly
      }
    };

    fetchClasses();
  }, [open, initialModality]);

  const resetAndClose = () => {
    setStep(1);
    setSelectedClass(null);
    setForm({ name: "", phone: "", email: "" });
    setPaymentData(null);
    onOpenChange(false);
  };

  const handleSelectTime = (cls: ClassSlot) => {
    setSelectedClass(cls);
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.phone || !form.email || !selectedClass) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("reserve", {
        body: {
          class_id: selectedClass.id,
          name: form.name,
          email: form.email,
          phone: form.phone,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      setPaymentData({
        pixQrCode: data.pix_qr_code || "",
        pixCopyPaste: data.pix_copy_paste || "",
        amount: data.amount,
        paymentId: data.payment_id,
        reservationId: data.reservation_id,
      });
      setStep(3);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro ao criar reserva";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentConfirmed = useCallback(() => {
    setStep(4);
    toast.success("Pagamento confirmado! Sua vaga está garantida.");
  }, []);

  const handleOpenChange = (v: boolean) => {
    if (!v) resetAndClose();
    else onOpenChange(v);
  };

  const filteredClasses = initialModality
    ? classes.filter((c) => c.title === initialModality)
    : classes;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            {step === 1 && (initialModality || "Escolha o horário")}
            {step === 2 && "Seus dados"}
            {step === 3 && "Pagamento PIX"}
            {step === 4 && "Reserva confirmada!"}
          </DialogTitle>
        </DialogHeader>

        {/* Progress */}
        <div className="flex gap-1 mb-4">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${
                s <= step ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
              <p className="text-sm text-muted-foreground mb-2">Selecione um horário disponível:</p>
              {filteredClasses.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhuma aula disponível</p>
              )}
              {filteredClasses.map((cls) => {
                const available = cls.available ?? cls.capacity;
                return (
                  <button
                    key={cls.id}
                    disabled={available <= 0}
                    onClick={() => handleSelectTime(cls)}
                    className={`w-full flex items-center justify-between p-4 rounded-xl border transition-colors ${
                      available <= 0
                        ? "bg-muted/50 border-border opacity-50 cursor-not-allowed"
                        : "bg-secondary border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Clock className="w-4 h-4 text-primary" />
                      <span className="font-semibold">{cls.time?.slice(0, 5)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <span className={`text-sm ${available <= 0 ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                        {available <= 0 ? "Lotada" : `${available} vagas`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <p className="text-sm text-muted-foreground mb-4">
                {selectedClass?.title} — {selectedClass?.time?.slice(0, 5)}
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
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-primary text-primary-foreground font-bold rounded-full py-6 hover:scale-[1.02] transition-transform"
                >
                  {loading ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Processando...</>
                  ) : (
                    "Reservar e pagar"
                  )}
                </Button>
                <Button variant="ghost" type="button" onClick={() => setStep(1)} className="text-muted-foreground text-sm w-full">
                  ← Voltar
                </Button>
              </form>
            </motion.div>
          )}

          {step === 3 && paymentData && (
            <PaymentStep
              pixQrCode={paymentData.pixQrCode}
              pixCopyPaste={paymentData.pixCopyPaste}
              amount={paymentData.amount}
              paymentId={paymentData.paymentId}
              reservationId={paymentData.reservationId}
              onConfirmed={handlePaymentConfirmed}
            />
          )}

          {step === 4 && (
            <motion.div key="step4" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-6">
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-bold mb-2">Pagamento confirmado!</h3>
              <p className="text-muted-foreground text-sm mb-1">Sua vaga está garantida</p>
              <p className="text-muted-foreground text-sm mb-6">
                {selectedClass?.title} — {selectedClass?.time?.slice(0, 5)}
              </p>
              <Button onClick={resetAndClose} className="bg-gradient-primary text-primary-foreground rounded-full px-8">
                Fechar
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
};

export default ScheduleModal;
