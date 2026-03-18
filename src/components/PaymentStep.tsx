import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface PaymentStepProps {
  pixQrCode: string;
  pixCopyPaste: string;
  amount: number;
  paymentId: string;
  reservationId: string;
  onConfirmed: () => void;
}

const PaymentStep = ({
  pixQrCode,
  pixCopyPaste,
  amount,
  paymentId,
  reservationId,
  onConfirmed,
}: PaymentStepProps) => {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<"pending" | "paid">("pending");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pixCopyPaste);
      setCopied(true);
      toast.success("Código PIX copiado!");
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast.error("Erro ao copiar código");
    }
  };

  // Listen for payment confirmation via realtime
  useEffect(() => {
    const channel = supabase
      .channel(`payment-${paymentId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "payments",
          filter: `id=eq.${paymentId}`,
        },
        (payload) => {
          if (payload.new.status === "paid") {
            setStatus("paid");
            onConfirmed();
          }
        }
      )
      .subscribe();

    // Also poll every 5s as fallback
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("payments")
        .select("status")
        .eq("id", paymentId)
        .single();

      if (data?.status === "paid") {
        setStatus("paid");
        onConfirmed();
        clearInterval(interval);
      }
    }, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [paymentId, onConfirmed]);

  const formattedAmount = (amount / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  if (status === "paid") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center py-6"
      >
        <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4">
          <Check className="w-8 h-8 text-primary" />
        </div>
        <h3 className="text-lg font-bold mb-2">Pagamento confirmado!</h3>
        <p className="text-muted-foreground text-sm">Sua vaga está garantida</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-4"
    >
      <div className="text-center">
        <p className="text-2xl font-bold text-primary mb-1">{formattedAmount}</p>
        <p className="text-sm text-muted-foreground">Pague via PIX para confirmar sua vaga</p>
      </div>

      {/* QR Code */}
      {pixQrCode && (
        <div className="flex justify-center p-4 bg-white rounded-xl">
          <img
            src={pixQrCode}
            alt="QR Code PIX"
            className="w-48 h-48 object-contain"
          />
        </div>
      )}

      {/* Copy paste code */}
      {pixCopyPaste && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">Código PIX copia e cola:</p>
          <div className="flex gap-2">
            <div className="flex-1 bg-secondary rounded-lg p-3 text-xs text-foreground break-all font-mono max-h-20 overflow-y-auto">
              {pixCopyPaste}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={handleCopy}
              className="shrink-0"
            >
              {copied ? (
                <Check className="w-4 h-4 text-primary" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Status indicator */}
      <div className="flex items-center justify-center gap-2 py-3 bg-secondary/50 rounded-lg">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Aguardando pagamento...</span>
      </div>

      <p className="text-xs text-center text-muted-foreground">
        O pagamento expira em 60 minutos
      </p>
    </motion.div>
  );
};

export default PaymentStep;
