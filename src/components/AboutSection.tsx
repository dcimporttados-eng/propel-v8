import { motion } from "framer-motion";
import aboutImg from "@/assets/about-img.jpg";

const AboutSection = () => {
  return (
    <section id="sobre" className="py-24 px-4">
      <div className="container mx-auto max-w-6xl">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="relative"
          >
            <div className="rounded-2xl overflow-hidden shadow-card">
              <img
                src={aboutImg}
                alt="Treino funcional no Pavilhão 8"
                className="w-full h-[400px] md:h-[500px] object-cover"
                loading="lazy"
              />
            </div>
            {/* Decorative accent */}
            <div className="absolute -bottom-4 -right-4 w-24 h-24 rounded-2xl bg-primary/20 -z-10" />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.15 }}
          >
            <span className="text-primary font-semibold tracking-[0.2em] uppercase text-sm">
              Sobre nós
            </span>
            <h2 className="text-3xl md:text-5xl font-black uppercase mt-3 mb-6">
              Sobre o <span className="text-gradient">Pavilhão 8</span>
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-6">
              O Pavilhão 8 nasceu com um propósito claro: criar um espaço onde cada treino é uma
              oportunidade de evolução. Aqui, combinamos metodologias de treinamento de alta
              performance com um ambiente que inspira disciplina e superação.
            </p>
            <p className="text-muted-foreground leading-relaxed mb-8">
              Nosso centro de treinamento é equipado com tecnologia de ponta e conta com
              profissionais especializados para guiar cada aluno na sua jornada de transformação
              física e mental. Treinamento focado em evolução física, disciplina e performance.
            </p>
            <div className="grid grid-cols-3 gap-6">
              {[
                { value: "500+", label: "Alunos" },
                { value: "3", label: "Modalidades" },
                { value: "98%", label: "Satisfação" },
              ].map((stat) => (
                <div key={stat.label}>
                  <div className="text-2xl md:text-3xl font-black text-primary">{stat.value}</div>
                  <div className="text-sm text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default AboutSection;
