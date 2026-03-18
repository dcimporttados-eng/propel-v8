
-- Users table (public profile data)
CREATE TABLE public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own data" ON public.users
  FOR SELECT TO authenticated
  USING (auth_id = auth.uid());

CREATE POLICY "Users can insert own data" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (auth_id = auth.uid());

CREATE POLICY "Users can update own data" ON public.users
  FOR UPDATE TO authenticated
  USING (auth_id = auth.uid());

-- Allow anon users to insert (for guest reservations)
CREATE POLICY "Anon users can insert" ON public.users
  FOR INSERT TO anon
  WITH CHECK (true);

-- Classes table
CREATE TABLE public.classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  date DATE NOT NULL,
  time TIME NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 10,
  price INTEGER NOT NULL DEFAULT 3000, -- in cents
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read classes" ON public.classes
  FOR SELECT TO anon, authenticated
  USING (true);

-- Reservations table
CREATE TYPE public.reservation_status AS ENUM ('pending', 'confirmed', 'canceled');

CREATE TABLE public.reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE NOT NULL,
  status public.reservation_status NOT NULL DEFAULT 'pending',
  payment_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read own reservations" ON public.reservations
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can insert reservations" ON public.reservations
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Service role can update reservations" ON public.reservations
  FOR UPDATE TO anon, authenticated
  USING (true);

-- Payments table
CREATE TYPE public.payment_status AS ENUM ('pending', 'paid', 'failed');

CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  reservation_id UUID REFERENCES public.reservations(id) ON DELETE CASCADE NOT NULL,
  amount INTEGER NOT NULL,
  status public.payment_status NOT NULL DEFAULT 'pending',
  transaction_id TEXT,
  pix_qr_code TEXT,
  pix_copy_paste TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  paid_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read payments" ON public.payments
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can insert payments" ON public.payments
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update payments" ON public.payments
  FOR UPDATE TO anon, authenticated
  USING (true);

-- Link reservations.payment_id FK
ALTER TABLE public.reservations
  ADD CONSTRAINT fk_payment FOREIGN KEY (payment_id) REFERENCES public.payments(id);

-- Function to count confirmed spots
CREATE OR REPLACE FUNCTION public.get_available_spots(p_class_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.capacity - COALESCE(
    (SELECT COUNT(*) FROM public.reservations r 
     WHERE r.class_id = p_class_id 
     AND r.status IN ('pending', 'confirmed')),
    0
  )::INTEGER
  FROM public.classes c
  WHERE c.id = p_class_id;
$$;

-- Insert some sample classes
INSERT INTO public.classes (title, date, time, capacity, price) VALUES
  ('Sprint Bike', CURRENT_DATE + INTERVAL '1 day', '06:00', 10, 3000),
  ('Sprint Bike', CURRENT_DATE + INTERVAL '1 day', '07:00', 10, 3000),
  ('Sprint Bike', CURRENT_DATE + INTERVAL '1 day', '12:00', 10, 3000),
  ('Sprint Bike', CURRENT_DATE + INTERVAL '1 day', '18:00', 10, 3000),
  ('Sprint Bike', CURRENT_DATE + INTERVAL '1 day', '19:00', 10, 3000);

-- Enable realtime for reservations and payments
ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
