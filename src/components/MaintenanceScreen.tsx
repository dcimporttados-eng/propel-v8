import { useEffect, useState } from "react";
import { Wrench, Clock } from "lucide-react";

// Manutenção até hoje (horário de Brasília) às 23:00.
// Após esse horário, a página principal volta automaticamente.
const MAINTENANCE_END = (() => {
  const d = new Date();
  // 23:00 horário de Brasília = 02:00 UTC do dia seguinte
  d.setUTCHours(d.getUTCHours() <= 2 ? 2 : 26, 0, 0, 0);
  return d;
})();

export const isUnderMaintenance = () => false;

const MaintenanceScreen = () => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const diff = Math.max(0, MAINTENANCE_END.getTime() - now.getTime());
  const h = String(Math.floor(diff / 3_600_000)).padStart(2, "0");
  const m = String(Math.floor((diff % 3_600_000) / 60_000)).padStart(2, "0");
  const s = String(Math.floor((diff % 60_000) / 1000)).padStart(2, "0");

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="max-w-lg w-full text-center space-y-6">
        <div className="w-20 h-20 mx-auto rounded-full bg-primary/15 flex items-center justify-center">
          <Wrench className="w-10 h-10 text-primary" />
        </div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Sistema em manutenção
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          Estamos realizando atualizações no sistema de reservas do
          <span className="font-semibold text-foreground"> Pavilhão 8 Academia</span>.
          Voltamos hoje às <span className="font-semibold text-foreground">23h00</span>.
        </p>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-secondary/50">
          <Clock className="w-4 h-4 text-primary" />
          <span className="font-mono text-sm tabular-nums">
            {h}:{m}:{s}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Agradecemos a compreensão. Em caso de urgência, entre em contato pelo WhatsApp.
        </p>
      </div>
    </main>
  );
};

export default MaintenanceScreen;
