
CREATE POLICY "Anyone can update classes" ON public.classes FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can insert classes" ON public.classes FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anyone can delete classes" ON public.classes FOR DELETE TO anon, authenticated USING (true);
