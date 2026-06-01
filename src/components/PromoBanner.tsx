import { useEffect, useState } from "react";
import { X, Flame, Heart, ShieldCheck, Snowflake } from "lucide-react";

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
        className="relative w-full max-w-md rounded-2xl border-2 border-primary bg-gradient-to-br from-background via-background to-primary/10 shadow-2xl animate-in zoom-in-95 duration-300 overflow-hidden"
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
          className="absolute top-3 right-3 z-10 rounded-full bg-background/80 p-1.5 text-foreground hover:bg-background"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-6 pt-8 space-y-5">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-2 text-primary">
              <Snowflake className="h-5 w-5" />
              <span className="text-xs font-bold tracking-widest uppercase">
                Promoção de Inverno
              </span>
              <Snowflake className="h-5 w-5" />
            </div>
            <h2 className="text-3xl font-black leading-tight text-foreground">
              PARA NÃO PERDER O{" "}
              <span className="text-primary">PIQUE NO FRIO</span>
            </h2>
          </div>

          {/* Price */}
          <div className="rounded-xl border-2 border-primary bg-primary/10 p-4 text-center">
            <p className="text-sm font-bold text-foreground">
              2 AULAS DE SPINNING POR
            </p>
            <p className="text-5xl font-black text-primary mt-1">
              R$ 39<span className="text-3xl">,90</span>
            </p>
          </div>

          {/* Benefits */}
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-sm">
              <Flame className="h-5 w-5 text-primary shrink-0" />
              <span className="font-semibold text-foreground">Acelere seus resultados</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Heart className="h-5 w-5 text-primary shrink-0" />
              <span className="font-semibold text-foreground">Mais energia e disposição</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
              <span className="font-semibold text-foreground">Fortaleça sua saúde e imunidade</span>
            </div>
          </div>

          {/* CTA */}
          <button
            onClick={handleReserve}
            className="w-full rounded-xl bg-primary py-4 text-base font-black uppercase tracking-wide text-primary-foreground hover:bg-primary/90 transition-colors shadow-lg"
          >
            Reservar minha vaga
          </button>
          <p className="text-center text-xs text-muted-foreground">
            Disciplina hoje, resultados sempre!
          </p>
        </div>
      </div>
    </div>
  );
};

export default PromoBanner;