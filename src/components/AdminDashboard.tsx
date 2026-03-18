import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Save, Loader2, Plus, Trash2, Ban, CheckCircle } from "lucide-react";
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

const AdminDashboard = () => {
  const [open, setOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [templates, setTemplates] = useState<ClassTemplate[]>([]);
  const [suspensions, setSuspensions] = useState<Suspension[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [newTemplate, setNewTemplate] = useState({ title: "Sprint Bike", time: "", capacity: 10, price: 3000, day_of_week: 0, instructor: "" });
  const [adding, setAdding] = useState(false);
  const [activeTab, setActiveTab] = useState<"templates" | "suspensions">("templates");
  const [suspendDate, setSuspendDate] = useState("");
  const [suspendClassId, setSuspendClassId] = useState("");

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
        date: null as unknown as string, // nullable now
        checkout_url: "https://pay.cakto.com.br/nkizirf_810528",
      })
      .select()
      .single();
    if (error) toast.error("Erro: " + error.message);
    else if (data) {
      setTemplates((prev) => [...prev, data as ClassTemplate]);
      setNewTemplate({ title: "Sprint Bike", time: "", capacity: 10, price: 3000, day_of_week: 0 });
      toast.success("Horário criado!");
    }
    setAdding(false);
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
    const dayLabel = t.day_of_week ? DAY_NAMES[t.day_of_week] : "Seg-Sex";
    return `${t.title} ${dayLabel} ${t.time?.slice(0, 5)}`;
  };

  const handleClose = () => {
    setOpen(false);
    setAuthenticated(false);
    setPassword("");
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="opacity-20 hover:opacity-60 transition-opacity p-1" aria-label="Administração">
        <Lock className="w-3.5 h-3.5 text-muted-foreground" />
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
              </div>

              {activeTab === "templates" && (
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground">Configure os horários semanais. "Todos os dias" = Seg-Sex. Ou escolha um dia específico.</p>

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
                            <option value={0}>Todos (Seg-Sex)</option>
                            {[1, 2, 3, 4, 5].map((d) => (
                              <option key={d} value={d}>{DAY_NAMES[d]}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Horário</Label>
                          <Input type="time" value={t.time?.slice(0, 5)} onChange={(e) => updateTemplate(t.id, "time", e.target.value)} className="bg-background border-border mt-1 h-9 text-sm" />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Vagas</Label>
                          <Input type="number" min={1} value={t.capacity} onChange={(e) => updateTemplate(t.id, "capacity", parseInt(e.target.value) || 1)} className="bg-background border-border mt-1 h-9 text-sm" />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Preço (centavos)</Label>
                          <Input type="number" min={0} value={t.price} onChange={(e) => updateTemplate(t.id, "price", parseInt(e.target.value) || 0)} className="bg-background border-border mt-1 h-9 text-sm" />
                        </div>
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
                            <option value={0}>Todos (Seg-Sex)</option>
                            {[1, 2, 3, 4, 5].map((d) => (
                              <option key={d} value={d}>{DAY_NAMES[d]}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Horário</Label>
                          <Input type="time" value={newTemplate.time} onChange={(e) => setNewTemplate({ ...newTemplate, time: e.target.value })} className="bg-secondary border-border mt-1 h-9 text-sm" required />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Vagas</Label>
                          <Input type="number" min={1} value={newTemplate.capacity} onChange={(e) => setNewTemplate({ ...newTemplate, capacity: parseInt(e.target.value) || 1 })} className="bg-secondary border-border mt-1 h-9 text-sm" />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Preço (centavos)</Label>
                          <Input type="number" min={0} value={newTemplate.price} onChange={(e) => setNewTemplate({ ...newTemplate, price: parseInt(e.target.value) || 0 })} className="bg-secondary border-border mt-1 h-9 text-sm" />
                        </div>
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
                              {t.title} — {t.time?.slice(0, 5)} ({t.day_of_week ? DAY_NAMES[t.day_of_week] : "Seg-Sex"})
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
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AdminDashboard;
