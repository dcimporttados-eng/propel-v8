import { motion } from "framer-motion";
import { Bike, Dumbbell, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import cardSprintBike from "@/assets/card-sprint-bike.jpg";
import cardFuncional from "@/assets/card-funcional.jpg";
import cardPerformance from "@/assets/card-performance.jpg";

const modalities = [
  {
    icon: Bike,
    title: "Sprint Bike",
    description: "Treino de alta intensidade em bicicleta indoor focado em explosão, resistência e alto gasto calórico.",
    slots: 8,
    image: cardSprintBike,
  },
  {
    icon: Dumbbell,
    title: "Treinamento Funcional",
    description: "Exercícios com peso corporal e acessórios para melhorar força, mobilidade e condicionamento físico.",
    slots: 12,
    image: cardFuncional,
  },
  {
    icon: Zap,
    title: "Performance Training",
    description: "Treinamento avançado para quem busca evolução física e alto desempenho.",
    slots: 6,
    image: cardPerformance,
  },
];

interface TrainingCardsProps {
  onScheduleClick: (modality?: string) => void;
}

const TrainingCards = ({ onScheduleClick }: TrainingCardsProps) => {
  return (
    <section id="modalidades" className="py-24 px-4">
      <div className="container mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="text-primary font-semibold tracking-[0.2em] uppercase text-sm">Modalidades</span>
          <h2 className="text-3xl md:text-5xl font-black uppercase mt-3">
            Escolha seu <span className="text-gradient">treino</span>
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6">
          {modalities.map((mod, i) => (
            <motion.div
              key={mod.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.15 }}
              whileHover={{ y: -8, scale: 1.02 }}
              className="bg-card rounded-2xl overflow-hidden shadow-card border border-border hover:border-primary/40 transition-all duration-300 group"
            >
              <div className="w-full h-40 overflow-hidden">
                <img
                  src={mod.image}
                  alt={mod.title}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                />
              </div>
              <div className="p-8">
              <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-6 group-hover:bg-primary/20 transition-colors">
                <mod.icon className="w-7 h-7 text-primary" />
              </div>
              <h3 className="text-xl font-bold mb-3">{mod.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                {mod.description}
              </p>

              {/* Vagas indicator */}
              <div className="flex items-center gap-2 mb-6">
                <div className={`w-2 h-2 rounded-full ${mod.slots > 0 ? "bg-green-500" : "bg-destructive"}`} />
                <span className="text-xs text-muted-foreground">
                  {mod.slots > 0 ? `${mod.slots} vagas restantes — 07:00` : "Aula Lotada"}
                </span>
              </div>

              <Button
                onClick={() => onScheduleClick(mod.title)}
                className="w-full bg-gradient-primary text-primary-foreground font-semibold rounded-full hover:scale-[1.02] transition-transform"
              >
                Ver horários
              </Button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TrainingCards;
