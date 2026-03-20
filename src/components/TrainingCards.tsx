import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import cardSprintBike from "@/assets/card-sprint-bike.jpg";
import cardFuncional from "@/assets/card-funcional.jpg";
import cardPerformance from "@/assets/card-performance.jpg";

const modalities = [
  {
    title: "Spinning P8",
    description: "Treino de alta intensidade em bicicleta indoor focado em explosão, resistência e alto gasto calórico.",
    image: cardSprintBike,
    available: true,
  },
  {
    title: "FUNTRAINING",
    description: "Exercícios com peso corporal e acessórios para melhorar força, mobilidade e condicionamento físico.",
    image: cardFuncional,
    available: false,
  },
  {
    title: "Jump",
    description: "Treinamento avançado para quem busca evolução física e alto desempenho.",
    image: cardPerformance,
    available: false,
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
              className="relative rounded-2xl overflow-hidden shadow-card border border-border hover:border-primary/40 transition-all duration-300 group min-h-[360px] flex flex-col justify-end"
            >
              <img
                src={mod.image}
                alt={mod.title}
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/20" />

              <div className="relative z-10 p-8">
                <h3 className="text-xl font-bold mb-2 text-white">{mod.title}</h3>
                <p className="text-white/70 text-sm leading-relaxed mb-4">
                  {mod.description}
                </p>

                <div className="flex items-center gap-2 mb-4">
                  {mod.available ? (
                    <>
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-xs text-white/60">Vagas disponíveis — Seg a Sáb</span>
                    </>
                  ) : (
                    <>
                      <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                      <span className="text-xs text-white/40">Não disponível</span>
                    </>
                  )}
                </div>

                <Button
                  onClick={() => mod.available && onScheduleClick(mod.title)}
                  disabled={!mod.available}
                  className="w-full bg-gradient-primary text-primary-foreground font-semibold rounded-full hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  {mod.available ? "Ver horários" : "Em breve"}
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
