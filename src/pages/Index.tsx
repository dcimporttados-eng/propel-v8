import { useState } from "react";
import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import TrainingCards from "@/components/TrainingCards";
import ScheduleModal from "@/components/ScheduleModal";
import AboutSection from "@/components/AboutSection";
import TestimonialsSection from "@/components/TestimonialsSection";
import CTASection from "@/components/CTASection";
import ContactSection from "@/components/ContactSection";

const Index = () => {
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [initialModality, setInitialModality] = useState<string | undefined>();

  const openSchedule = (modality?: string) => {
    setInitialModality(modality);
    setScheduleOpen(true);
  };

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
