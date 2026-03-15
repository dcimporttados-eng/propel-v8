import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import logoP8 from "@/assets/logo-p8.jpeg";

const SPLASH_DURATION = 10000; // 10 seconds

const SplashScreen = ({ onComplete }: { onComplete: () => void }) => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
    }, SPLASH_DURATION - 1500); // start exit animation 1.5s before end

    const completeTimer = setTimeout(() => {
      onComplete();
    }, SPLASH_DURATION);

    return () => {
      clearTimeout(timer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2, ease: "easeInOut" }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-background"
        >
          {/* Glow background */}
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 0.3, scale: 1.5 }}
            transition={{ duration: 3, ease: "easeOut", delay: 0.5 }}
            className="absolute w-80 h-80 rounded-full blur-[120px]"
            style={{ background: "hsl(45 90% 50% / 0.4)" }}
          />

          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, scale: 0.3, rotateY: -90 }}
            animate={{ opacity: 1, scale: 1, rotateY: 0 }}
            exit={{ opacity: 0, scale: 0.6, rotateY: 90 }}
            transition={{
              duration: 1.5,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="relative z-10"
          >
            <motion.img
              src={logoP8}
              alt="Pavilhão 8"
              className="w-56 h-56 sm:w-72 sm:h-72 md:w-96 md:h-96 object-contain rounded-3xl"
              animate={{
                filter: [
                  "drop-shadow(0 0 20px hsl(45 90% 50% / 0.3))",
                  "drop-shadow(0 0 60px hsl(45 90% 50% / 0.6))",
                  "drop-shadow(0 0 20px hsl(45 90% 50% / 0.3))",
                ],
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          </motion.div>

          {/* Text */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.8, delay: 1.5 }}
            className="absolute bottom-20 text-muted-foreground text-sm tracking-[0.3em] uppercase"
          >
            Centro de Treinamento
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SplashScreen;
