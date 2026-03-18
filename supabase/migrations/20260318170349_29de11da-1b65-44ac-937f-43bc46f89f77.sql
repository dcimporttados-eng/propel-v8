
-- Add day_of_week to classes (1=Monday...7=Sunday)
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS day_of_week integer;

-- Make date nullable (templates won't need a specific date)
ALTER TABLE public.classes ALTER COLUMN date DROP NOT NULL;

-- Create class_suspensions table
CREATE TABLE IF NOT EXISTS public.class_suspensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE NOT NULL,
  suspended_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(class_id, suspended_date)
);

ALTER TABLE public.class_suspensions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read suspensions" ON public.class_suspensions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can insert suspensions" ON public.class_suspensions FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anyone can delete suspensions" ON public.class_suspensions FOR DELETE TO anon, authenticated USING (true);

-- Add class_date to reservations to track which specific date a reservation is for
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS class_date date;

-- Update existing classes to have day_of_week based on their date
-- All current classes are for 2026-03-19 which is a Thursday (4)
UPDATE public.classes SET day_of_week = EXTRACT(ISODOW FROM date::date)::integer WHERE day_of_week IS NULL AND date IS NOT NULL;

-- Update get_available_spots to account for class_date
CREATE OR REPLACE FUNCTION public.get_available_spots(p_class_id uuid, p_date date DEFAULT NULL)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT c.capacity - COALESCE(
    (SELECT COUNT(*) FROM public.reservations r 
     WHERE r.class_id = p_class_id 
     AND r.status IN ('pending', 'confirmed')
     AND (p_date IS NULL OR r.class_date = p_date)),
    0
  )::INTEGER
  FROM public.classes c
  WHERE c.id = p_class_id;
$$;
