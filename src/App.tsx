// @ts-nocheck
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useState, useEffect } from "react";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Confirmacao from "./pages/Confirmacao.tsx";

const queryClient = new QueryClient();

// Maintenance mode: set to a timestamp when maintenance ends
const MAINTENANCE_UNTIL = new Date("2026-03-23T13:00:00-03:00"); // ~5 min from now

const MaintenancePage = () => {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    const tick = () => {
      const diff = MAINTENANCE_UNTIL.getTime() - Date.now();
      if (diff <= 0) {
        window.location.reload();
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${mins}:${String(secs).padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="text-center space-y-4 max-w-md">
        <div className="text-6xl">🔧</div>
        <h1 className="text-2xl font-bold text-foreground">Site em manutenção</h1>
        <p className="text-muted-foreground">Estamos fazendo melhorias rápidas. Voltamos em instantes!</p>
        <div className="text-4xl font-mono font-bold text-primary">{timeLeft}</div>
      </div>
    </div>
  );
};

const App = () => {
  const isMaintenanceMode = Date.now() < MAINTENANCE_UNTIL.getTime();

  if (isMaintenanceMode) {
    return <MaintenancePage />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/confirmacao" element={<Confirmacao />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
