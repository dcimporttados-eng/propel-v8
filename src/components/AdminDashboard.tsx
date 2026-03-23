import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Save, Loader2, Plus, Trash2, Ban, CheckCircle, Users, XCircle, FileDown } from "lucide-react";
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

interface Suspension {
  id: string;
  class_id: string;
  suspended_date: string;
}

interface Reservation {
  id: string;
  class_id: string;
  class_date: string | null;
  status: string;
  created_at: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  user_phone?: string;
  class_title?: string;
  class_time?: string;
  payment_status?: string | null;
  transaction_id?: string | null;
  paid_at?: string | null;
}

const AdminDashboard = () => {
  const [open, setOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [templates, setTemplates] = useState<ClassTemplate[]>([]);
  const [suspensions, setSuspensions] = useState<Suspension[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingReservations, setLoadingReservations] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [newTemplate, setNewTemplate] = useState({ title: "Sprint Bike", time: "", capacity: 10, price: 2990, day_of_week: 0, instructor: "", checkout_url: "https://pay.cakto.com.br/nkizirf_810528" });
  const [adding, setAdding] = useState(false);
  const [activeTab, setActiveTab] = useState<"templates" | "suspensions" | "reservations">("templates");
  const [suspendDate, setSuspendDate] = useState("");
  const [suspendClassId, setSuspendClassId] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"confirmed" | "pending" | "all">("confirmed");
  const [filterClassId, setFilterClassId] = useState("");

  const ADMIN_HASH = "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92";

  const hashPassword = async (pwd: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(pwd);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const hashed = await hashPassword(password);
    if (hashed === ADMIN_HASH) {
      setAuthenticated(true);
      setPassword("");
      fetchData();
    } else {
      toast.error("Senha incorreta");
    }
  };

  const fetchData = async () => {
    setLoading(true);
    const [templatesRes, suspensionsRes] = await Promise.all([
      supabase.from("classes").select("*").order("time", { ascending: true }),
      supabase.from("class_suspensions").select("*").order("suspended_date", { ascending: true }),
    ]);
    if (templatesRes.data) setTemplates(templatesRes.data as ClassTemplate[]);
    if (suspensionsRes.data) setSuspensions(suspensionsRes.data as Suspension[]);
    setLoading(false);
  };

  const fetchReservations = async () => {
    setLoadingReservations(true);

    let reservationsQuery = supabase
      .from("reservations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (filterStatus === "confirmed") {
      reservationsQuery = reservationsQuery.eq("status", "confirmed");
    } else if (filterStatus === "pending") {
      reservationsQuery = reservationsQuery.eq("status", "pending");
    } else {
      reservationsQuery = reservationsQuery.in("status", ["pending", "confirmed", "canceled"]);
    }

    if (filterDate) {
      reservationsQuery = reservationsQuery.eq("class_date", filterDate);
    }

    if (filterClassId) {
      reservationsQuery = reservationsQuery.eq("class_id", filterClassId);
    }

    const { data: resData } = await reservationsQuery;

    if (!resData || resData.length === 0) {
      setReservations([]);
      setLoadingReservations(false);
      return;
    }

    // Get user, class and payment info
    const userIds = [...new Set(resData.map((r) => r.user_id))];
    const classIds = [...new Set(resData.map((r) => r.class_id))];
    const reservationIds = [...new Set(resData.map((r) => r.id))];

    const [usersRes, classesRes, paymentsRes] = await Promise.all([
      supabase.from("users").select("id, name, email, phone").in("id", userIds),
      supabase.from("classes").select("id, title, time").in("id", classIds),
      supabase
        .from("payments")
        .select("reservation_id, status, transaction_id, paid_at, created_at")
        .in("reservation_id", reservationIds)
        .order("created_at", { ascending: false }),
    ]);

    const usersMap = new Map((usersRes.data || []).map((u) => [u.id, u]));
    const classesMap = new Map((classesRes.data || []).map((c) => [c.id, c]));

    const paymentsMap = new Map<string, { status: string; transaction_id: string | null; paid_at: string | null }>();
    for (const p of (paymentsRes.data || []) as { reservation_id: string; status: string; transaction_id: string | null; paid_at: string | null }[]) {
      // payments are ordered by created_at desc, so first entry is the latest
      if (!paymentsMap.has(p.reservation_id)) {
        paymentsMap.set(p.reservation_id, {
          status: p.status,
          transaction_id: p.transaction_id,
          paid_at: p.paid_at,
        });
      }
    }

    const enriched: Reservation[] = resData.map((r) => {
      const user = usersMap.get(r.user_id);
      const cls = classesMap.get(r.class_id);
      const payment = paymentsMap.get(r.id);

      return {
        ...r,
        user_name: user?.name || "?",
        user_email: user?.email || "?",
        user_phone: user?.phone || "",
        class_title: cls?.title || "?",
        class_time: cls?.time?.slice(0, 5) || "?",
        payment_status: payment?.status || null,
        transaction_id: payment?.transaction_id || null,
        paid_at: payment?.paid_at || null,
      };
    });

    setReservations(enriched);
    setLoadingReservations(false);
  };

  useEffect(() => {
    if (authenticated && activeTab === "reservations") {
      fetchReservations();
    }
  }, [authenticated, activeTab, filterDate, filterStatus, filterClassId]);

  const handleSave = async (t: ClassTemplate) => {
    setSaving(t.id);
    const { error } = await supabase
      .from("classes")
      .update({
        title: t.title,
        time: t.time,
        capacity: t.capacity,
        price: t.price,
        day_of_week: t.day_of_week,
        instructor: t.instructor,
        checkout_url: t.checkout_url,
      })
      .eq("id", t.id);
    if (error) toast.error("Erro: " + error.message);
    else toast.success("Salvo!");
    setSaving(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este horário?")) return;
    const { error } = await supabase.from("classes").delete().eq("id", id);
    if (error) toast.error("Erro: " + error.message);
    else {
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      toast.success("Excluído!");
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplate.title || !newTemplate.time) {
      toast.error("Preencha título e horário");
      return;
    }
    setAdding(true);
    const { data, error } = await supabase
      .from("classes")
      .insert({
        title: newTemplate.title,
        time: newTemplate.time,
        capacity: newTemplate.capacity,
        price: newTemplate.price,
        day_of_week: newTemplate.day_of_week === 0 ? null : newTemplate.day_of_week,
        instructor: newTemplate.instructor || null,
        checkout_url: newTemplate.checkout_url || null,
        date: null as unknown as string,
      })
      .select()
      .single();
    if (error) toast.error("Erro: " + error.message);
    else if (data) {
      setTemplates((prev) => [...prev, data as ClassTemplate]);
      setNewTemplate({ title: "Sprint Bike", time: "", capacity: 10, price: 2990, day_of_week: 0, instructor: "", checkout_url: "https://pay.cakto.com.br/nkizirf_810528" });
      toast.success("Horário criado!");
    }
    setAdding(false);
  };

  const handleCancelReservation = async (resId: string) => {
    if (!confirm("Cancelar esta reserva?")) return;
    const { error } = await supabase
      .from("reservations")
      .update({ status: "canceled" })
      .eq("id", resId);
    if (error) toast.error("Erro: " + error.message);
    else {
      setReservations((prev) => prev.map((r) => (r.id === resId ? { ...r, status: "canceled" } : r)));
      toast.success("Reserva cancelada!");
    }
  };

  const handleSuspend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspendDate || !suspendClassId) {
      toast.error("Selecione o horário e a data");
      return;
    }
    const { data, error } = await supabase
      .from("class_suspensions")
      .insert({ class_id: suspendClassId, suspended_date: suspendDate })
      .select()
      .single();
    if (error) {
      if (error.code === "23505") toast.error("Essa data já está suspensa para esse horário");
      else toast.error("Erro: " + error.message);
    } else if (data) {
      setSuspensions((prev) => [...prev, data as Suspension]);
      setSuspendDate("");
      toast.success("Aula suspensa!");
    }
  };

  const handleUnsuspend = async (id: string) => {
    const { error } = await supabase.from("class_suspensions").delete().eq("id", id);
    if (error) toast.error("Erro: " + error.message);
    else {
      setSuspensions((prev) => prev.filter((s) => s.id !== id));
      toast.success("Suspensão removida!");
    }
  };

  const updateTemplate = (id: string, field: string, value: string | number | null) => {
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  };

  const getTemplateName = (classId: string) => {
    const t = templates.find((t) => t.id === classId);
    if (!t) return "?";
    const dayLabel = t.day_of_week ? DAY_NAMES[t.day_of_week] : "Seg-Sáb";
    return `${t.title} ${dayLabel} ${t.time?.slice(0, 5)}`;
  };

  const handleClose = () => {
    setOpen(false);
    setAuthenticated(false);
    setPassword("");
    setSearchTerm("");
  };

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const visibleReservations = reservations.filter((r) => {
    if (!normalizedSearch) return true;

    const haystack = `${r.user_name || ""} ${r.user_email || ""} ${r.user_phone || ""} ${r.class_title || ""} ${r.class_time || ""}`.toLowerCase();
    return haystack.includes(normalizedSearch);
  });

  const generatePDF = () => {
    if (visibleReservations.length === 0) {
      toast.error("Nenhuma reserva para exportar");
      return;
    }

    const dateLabel = filterDate
      ? new Date(`${filterDate}T12:00:00`).toLocaleDateString("pt-BR")
      : "Todas as datas";
    const classLabel = filterClassId
      ? templates.find((t) => t.id === filterClassId)?.title || "Aula"
      : "Todas as aulas";
    const statusLabel = filterStatus === "confirmed" ? "Pagas" : filterStatus === "pending" ? "Aguardando" : "Todas";

    const confirmed = visibleReservations.filter((r) => r.status === "confirmed" || r.payment_status === "paid");

    const rows = visibleReservations.map((r, i) => {
      const paid = r.status === "confirmed" || r.payment_status === "paid";
      const canceled = r.status === "canceled";
      const status = canceled ? "Cancelada" : paid ? "Pago" : "Pendente";
      const classDate = r.class_date ? new Date(`${r.class_date}T12:00:00`).toLocaleDateString("pt-BR") : "-";
      return `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #333;">${i + 1}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #333;">${r.user_name || "-"}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #333;">${r.user_phone || "-"}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #333;">${r.class_title || "-"} ${r.class_time || ""}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #333;">${classDate}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #333;">${status}</td>
        </tr>`;
    });

    const html = `
      <html><head><meta charset="utf-8"><title>Agendamentos</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 30px; color: #222; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .subtitle { color: #666; font-size: 13px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; padding: 8px 10px; background: #f5c518; color: #000; font-weight: 600; }
        .summary { margin-top: 16px; font-size: 13px; color: #555; }
        @media print { body { margin: 15px; } }
      </style></head><body>
      <h1>📋 Agendamentos — FUNTRAINING</h1>
      <div class="subtitle">${dateLabel} · ${classLabel} · Status: ${statusLabel} · Gerado em ${new Date().toLocaleString("pt-BR")}</div>
      <table>
        <thead><tr><th>#</th><th>Aluno(a)</th><th>Telefone</th><th>Aula</th><th>Data</th><th>Status</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
      <div class="summary">${confirmed.length} confirmadas de ${visibleReservations.length} total</div>
      </body></html>`;

    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 400);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="opacity-70 hover:opacity-100 transition-opacity px-2 py-1 rounded-md border border-border bg-card text-xs text-muted-foreground hover:text-foreground"
        aria-label="Administração"
      >
        <span className="inline-flex items-center gap-1">
          <Lock className="w-3.5 h-3.5" /> Painel
        </span>
      </button>

      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent className="bg-card border-border sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              {authenticated ? "Gerenciar Aulas" : "Acesso Restrito"}
            </DialogTitle>
          </DialogHeader>

          {!authenticated ? (
            <form onSubmit={handleLogin} className="space-y-4 py-4">
              <div>
                <Label htmlFor="admin-pass">Senha de administrador</Label>
                <Input id="admin-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Digite a senha" className="bg-secondary border-border mt-1" autoFocus />
              </div>
              <Button type="submit" className="w-full bg-gradient-primary text-primary-foreground font-bold rounded-full">Entrar</Button>
            </form>
          ) : loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : (
            <div className="space-y-4">
              {/* Tabs */}
              <div className="flex gap-2">
                <Button variant={activeTab === "templates" ? "default" : "outline"} size="sm" onClick={() => setActiveTab("templates")} className="rounded-full text-xs">
                  Horários
                </Button>
                <Button variant={activeTab === "suspensions" ? "default" : "outline"} size="sm" onClick={() => setActiveTab("suspensions")} className="rounded-full text-xs">
                  Suspensões
                </Button>
                <Button variant={activeTab === "reservations" ? "default" : "outline"} size="sm" onClick={() => setActiveTab("reservations")} className="rounded-full text-xs">
                  <Users className="w-3.5 h-3.5 mr-1" /> Reservas
                </Button>
              </div>

              {activeTab === "templates" && (
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground">Configure os horários semanais. "Todos os dias" = Seg-Sáb. Ou escolha um dia específico.</p>

                  {templates.map((t) => (
                    <div key={t.id} className="p-4 bg-secondary rounded-xl border border-border space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Título</Label>
                          <Input value={t.title} onChange={(e) => updateTemplate(t.id, "title", e.target.value)} className="bg-background border-border mt-1 h-9 text-sm" />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Dia da semana</Label>
                          <select
                            value={t.day_of_week ?? 0}
                            onChange={(e) => updateTemplate(t.id, "day_of_week", parseInt(e.target.value) || null)}
                            className="w-full h-9 mt-1 rounded-md border border-border bg-background px-3 text-sm"
                          >
                            <option value={0}>Todos (Seg-Sáb)</option>
                            {[1, 2, 3, 4, 5, 6].map((d) => (
                              <option key={d} value={d}>{DAY_NAMES[d]}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Horário</Label>
                          <Input type="time" value={t.time?.slice(0, 5)} onChange={(e) => updateTemplate(t.id, "time", e.target.value)} className="bg-background border-border mt-1 h-9 text-sm" />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Professora</Label>
                          <Input value={t.instructor || ""} onChange={(e) => updateTemplate(t.id, "instructor", e.target.value)} placeholder="Nome da professora" className="bg-background border-border mt-1 h-9 text-sm" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Vagas</Label>
                          <Input type="number" min={1} value={t.capacity} onChange={(e) => updateTemplate(t.id, "capacity", parseInt(e.target.value) || 1)} className="bg-background border-border mt-1 h-9 text-sm" />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Preço (centavos)</Label>
                          <Input type="number" min={0} value={t.price} onChange={(e) => updateTemplate(t.id, "price", parseInt(e.target.value) || 0)} className="bg-background border-border mt-1 h-9 text-sm" />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">URL de Checkout (Cakto)</Label>
                        <Input value={t.checkout_url || ""} onChange={(e) => updateTemplate(t.id, "checkout_url", e.target.value)} placeholder="https://pay.cakto.com.br/..." className="bg-background border-border mt-1 h-9 text-sm" />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(t.id)} className="h-8 px-3 text-xs">
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Excluir
                        </Button>
                        <Button size="sm" onClick={() => handleSave(t)} disabled={saving === t.id} className="h-8 px-3 text-xs bg-primary text-primary-foreground">
                          {saving === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Save className="w-3.5 h-3.5 mr-1" /> Salvar</>}
                        </Button>
                      </div>
                    </div>
                  ))}

                  {/* Add new */}
                  <div className="border-t border-border pt-4">
                    <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><Plus className="w-4 h-4" /> Novo Horário</h3>
                    <form onSubmit={handleAdd} className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Título</Label>
                          <Input value={newTemplate.title} onChange={(e) => setNewTemplate({ ...newTemplate, title: e.target.value })} className="bg-secondary border-border mt-1 h-9 text-sm" required />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Dia da semana</Label>
                          <select
                            value={newTemplate.day_of_week}
                            onChange={(e) => setNewTemplate({ ...newTemplate, day_of_week: parseInt(e.target.value) })}
                            className="w-full h-9 mt-1 rounded-md border border-border bg-secondary px-3 text-sm"
                          >
                            <option value={0}>Todos (Seg-Sáb)</option>
                            {[1, 2, 3, 4, 5, 6].map((d) => (
                              <option key={d} value={d}>{DAY_NAMES[d]}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Horário</Label>
                          <Input type="time" value={newTemplate.time} onChange={(e) => setNewTemplate({ ...newTemplate, time: e.target.value })} className="bg-secondary border-border mt-1 h-9 text-sm" required />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Professora</Label>
                          <Input value={newTemplate.instructor} onChange={(e) => setNewTemplate({ ...newTemplate, instructor: e.target.value })} placeholder="Nome da professora" className="bg-secondary border-border mt-1 h-9 text-sm" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Vagas</Label>
                          <Input type="number" min={1} value={newTemplate.capacity} onChange={(e) => setNewTemplate({ ...newTemplate, capacity: parseInt(e.target.value) || 1 })} className="bg-secondary border-border mt-1 h-9 text-sm" />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Preço (centavos)</Label>
                          <Input type="number" min={0} value={newTemplate.price} onChange={(e) => setNewTemplate({ ...newTemplate, price: parseInt(e.target.value) || 0 })} className="bg-secondary border-border mt-1 h-9 text-sm" />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">URL de Checkout (Cakto)</Label>
                        <Input value={newTemplate.checkout_url} onChange={(e) => setNewTemplate({ ...newTemplate, checkout_url: e.target.value })} placeholder="https://pay.cakto.com.br/..." className="bg-secondary border-border mt-1 h-9 text-sm" />
                      </div>
                      <Button type="submit" disabled={adding} className="w-full bg-gradient-primary text-primary-foreground font-bold rounded-full h-10">
                        {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : "Adicionar Horário"}
                      </Button>
                    </form>
                  </div>
                </div>
              )}

              {activeTab === "suspensions" && (
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground">Suspenda uma aula em uma data específica. Alunos não verão esse horário no dia suspenso.</p>

                  {/* Add suspension */}
                  <form onSubmit={handleSuspend} className="p-4 bg-secondary rounded-xl border border-border space-y-3">
                    <h3 className="font-semibold text-sm flex items-center gap-2"><Ban className="w-4 h-4" /> Suspender aula</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs text-muted-foreground">Horário</Label>
                        <select
                          value={suspendClassId}
                          onChange={(e) => setSuspendClassId(e.target.value)}
                          className="w-full h-9 mt-1 rounded-md border border-border bg-background px-3 text-sm"
                          required
                        >
                          <option value="">Selecione...</option>
                          {templates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.title} — {t.time?.slice(0, 5)} ({t.day_of_week ? DAY_NAMES[t.day_of_week] : "Seg-Sáb"})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Data</Label>
                        <Input type="date" value={suspendDate} onChange={(e) => setSuspendDate(e.target.value)} className="bg-background border-border mt-1 h-9 text-sm" required />
                      </div>
                    </div>
                    <Button type="submit" variant="destructive" className="w-full rounded-full h-9 text-sm">
                      <Ban className="w-3.5 h-3.5 mr-1" /> Suspender
                    </Button>
                  </form>

                  {/* List suspensions */}
                  {suspensions.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">Nenhuma suspensão ativa</p>
                  ) : (
                    <div className="space-y-2">
                      {suspensions.map((s) => (
                        <div key={s.id} className="flex items-center justify-between p-3 bg-secondary rounded-xl border border-border">
                          <div>
                            <span className="text-sm font-medium">{getTemplateName(s.class_id)}</span>
                            <span className="text-xs text-muted-foreground ml-2">
                              {new Date(s.suspended_date + "T12:00:00").toLocaleDateString("pt-BR")}
                            </span>
                          </div>
                          <Button size="sm" variant="outline" onClick={() => handleUnsuspend(s.id)} className="h-7 px-2 text-xs">
                            <CheckCircle className="w-3.5 h-3.5 mr-1" /> Reativar
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "reservations" && (
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground">
                    Apenas reservas <strong>pagas (confirmadas)</strong> aparecem por padrão. Use os filtros para ver pendentes ou todos.
                  </p>

                  {/* Status filter tabs */}
                  <div className="flex gap-1.5">
                    {([
                      { key: "confirmed" as const, label: "✅ Pagas" },
                      { key: "pending" as const, label: "⏳ Aguardando" },
                      { key: "all" as const, label: "Todas" },
                    ]).map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => setFilterStatus(key)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                          filterStatus === key
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-secondary border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="grid sm:grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Data (opcional)</Label>
                      <Input
                        type="date"
                        value={filterDate}
                        onChange={(e) => setFilterDate(e.target.value)}
                        className="bg-secondary border-border h-9 text-sm mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Buscar aluno</Label>
                      <Input
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Nome, e-mail ou telefone"
                        className="bg-secondary border-border h-9 text-sm mt-1"
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <Button type="button" variant="outline" onClick={() => setFilterDate("")} className="h-9 w-full text-xs">
                        Limpar data
                      </Button>
                      <Button type="button" onClick={fetchReservations} className="h-9 w-full text-xs bg-primary text-primary-foreground" disabled={loadingReservations}>
                        {loadingReservations ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Atualizar"}
                      </Button>
                    </div>
                  </div>

                  {loadingReservations ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
                  ) : visibleReservations.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">Nenhuma reserva com estes filtros</p>
                  ) : (
                    <div className="space-y-2">
                      {visibleReservations.map((r) => {
                        const paid = r.status === "confirmed" || r.payment_status === "paid";
                        const canceled = r.status === "canceled";

                        return (
                          <div key={r.id} className="flex items-center justify-between p-3 bg-secondary rounded-xl border border-border">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                    canceled
                                      ? "bg-destructive/15 text-destructive"
                                      : paid
                                        ? "bg-primary/15 text-primary"
                                        : "bg-muted text-muted-foreground"
                                  }`}
                                >
                                  {canceled ? "Cancelada" : paid ? "Pago" : "Aguardando pagamento"}
                                </span>
                                <span className="text-sm font-medium truncate">{r.user_name}</span>
                              </div>

                              <p className="text-xs text-muted-foreground mt-0.5">
                                {r.class_title} {r.class_time} {r.class_date ? `— ${new Date(`${r.class_date}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {r.user_email} {r.user_phone && `— ${r.user_phone}`}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Reserva: {new Date(r.created_at).toLocaleString("pt-BR")}
                                {r.transaction_id ? ` · TX: ${r.transaction_id}` : ""}
                                {r.paid_at ? ` · Pago em: ${new Date(r.paid_at).toLocaleString("pt-BR")}` : ""}
                              </p>
                            </div>

                            {!canceled && (
                              <Button size="sm" variant="ghost" onClick={() => handleCancelReservation(r.id)} className="h-7 px-2 text-xs text-destructive hover:text-destructive">
                                <XCircle className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        );
                      })}

                      <p className="text-xs text-muted-foreground text-center pt-2">
                        {visibleReservations.filter((r) => r.status === "confirmed").length} confirmadas · {visibleReservations.filter((r) => r.status === "pending").length} pendentes · {visibleReservations.filter((r) => r.status === "canceled").length} canceladas
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AdminDashboard;
