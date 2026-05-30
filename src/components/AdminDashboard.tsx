import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Save, Loader2, Plus, Trash2, Ban, CheckCircle, Users, XCircle, FileDown, UserPlus, ChevronLeft, ChevronRight, Calendar } from "lucide-react";
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
  const [activeTab, setActiveTab] = useState<"templates" | "suspensions" | "reservations" | "weekly">("templates");
  const [weekOffset, setWeekOffset] = useState(0);
  const [weeklyReservations, setWeeklyReservations] = useState<Map<string, Reservation[]>>(new Map());
  const [loadingWeekly, setLoadingWeekly] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ classId: string; date: string; label: string } | null>(null);
  const [suspendDate, setSuspendDate] = useState("");
  const [suspendClassId, setSuspendClassId] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"confirmed" | "pending" | "all">("confirmed");
  const [filterClassId, setFilterClassId] = useState("");
  const [showManualForm, setShowManualForm] = useState(false);
  const [savingManual, setSavingManual] = useState(false);
  const [manualForm, setManualForm] = useState({ name: "", email: "", phone: "", classId: "", classDate: "", transactionCode: "" });

  const ADMIN_HASH = "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92";

  const hashPassword = async (pwd: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(pwd);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const fetchUsersByIds = async (ids: string[]) => {
    if (ids.length === 0) return [] as { id: string; name: string; email: string; phone: string | null }[];
    const { data } = await supabase.functions.invoke("admin-users", {
      body: { ids },
      headers: { "x-admin-hash": ADMIN_HASH },
    });
    return (data?.users || []) as { id: string; name: string; email: string; phone: string | null }[];
  };

  const fetchUserByEmail = async (email: string) => {
    const { data } = await supabase.functions.invoke("admin-users", {
      body: { email },
      headers: { "x-admin-hash": ADMIN_HASH },
    });
    const users = (data?.users || []) as { id: string; name: string; email: string; phone: string | null }[];
    return users[0] || null;
  };

  const adminCall = async <T = unknown>(action: string, payload: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke("admin", {
      body: { action, payload },
      headers: { "x-admin-hash": ADMIN_HASH },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data as T;
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

    let resData: Reservation[] = [];
    try {
      const res = await adminCall<{ data: Reservation[] }>("list_reservations", {
        status: filterStatus,
        classDate: filterDate || undefined,
        classId: filterClassId || undefined,
        limit: 200,
      });
      resData = res.data || [];
    } catch (e) {
      toast.error("Erro ao carregar reservas: " + (e instanceof Error ? e.message : "?"));
      setLoadingReservations(false);
      return;
    }

    if (!resData || resData.length === 0) {
      setReservations([]);
      setLoadingReservations(false);
      return;
    }

    // Get user, class and payment info
    const userIds = [...new Set(resData.map((r) => r.user_id))];
    const classIds = [...new Set(resData.map((r) => r.class_id))];
    const reservationIds = [...new Set(resData.map((r) => r.id))];

    const [usersData, classesRes, paymentsRes] = await Promise.all([
      fetchUsersByIds(userIds),
      supabase.from("classes").select("id, title, time").in("id", classIds),
      adminCall<{ data: { reservation_id: string; status: string; transaction_id: string | null; paid_at: string | null }[] }>(
        "list_payments_for_reservations",
        { reservationIds },
      ).catch(() => ({ data: [] })),
    ]);

    const usersMap = new Map((usersData || []).map((u) => [u.id, u]));
    const classesMap = new Map((classesRes.data || []).map((c) => [c.id, c]));

    const paymentsMap = new Map<string, { status: string; transaction_id: string | null; paid_at: string | null }>();
    for (const p of (paymentsRes.data || [])) {
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

  const getWeekDates = (offset: number) => {
    const today = new Date();
    const monday = new Date(today);
    const day = today.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    monday.setDate(today.getDate() + diff + offset * 7);
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return { date: `${yyyy}-${mm}-${dd}`, dow: i + 1, label: `${["Seg","Ter","Qua","Qui","Sex","Sáb"][i]} ${dd}/${mm}` };
    });
  };

  const fetchWeeklyReservations = async (offset: number) => {
    setLoadingWeekly(true);
    const dates = getWeekDates(offset).map((d) => d.date);
    let resData: Reservation[] = [];
    try {
      const r = await adminCall<{ data: Reservation[] }>("list_weekly_reservations", { dates });
      resData = r.data || [];
    } catch (e) {
      toast.error("Erro ao carregar semana: " + (e instanceof Error ? e.message : "?"));
      setLoadingWeekly(false);
      return;
    }

    if (!resData || resData.length === 0) {
      setWeeklyReservations(new Map());
      setLoadingWeekly(false);
      return;
    }

    const userIds = [...new Set(resData.map((r) => r.user_id))];
    const usersData = await fetchUsersByIds(userIds);
    const usersMap = new Map((usersData || []).map((u) => [u.id, u]));

    const map = new Map<string, Reservation[]>();
    for (const r of resData) {
      const user = usersMap.get(r.user_id);
      const key = `${r.class_id}_${r.class_date}`;
      const enriched = { ...r, user_name: user?.name || "?", user_email: user?.email || "?", user_phone: user?.phone || "" };
      map.set(key, [...(map.get(key) || []), enriched]);
    }
    setWeeklyReservations(map);
    setLoadingWeekly(false);
  };

  useEffect(() => {
    if (authenticated && activeTab === "reservations") {
      fetchReservations();
    }
  }, [authenticated, activeTab, filterDate, filterStatus, filterClassId]);

  useEffect(() => {
    if (authenticated && activeTab === "weekly") {
      fetchWeeklyReservations(weekOffset);
    }
  }, [authenticated, activeTab, weekOffset]);

  const handleSave = async (t: ClassTemplate) => {
    setSaving(t.id);
    try {
      await adminCall("update_class", {
        id: t.id,
        title: t.title,
        time: t.time,
        capacity: t.capacity,
        price: t.price,
        day_of_week: t.day_of_week,
        instructor: t.instructor,
        checkout_url: t.checkout_url,
      });
      toast.success("Salvo!");
    } catch (e) {
      toast.error("Erro: " + (e instanceof Error ? e.message : "?"));
    }
    setSaving(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este horário?")) return;
    try {
      await adminCall("delete_class", { id });
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      toast.success("Excluído!");
    } catch (e) {
      toast.error("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplate.title || !newTemplate.time) {
      toast.error("Preencha título e horário");
      return;
    }
    setAdding(true);
    try {
      const res = await adminCall<{ data: ClassTemplate }>("insert_class", {
        title: newTemplate.title,
        time: newTemplate.time,
        capacity: newTemplate.capacity,
        price: newTemplate.price,
        day_of_week: newTemplate.day_of_week === 0 ? null : newTemplate.day_of_week,
        instructor: newTemplate.instructor || null,
        checkout_url: newTemplate.checkout_url || null,
        date: null,
      });
      if (res?.data) {
        setTemplates((prev) => [...prev, res.data]);
        setNewTemplate({ title: "Sprint Bike", time: "", capacity: 10, price: 2990, day_of_week: 0, instructor: "", checkout_url: "https://pay.cakto.com.br/nkizirf_810528" });
        toast.success("Horário criado!");
      }
    } catch (e) {
      toast.error("Erro: " + (e instanceof Error ? e.message : "?"));
    }
    setAdding(false);
  };

  const handleCancelReservation = async (resId: string) => {
    if (!confirm("Cancelar esta reserva?")) return;
    try {
      await adminCall("cancel_reservation", { id: resId });
      setReservations((prev) => prev.map((r) => (r.id === resId ? { ...r, status: "canceled" } : r)));
      toast.success("Reserva cancelada!");
    } catch (e) {
      toast.error("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  };

  const handleMarkAsPaid = async (reservation: Reservation) => {
    const alreadyPaid = reservation.status === "confirmed" || reservation.payment_status === "paid";
    if (alreadyPaid) {
      toast.info("Essa reserva já está marcada como paga");
      return;
    }

    const manualCode = window.prompt("Código/transação do pagamento (opcional)")?.trim();
    try {
      const result = await adminCall<{ ok: boolean; transactionId: string; paidAt: string }>("mark_paid", {
        reservationId: reservation.id,
        userId: reservation.user_id,
        classId: reservation.class_id,
        transactionCode: manualCode,
      });
      setReservations((prev) =>
        prev.map((r) =>
          r.id === reservation.id
            ? { ...r, status: "confirmed", payment_status: "paid", transaction_id: result.transactionId, paid_at: result.paidAt }
            : r
        )
      );
      toast.success("Pagamento confirmado manualmente");
    } catch (e) {
      toast.error("Erro ao confirmar: " + (e instanceof Error ? e.message : "?"));
    }
  };
  const handleSuspend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspendDate || !suspendClassId) {
      toast.error("Selecione o horário e a data");
      return;
    }
    try {
      const res = await adminCall<{ data: Suspension; code?: string }>("insert_suspension", {
        class_id: suspendClassId, suspended_date: suspendDate,
      });
      if (res?.data) {
        setSuspensions((prev) => [...prev, res.data]);
        setSuspendDate("");
        toast.success("Aula suspensa!");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "?";
      if (msg.includes("23505") || msg.includes("duplicate")) toast.error("Essa data já está suspensa para esse horário");
      else toast.error("Erro: " + msg);
    }
  };

  const handleUnsuspend = async (id: string) => {
    try {
      await adminCall("delete_suspension", { id });
      setSuspensions((prev) => prev.filter((s) => s.id !== id));
      toast.success("Suspensão removida!");
    } catch (e) {
      toast.error("Erro: " + (e instanceof Error ? e.message : "?"));
    }
  };

  const handleManualReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    const { name, email, phone, classId, classDate, transactionCode } = manualForm;
    if (!name.trim() || !email.trim() || !classId || !classDate) {
      toast.error("Preencha nome, e-mail, aula e data");
      return;
    }
    setSavingManual(true);
    try {
      await adminCall("manual_reservation", {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.replace(/\D/g, ""),
        classId,
        classDate,
        transactionCode: transactionCode.trim(),
      });
      toast.success("Reserva manual criada com sucesso!");
      setManualForm({ name: "", email: "", phone: "", classId: "", classDate: "", transactionCode: "" });
      setShowManualForm(false);
      fetchReservations();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setSavingManual(false);
    }
  };

  const updateTemplate = (id: string, field: string, value: string | number | null) => {
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  };

   const isPastDate = (dateStr: string | null) => {
     if (!dateStr) return false;
     const today = new Date();
     today.setHours(0, 0, 0, 0);
     const [year, month, day] = dateStr.split("-").map(Number);
     const classDate = new Date(year, month - 1, day);
     return classDate < today;
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
        <DialogContent className="bg-card border-border sm:max-w-3xl max-h-[90vh] overflow-y-auto">
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
                <Button variant={activeTab === "weekly" ? "default" : "outline"} size="sm" onClick={() => setActiveTab("weekly")} className="rounded-full text-xs">
                  <Calendar className="w-3.5 h-3.5 mr-1" /> Semana
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

              {activeTab === "weekly" && (() => {
                const weekDates = getWeekDates(weekOffset);
                const uniqueTimes = [...new Set(templates.map((t) => t.time?.slice(0, 5)))].sort();
                const cellStudents = selectedCell ? (weeklyReservations.get(`${selectedCell.classId}_${selectedCell.date}`) || []) : [];

                return (
                  <div className="space-y-3">
                    {/* Navegação de semana */}
                    <div className="flex items-center justify-between">
                      <Button variant="outline" size="sm" onClick={() => setWeekOffset((o) => o - 1)} className="h-8 px-3">
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <span className="text-sm font-medium">
                        {weekOffset === 0 ? "Semana atual" : weekOffset > 0 ? `+${weekOffset} semana${weekOffset > 1 ? "s" : ""}` : `${weekOffset} semana${weekOffset < -1 ? "s" : ""}`}
                        {" · "}{weekDates[0].label.split(" ")[1]} – {weekDates[5].label.split(" ")[1]}
                      </span>
                      <Button variant="outline" size="sm" onClick={() => setWeekOffset((o) => o + 1)} className="h-8 px-3">
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>

                    {loadingWeekly ? (
                      <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse min-w-[520px]">
                          <thead>
                            <tr>
                              <th className="p-2 text-left text-muted-foreground font-medium w-14">Hora</th>
                              {weekDates.map((d) => {
                                const isToday = d.date === new Date().toISOString().slice(0, 10);
                                return (
                                  <th key={d.date} className={`p-2 text-center font-medium ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                                    {d.label}
                                  </th>
                                );
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {uniqueTimes.map((time) => (
                              <tr key={time} className="border-t border-border">
                                <td className="p-2 text-muted-foreground font-mono">{time}</td>
                                {weekDates.map((d) => {
                                  const cls = templates.find((t) => t.time?.slice(0, 5) === time && (!t.day_of_week || t.day_of_week === d.dow));
                                  if (!cls) return <td key={d.date} className="p-1" />;

                                  const key = `${cls.id}_${d.date}`;
                                  const reservas = weeklyReservations.get(key) || [];
                                  const confirmed = reservas.filter((r) => r.status === "confirmed").length;
                                  const pending = reservas.filter((r) => r.status === "pending").length;
                                  const total = cls.capacity;
                                  const full = confirmed >= total;
                                  const isSelected = selectedCell?.classId === cls.id && selectedCell?.date === d.date;

                                  return (
                                    <td key={d.date} className="p-1">
                                      <button
                                        onClick={() => setSelectedCell(isSelected ? null : { classId: cls.id, date: d.date, label: `${d.label} · ${time}` })}
                                        className={`w-full rounded-lg p-2 text-left transition-colors border ${
                                          isSelected
                                            ? "border-primary bg-primary/10"
                                            : full
                                              ? "border-destructive/40 bg-destructive/5 hover:bg-destructive/10"
                                              : "border-border bg-secondary hover:bg-secondary/60"
                                        }`}
                                      >
                                        <div className="font-medium truncate">{cls.instructor || cls.title}</div>
                                        <div className={`mt-0.5 font-bold ${full ? "text-destructive" : "text-primary"}`}>
                                          {confirmed}/{total}
                                          {pending > 0 && <span className="text-muted-foreground font-normal"> +{pending}p</span>}
                                        </div>
                                      </button>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Painel de alunos da célula selecionada */}
                    {selectedCell && (
                      <div className="border-t border-border pt-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold">{selectedCell.label}</h3>
                          <Button variant="ghost" size="sm" onClick={() => setSelectedCell(null)} className="h-7 px-2 text-xs">Fechar</Button>
                        </div>
                        {cellStudents.length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-3">Nenhuma reserva neste horário</p>
                        ) : (
                          cellStudents.map((r) => {
                            const paid = r.status === "confirmed";
                            return (
                              <div key={r.id} className="flex items-center justify-between p-2.5 bg-secondary rounded-lg border border-border">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${paid ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                                      {paid ? "Pago" : "Aguardando"}
                                    </span>
                                    <span className="text-sm font-medium">{r.user_name}</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-0.5">{r.user_email} {r.user_phone && `· ${r.user_phone}`}</p>
                                </div>
                                <Button
                                  size="sm" variant="ghost"
                                  onClick={async () => {
                                    if (!confirm("Cancelar esta reserva?")) return;
                                    try {
                                      await adminCall("cancel_reservation", { id: r.id });
                                      toast.success("Reserva cancelada!");
                                      fetchWeeklyReservations(weekOffset);
                                      setSelectedCell(null);
                                    } catch (e) {
                                      toast.error("Erro: " + (e instanceof Error ? e.message : "?"));
                                    }
                                  }}
                                  className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {activeTab === "reservations" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Apenas reservas <strong>pagas (confirmadas)</strong> aparecem por padrão. Use os filtros para ver pendentes ou todos.
                    </p>
                    <Button size="sm" onClick={() => setShowManualForm((v) => !v)} className="h-8 px-3 text-xs bg-primary text-primary-foreground shrink-0 ml-2">
                      <UserPlus className="w-3.5 h-3.5 mr-1" /> Nova Reserva
                    </Button>
                  </div>

                  {/* Manual reservation form */}
                  {showManualForm && (
                    <form onSubmit={handleManualReservation} className="p-4 bg-secondary rounded-xl border border-primary/30 space-y-3">
                      <h3 className="font-semibold text-sm flex items-center gap-2"><UserPlus className="w-4 h-4 text-primary" /> Reserva Manual</h3>
                      <p className="text-xs text-muted-foreground">Para trocar de dia: cancele a reserva antiga e crie uma nova aqui. A reserva já sai confirmada e paga.</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Nome do aluno *</Label>
                          <Input value={manualForm.name} onChange={(e) => setManualForm({ ...manualForm, name: e.target.value })} placeholder="Nome completo" className="bg-background border-border mt-1 h-9 text-sm" required />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">E-mail *</Label>
                          <Input type="email" value={manualForm.email} onChange={(e) => setManualForm({ ...manualForm, email: e.target.value })} placeholder="email@exemplo.com" className="bg-background border-border mt-1 h-9 text-sm" required />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Telefone</Label>
                          <Input value={manualForm.phone} onChange={(e) => setManualForm({ ...manualForm, phone: e.target.value })} placeholder="51999999999" className="bg-background border-border mt-1 h-9 text-sm" />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Data da aula *</Label>
                          <Input type="date" value={manualForm.classDate} onChange={(e) => setManualForm({ ...manualForm, classDate: e.target.value, classId: "" })} className="bg-background border-border mt-1 h-9 text-sm" required />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Horário *</Label>
                          <select
                            value={manualForm.classId}
                            onChange={(e) => setManualForm({ ...manualForm, classId: e.target.value })}
                            className="w-full h-9 mt-1 rounded-md border border-border bg-background px-3 text-sm"
                            required
                          >
                            <option value="">Selecione...</option>
                            {templates
                              .filter((t) => {
                                if (!manualForm.classDate) return true;
                                const selectedDay = new Date(`${manualForm.classDate}T12:00:00`).getDay();
                                const dbDay = selectedDay === 0 ? 7 : selectedDay;
                                return !t.day_of_week || t.day_of_week === dbDay;
                              })
                              .map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.title} — {t.time?.slice(0, 5)} ({t.day_of_week ? DAY_NAMES[t.day_of_week] : "Seg-Sáb"})
                                </option>
                              ))}
                          </select>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Código de transação (opcional)</Label>
                          <Input value={manualForm.transactionCode} onChange={(e) => setManualForm({ ...manualForm, transactionCode: e.target.value })} placeholder="Ex: PIX-12345 ou deixe vazio" className="bg-background border-border mt-1 h-9 text-sm" />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={() => setShowManualForm(false)} className="flex-1 h-9 text-xs rounded-full">Cancelar</Button>
                        <Button type="submit" disabled={savingManual} className="flex-1 h-9 text-xs bg-gradient-primary text-primary-foreground font-bold rounded-full">
                          {savingManual ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Criar Reserva Confirmada"}
                        </Button>
                      </div>
                    </form>
                  )}

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

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Data (opcional)</Label>
                      <Input
                        type="date"
                        value={filterDate}
                        onChange={(e) => { setFilterDate(e.target.value); setFilterClassId(""); }}
                        className="bg-secondary border-border h-9 text-sm mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Aula</Label>
                      <select
                        value={filterClassId}
                        onChange={(e) => setFilterClassId(e.target.value)}
                        className="w-full h-9 mt-1 rounded-md border border-border bg-secondary px-3 text-sm text-foreground"
                      >
                        <option value="">Todas as aulas</option>
                        {templates
                          .filter((t) => {
                            if (!filterDate) return true;
                            const selectedDay = new Date(`${filterDate}T12:00:00`).getDay();
                            // JS: 0=Sun,1=Mon..6=Sat → DB: 1=Mon..6=Sat
                            const dbDay = selectedDay === 0 ? 7 : selectedDay;
                            return !t.day_of_week || t.day_of_week === dbDay;
                          })
                          .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title} — {t.time?.slice(0, 5)} ({t.day_of_week ? DAY_NAMES[t.day_of_week] : "Seg-Sáb"})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
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
                      <Button type="button" variant="outline" onClick={() => { setFilterDate(""); setFilterClassId(""); }} className="h-9 flex-1 text-xs">
                        Limpar filtros
                      </Button>
                      <Button type="button" onClick={fetchReservations} className="h-9 flex-1 text-xs bg-primary text-primary-foreground" disabled={loadingReservations}>
                        {loadingReservations ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Atualizar"}
                      </Button>
                      <Button type="button" variant="outline" onClick={generatePDF} className="h-9 px-3 text-xs" title="Gerar PDF">
                        <FileDown className="w-3.5 h-3.5" />
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

                         const isPast = isPastDate(r.class_date);
 
                         return (
                            <div 
                              key={r.id} 
                              className={`flex items-center justify-between p-3 bg-secondary rounded-xl border border-border transition-colors hover:bg-secondary/80 ${
                                isPast ? "bg-muted/20 border-l-4 border-l-muted-foreground/30 grayscale-[0.2]" : ""
                              }`}
                            >
                             <div className="min-w-0 flex-1">
                               <div className="flex items-center gap-2 flex-wrap">
                                 {isPast && (
                                   <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                     Histórico
                                   </span>
                                 )}
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

                            <div className="flex items-center gap-1">
                              {!paid && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleMarkAsPaid(r)}
                                  className="h-7 px-2 text-xs text-primary hover:text-primary"
                                  title="Confirmar pagamento"
                                >
                                  <CheckCircle className="w-3.5 h-3.5" />
                                </Button>
                              )}

                              {!canceled && (
                                <Button size="sm" variant="ghost" onClick={() => handleCancelReservation(r.id)} className="h-7 px-2 text-xs text-destructive hover:text-destructive">
                                  <XCircle className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
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
