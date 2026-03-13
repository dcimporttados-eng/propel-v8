import { motion } from "framer-motion";
import { Star } from "lucide-react";
import testimonial1 from "@/assets/testimonial-1.jpg";
import testimonial2 from "@/assets/testimonial-2.jpg";
import testimonial3 from "@/assets/testimonial-3.jpg";

const testimonials = [
  {
    name: "Lucas Ferreira",
    photo: testimonial1,
    feedback:
      "O Sprint Bike mudou completamente meu condicionamento. Em 3 meses, minha resistência triplicou. O ambiente do Pavilhão 8 é insano!",
  },
  {
    name: "Camila Santos",
    photo: testimonial2,
    feedback:
      "Melhor centro de treinamento da cidade. Os treinos funcionais são desafiadores e os coaches são excepcionais. Recomendo demais!",
  },
  {
    name: "Rafael Mendes",
    photo: testimonial3,
    feedback:
      "Treino no Pavilhão 8 há 1 ano e a evolução é visível. O Performance Training levou meu corpo a outro nível. Equipe top!",
  },
];

const TestimonialsSection = () => {
  return (
    <section className="py-24 px-4 bg-secondary/30">
      <div className="container mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="text-primary font-semibold tracking-[0.2em] uppercase text-sm">
            Depoimentos
          </span>
          <h2 className="text-3xl md:text-5xl font-black uppercase mt-3">
            O que dizem nossos <span className="text-gradient">atletas</span>
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.15 }}
              className="bg-card rounded-2xl p-8 shadow-card border border-border"
            >
              <div className="flex gap-1 mb-4">
                {[...Array(5)].map((_, j) => (
                  <Star key={j} className="w-4 h-4 fill-primary text-primary" />
                ))}
              </div>
              <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                "{t.feedback}"
              </p>
              <div className="flex items-center gap-3">
                <img
                  src={t.photo}
                  alt={t.name}
                  className="w-12 h-12 rounded-full object-cover"
                  loading="lazy"
                />
                <span className="font-semibold text-sm">{t.name}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
