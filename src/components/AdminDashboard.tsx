import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Save, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface ClassRow {
  id: string;
  title: string;
  date: string;
  time: string;
  capacity: number;
  price: number;
  checkout_url: string | null;
}

const AdminDashboard = () => {
  const [open, setOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [newClass, setNewClass] = useState({ title: "", date: "", time: "", capacity: 10, price: 3000 });
  const [adding, setAdding] = useState(false);

  const ADMIN_HASH = "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"; // sha256 of "123456"

  const hashPassword = async (pwd: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(pwd);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const hashed = await hashPassword(password);
    if (hashed === ADMIN_HASH) {
      setAuthenticated(true);
      setPassword("");
      fetchClasses();
    } else {
      toast.error("Senha incorreta");
    }
  };

  const fetchClasses = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("classes")
      .select("*")
      .order("date", { ascending: true })
      .order("time", { ascending: true });

    if (error) {
      toast.error("Erro ao carregar aulas");
      console.error(error);
    } else {
      setClasses(data || []);
    }
    setLoading(false);
  };

  const handleSave = async (cls: ClassRow) => {
    setSaving(cls.id);
    const { error } = await supabase
      .from("classes")
      .update({
        title: cls.title,
        date: cls.date,
        time: cls.time,
        capacity: cls.capacity,
        price: cls.price,
      })
      .eq("id", cls.id);

    if (error) {
      toast.error("Erro ao salvar: " + error.message);
    } else {
      toast.success("Aula atualizada!");
    }
    setSaving(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir esta aula?")) return;
    const { error } = await supabase.from("classes").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir: " + error.message);
    } else {
      setClasses((prev) => prev.filter((c) => c.id !== id));
      toast.success("Aula excluída!");
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClass.title || !newClass.date || !newClass.time) {
      toast.error("Preencha título, data e horário");
      return;
    }
    setAdding(true);
    const { data, error } = await supabase
      .from("classes")
      .insert({
        title: newClass.title,
        date: newClass.date,
        time: newClass.time,
        capacity: newClass.capacity,
        price: newClass.price,
        checkout_url: "https://pay.cakto.com.br/nkizirf_810528",
      })
      .select()
      .single();

    if (error) {
      toast.error("Erro ao criar aula: " + error.message);
    } else if (data) {
      setClasses((prev) => [...prev, data]);
      setNewClass({ title: "", date: "", time: "", capacity: 10, price: 3000 });
      toast.success("Aula criada!");
    }
    setAdding(false);
  };

  const updateClass = (id: string, field: keyof ClassRow, value: string | number) => {
    setClasses((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  };

  const handleClose = () => {
    setOpen(false);
    setAuthenticated(false);
    setPassword("");
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="opacity-20 hover:opacity-60 transition-opacity p-1"
        aria-label="Administração"
      >
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
                <Input
                  id="admin-pass"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Digite a senha"
                  className="bg-secondary border-border mt-1"
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full bg-gradient-primary text-primary-foreground font-bold rounded-full">
                Entrar
              </Button>
            </form>
          ) : loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Existing classes */}
              <div className="space-y-3">
                {classes.map((cls) => (
                  <div key={cls.id} className="p-4 bg-secondary rounded-xl border border-border space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs text-muted-foreground">Título</Label>
                        <Input
                          value={cls.title}
                          onChange={(e) => updateClass(cls.id, "title", e.target.value)}
                          className="bg-background border-border mt-1 h-9 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Data</Label>
                        <Input
                          type="date"
                          value={cls.date}
                          onChange={(e) => updateClass(cls.id, "date", e.target.value)}
                          className="bg-background border-border mt-1 h-9 text-sm"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs text-muted-foreground">Horário</Label>
                        <Input
                          type="time"
                          value={cls.time?.slice(0, 5)}
                          onChange={(e) => updateClass(cls.id, "time", e.target.value)}
                          className="bg-background border-border mt-1 h-9 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Vagas</Label>
                        <Input
                          type="number"
                          min={1}
                          value={cls.capacity}
                          onChange={(e) => updateClass(cls.id, "capacity", parseInt(e.target.value) || 1)}
                          className="bg-background border-border mt-1 h-9 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Preço (centavos)</Label>
                        <Input
                          type="number"
                          min={0}
                          value={cls.price}
                          onChange={(e) => updateClass(cls.id, "price", parseInt(e.target.value) || 0)}
                          className="bg-background border-border mt-1 h-9 text-sm"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDelete(cls.id)}
                        className="h-8 px-3 text-xs"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" /> Excluir
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleSave(cls)}
                        disabled={saving === cls.id}
                        className="h-8 px-3 text-xs bg-primary text-primary-foreground"
                      >
                        {saving === cls.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <><Save className="w-3.5 h-3.5 mr-1" /> Salvar</>
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add new class */}
              <div className="border-t border-border pt-4">
                <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Nova Aula
                </h3>
                <form onSubmit={handleAdd} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Título</Label>
                      <Input
                        value={newClass.title}
                        onChange={(e) => setNewClass({ ...newClass, title: e.target.value })}
                        placeholder="Ex: Sprint Bike"
                        className="bg-secondary border-border mt-1 h-9 text-sm"
                        required
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Data</Label>
                      <Input
                        type="date"
                        value={newClass.date}
                        onChange={(e) => setNewClass({ ...newClass, date: e.target.value })}
                        className="bg-secondary border-border mt-1 h-9 text-sm"
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Horário</Label>
                      <Input
                        type="time"
                        value={newClass.time}
                        onChange={(e) => setNewClass({ ...newClass, time: e.target.value })}
                        className="bg-secondary border-border mt-1 h-9 text-sm"
                        required
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Vagas</Label>
                      <Input
                        type="number"
                        min={1}
                        value={newClass.capacity}
                        onChange={(e) => setNewClass({ ...newClass, capacity: parseInt(e.target.value) || 1 })}
                        className="bg-secondary border-border mt-1 h-9 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Preço (centavos)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={newClass.price}
                        onChange={(e) => setNewClass({ ...newClass, price: parseInt(e.target.value) || 0 })}
                        className="bg-secondary border-border mt-1 h-9 text-sm"
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    disabled={adding}
                    className="w-full bg-gradient-primary text-primary-foreground font-bold rounded-full h-10"
                  >
                    {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : "Adicionar Aula"}
                  </Button>
                </form>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AdminDashboard;
