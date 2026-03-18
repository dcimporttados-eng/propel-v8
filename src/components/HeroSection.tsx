import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import heroBg from "@/assets/hero-bg.jpg";

interface HeroSectionProps {
  onScheduleClick: () => void;
}

const HeroSection = ({ onScheduleClick }: HeroSectionProps) => {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0">
        <img
          src={heroBg}
          alt="Atletas treinando no Pavilhão 8"
          className="w-full h-full object-cover"
          loading="eager"
        />
        <div className="absolute inset-0 bg-background/70" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
      </div>

      {/* Content */}
      <div className="relative z-10 container mx-auto px-4 text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <span className="inline-block text-primary font-semibold tracking-[0.3em] uppercase text-sm mb-6">
            Centro de Treinamento
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.15, ease: "easeOut" }}
          className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-black uppercase leading-[0.95] tracking-tight mb-6"
        >
          Treine como um
          <br />
          <span className="text-gradient">atleta</span> no
          <br />
          Pavilhão 8
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
          className="text-muted-foreground text-lg md:text-xl max-w-xl mx-auto mb-10"
        >
          Centro de treinamento focado em performance, bike sprint e condicionamento físico.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.45, ease: "easeOut" }}
          className="flex flex-col sm:flex-row gap-4 justify-center"
        >
          <Button
            size="lg"
            onClick={onScheduleClick}
            className="bg-gradient-primary text-primary-foreground font-bold text-lg px-8 py-6 rounded-full animate-pulse-glow hover:scale-105 transition-transform"
          >
            Agendar Aula
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => document.getElementById("modalidades")?.scrollIntoView({ behavior: "smooth" })}
            className="border-border text-foreground font-semibold text-lg px-8 py-6 rounded-full hover:bg-secondary transition-colors"
          >
            Ver Modalidades
          </Button>
        </motion.div>
      </div>

      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
    </section>
  );
};

export default HeroSection;
