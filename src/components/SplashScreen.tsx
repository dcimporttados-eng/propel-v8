import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import splashVideo from "@/assets/splash-video.mp4";
import logoP8 from "@/assets/logo-p8.jpeg";

const SPLASH_DURATION = 8000;

const SplashScreen = ({ onComplete }: { onComplete: () => void }) => {
  const [exiting, setExiting] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

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
          {/* Fallback logo shown instantly until video loads */}
          {!videoReady && (
            <img
              src={logoP8}
              alt="Pavilhão 8"
              className="w-56 h-56 sm:w-72 sm:h-72 md:w-96 md:h-96 object-contain"
            />
          )}

          <video
            ref={videoRef}
            src={splashVideo}
            autoPlay
            muted
            playsInline
            preload="auto"
            onCanPlay={() => setVideoReady(true)}
            className={`w-full h-full object-contain ${videoReady ? "block" : "hidden"}`}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SplashScreen;
