import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Clock, Users } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

const modalities = ["Sprint Bike"];

const scheduleData: Record<string, { time: string; slots: number }[]> = {
  "Sprint Bike": [
    { time: "06:00", slots: 4 },
    { time: "07:00", slots: 8 },
    { time: "12:00", slots: 2 },
    { time: "18:00", slots: 0 },
    { time: "19:00", slots: 5 },
  ],
  "Treinamento Funcional": [
    { time: "06:00", slots: 10 },
    { time: "07:00", slots: 12 },
    { time: "12:00", slots: 6 },
    { time: "18:00", slots: 3 },
    { time: "19:00", slots: 0 },
  ],
  "Performance Training": [
    { time: "06:00", slots: 2 },
    { time: "07:00", slots: 6 },
    { time: "12:00", slots: 0 },
    { time: "18:00", slots: 4 },
    { time: "19:00", slots: 1 },
  ],
};

interface ScheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialModality?: string;
}

const ScheduleModal = ({ open, onOpenChange, initialModality }: ScheduleModalProps) => {
  const [step, setStep] = useState(1);
  const [selectedModality, setSelectedModality] = useState(initialModality || "");
  const [selectedTime, setSelectedTime] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", email: "" });

  const resetAndClose = () => {
    setStep(1);
    setSelectedModality("");
    setSelectedTime("");
    setForm({ name: "", phone: "", email: "" });
    onOpenChange(false);
  };

  const handleSelectModality = (mod: string) => {
    setSelectedModality(mod);
    setStep(2);
  };

  const handleSelectTime = (time: string) => {
    setSelectedTime(time);
    setStep(3);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.phone || !form.email) return;
    setStep(4);
    toast.success("Vaga reservada com sucesso!", {
      description: `${selectedModality} às ${selectedTime}`,
    });
  };

  // Reset modality when modal opens with initialModality
  const handleOpenChange = (v: boolean) => {
    if (v && initialModality) {
      setSelectedModality(initialModality);
      setStep(2);
    }
    if (!v) resetAndClose();
    else onOpenChange(v);
  };

  const times = selectedModality ? scheduleData[selectedModality] || [] : [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            {step === 1 && "Escolha a modalidade"}
            {step === 2 && selectedModality}
            {step === 3 && "Seus dados"}
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
              {modalities.map((mod) => (
                <button
                  key={mod}
                  onClick={() => handleSelectModality(mod)}
                  className="w-full text-left p-4 rounded-xl bg-secondary border border-border hover:border-primary/50 transition-colors"
                >
                  <span className="font-semibold">{mod}</span>
                </button>
              ))}
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
              <p className="text-sm text-muted-foreground mb-2">Selecione um horário disponível:</p>
              {times.map(({ time, slots }) => (
                <button
                  key={time}
                  disabled={slots === 0}
                  onClick={() => handleSelectTime(time)}
                  className={`w-full flex items-center justify-between p-4 rounded-xl border transition-colors ${
                    slots === 0
                      ? "bg-muted/50 border-border opacity-50 cursor-not-allowed"
                      : "bg-secondary border-border hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Clock className="w-4 h-4 text-primary" />
                    <span className="font-semibold">{time}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-muted-foreground" />
                    <span className={`text-sm ${slots === 0 ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                      {slots === 0 ? "Lotada" : `${slots} vagas`}
                    </span>
                  </div>
                </button>
              ))}
              <Button variant="ghost" onClick={() => setStep(1)} className="text-muted-foreground text-sm">
                ← Voltar
              </Button>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <p className="text-sm text-muted-foreground mb-4">
                {selectedModality} — {selectedTime}
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="name">Nome</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Seu nome completo"
                    className="bg-secondary border-border mt-1"
                    required
                    maxLength={100}
                  />
                </div>
                <div>
                  <Label htmlFor="phone">Telefone</Label>
                  <Input
                    id="phone"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="(00) 00000-0000"
                    className="bg-secondary border-border mt-1"
                    required
                    maxLength={20}
                  />
                </div>
                <div>
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="seu@email.com"
                    className="bg-secondary border-border mt-1"
                    required
                    maxLength={255}
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full bg-gradient-primary text-primary-foreground font-bold rounded-full py-6 hover:scale-[1.02] transition-transform"
                >
                  Reservar vaga
                </Button>
                <Button variant="ghost" type="button" onClick={() => setStep(2)} className="text-muted-foreground text-sm w-full">
                  ← Voltar
                </Button>
              </form>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div key="step4" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-6">
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-bold mb-2">Reserva confirmada!</h3>
              <p className="text-muted-foreground text-sm mb-1">{selectedModality}</p>
              <p className="text-muted-foreground text-sm mb-6">Horário: {selectedTime}</p>
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
