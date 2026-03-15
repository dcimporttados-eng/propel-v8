import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import splashVideo from "@/assets/splash-video.mp4";

const SPLASH_DURATION = 8000;

const SplashScreen = ({ onComplete }: { onComplete: () => void }) => {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const exitTimer = setTimeout(() => setExiting(true), SPLASH_DURATION - 1200);
    const completeTimer = setTimeout(onComplete, SPLASH_DURATION);
    return () => {
      clearTimeout(exitTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <AnimatePresence>
      {!exiting && (
        <motion.div
          key="splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1, ease: "easeInOut" }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-background overflow-hidden"
        >
          <video
            src={splashVideo}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-contain"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SplashScreen;
