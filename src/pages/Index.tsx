import { useState, useCallback } from "react";
import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import TrainingCards from "@/components/TrainingCards";
import ScheduleModal from "@/components/ScheduleModal";
import AboutSection from "@/components/AboutSection";
import TestimonialsSection from "@/components/TestimonialsSection";
import CTASection from "@/components/CTASection";
import ContactSection from "@/components/ContactSection";
import SplashScreen from "@/components/SplashScreen";

const Index = () => {
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [initialModality, setInitialModality] = useState<string | undefined>();
  const [showSplash, setShowSplash] = useState(true);

  const openSchedule = (modality?: string) => {
    setInitialModality(modality);
    setScheduleOpen(true);
  };

  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

  if (showSplash) {
    return <SplashScreen onComplete={handleSplashComplete} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar onScheduleClick={() => openSchedule()} />
      <HeroSection onScheduleClick={() => openSchedule()} />
      <TrainingCards onScheduleClick={openSchedule} />
      <AboutSection />
      <TestimonialsSection />
      <CTASection onScheduleClick={() => openSchedule()} />
      <ContactSection />
      <ScheduleModal
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        initialModality={initialModality}
      />
    </div>
  );
};

export default Index;
