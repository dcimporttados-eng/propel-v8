import { useEffect, useState } from "react";
import { X } from "lucide-react";
import promoImage from "@/assets/promo-combos.png.asset.json";

interface PromoBannerProps {
  onScheduleClick: () => void;
}

const DURATION_MS = 8000;

const PromoBanner = ({ onScheduleClick }: PromoBannerProps) => {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    if (sessionStorage.getItem("promo_banner_seen")) return;
    sessionStorage.setItem("promo_banner_seen", "1");
    setOpen(true);

    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.max(0, 100 - (elapsed / DURATION_MS) * 100);
      setProgress(pct);
      if (elapsed >= DURATION_MS) {
        clearInterval(interval);
        setOpen(false);
      }
    }, 50);

    return () => clearInterval(interval);
  }, []);

  if (!open) return null;

  const handleReserve = () => {
    setOpen(false);
    onScheduleClick();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 animate-in fade-in duration-300"
      onClick={() => setOpen(false)}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border-2 border-primary bg-background shadow-2xl animate-in zoom-in-95 duration-300 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-primary/20">
          <div
            className="h-full bg-primary transition-all ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>

        <button
          onClick={() => setOpen(false)}
          className="absolute top-3 right-3 z-10 rounded-full bg-background/90 p-1.5 text-foreground hover:bg-background"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>

        <img
          src={promoImage.url}
          alt="Promoção: 5 aulas ganhe 1, 10 aulas ganhe 2"
          className="w-full h-auto block"
        />

        <div className="p-5 space-y-3 border-t border-border">
          <p className="text-center text-xs text-muted-foreground leading-relaxed">
            Reserve <span className="font-bold text-foreground">5 aulas</span> e ganhe <span className="font-bold text-primary">1 grátis</span> · Reserve <span className="font-bold text-foreground">10 aulas</span> e ganhe <span className="font-bold text-primary">2 grátis</span>.
            <br />
            Após o pagamento, envie o comprovante no WhatsApp <span className="font-bold text-foreground">(51) 98046-7233</span> para agendar sua(s) aula(s) bônus.
          </p>
          <button
            onClick={handleReserve}
            className="w-full rounded-xl bg-primary py-3 text-base font-black uppercase tracking-wide text-primary-foreground hover:bg-primary/90 transition-colors shadow-lg"
          >
            Garantir meu combo
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromoBanner;