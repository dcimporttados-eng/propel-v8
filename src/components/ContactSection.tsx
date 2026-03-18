import { motion } from "framer-motion";
import { Instagram, MessageCircle, MapPin } from "lucide-react";
import AdminDashboard from "./AdminDashboard";

const ContactSection = () => {
  return (
    <section id="contato" className="py-24 px-4 border-t border-border">
      <div className="container mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <span className="text-primary font-semibold tracking-[0.2em] uppercase text-sm">
            Contato
          </span>
          <h2 className="text-3xl md:text-5xl font-black uppercase mt-3">
            Fale <span className="text-gradient">conosco</span>
          </h2>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="grid md:grid-cols-3 gap-6 max-w-3xl mx-auto"
        >
          <a
            href="https://instagram.com/pavilhao8"
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-3 p-8 bg-card rounded-2xl border border-border hover:border-primary/40 transition-colors group"
          >
            <Instagram className="w-8 h-8 text-primary group-hover:scale-110 transition-transform" />
            <span className="font-semibold">Instagram</span>
            <span className="text-sm text-muted-foreground">@pavilhao8</span>
          </a>

          <a
            href="https://wa.me/5500000000000"
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-3 p-8 bg-card rounded-2xl border border-border hover:border-primary/40 transition-colors group"
          >
            <MessageCircle className="w-8 h-8 text-primary group-hover:scale-110 transition-transform" />
            <span className="font-semibold">WhatsApp</span>
            <span className="text-sm text-muted-foreground">Fale agora</span>
          </a>

          <div className="flex flex-col items-center gap-3 p-8 bg-card rounded-2xl border border-border">
            <MapPin className="w-8 h-8 text-primary" />
            <span className="font-semibold">Localização</span>
            <span className="text-sm text-muted-foreground text-center">
              Av. Principal, 800 — Centro
            </span>
          </div>
        </motion.div>

        {/* Footer */}
        <div className="mt-20 pt-8 border-t border-border text-center">
          <div className="flex items-center justify-center gap-2">
            <p className="text-sm text-muted-foreground">
              © 2026 Pavilhão 8 — Centro de Treinamento. Todos os direitos reservados.
            </p>
            <AdminDashboard />
          </div>
        </div>
      </div>
    </section>
  );
};

export default ContactSection;
