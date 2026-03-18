import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";

interface CTASectionProps {
  onScheduleClick: () => void;
}

const CTASection = ({ onScheduleClick }: CTASectionProps) => {
  return (
    <section className="py-24 px-4">
      <div className="container mx-auto max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="relative rounded-3xl bg-card border border-border p-12 md:p-20 text-center overflow-hidden"
        >
          {/* Glow effect */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-primary/10 rounded-full blur-[100px]" />

          <h2 className="text-3xl md:text-5xl font-black uppercase mb-6 relative z-10">
            Pronto para começar sua{" "}
            <span className="text-gradient">evolução</span>?
          </h2>
          <p className="text-muted-foreground mb-8 max-w-md mx-auto relative z-10">
            Agende sua aula e descubra o que o Pavilhão 8 pode fazer pela sua
            performance.
          </p>
          <Button
            size="lg"
            onClick={onScheduleClick}
            className="bg-gradient-primary text-primary-foreground font-bold text-lg px-10 py-6 rounded-full animate-pulse-glow hover:scale-105 transition-transform relative z-10"
          >
            Agendar aula
          </Button>
        </motion.div>
      </div>
    </section>
  );
};

export default CTASection;
