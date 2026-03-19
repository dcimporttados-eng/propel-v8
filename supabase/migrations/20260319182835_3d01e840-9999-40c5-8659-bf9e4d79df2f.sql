-- Update get_available_spots to only count CONFIRMED reservations (not pending)
-- Pending reservations are just checkout attempts and should NOT block slots

CREATE OR REPLACE FUNCTION public.get_available_spots(p_class_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT c.capacity - COALESCE(
    (SELECT COUNT(*) FROM public.reservations r 
     WHERE r.class_id = p_class_id 
     AND r.status = 'confirmed'),
    0
  )::INTEGER
  FROM public.classes c
  WHERE c.id = p_class_id;
$$;

CREATE OR REPLACE FUNCTION public.get_available_spots(p_class_id uuid, p_date date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT c.capacity - COALESCE(
    (SELECT COUNT(*) FROM public.reservations r 
     WHERE r.class_id = p_class_id 
     AND r.status = 'confirmed'
     AND (p_date IS NULL OR r.class_date = p_date)),
    0
  )::INTEGER
  FROM public.classes c
  WHERE c.id = p_class_id;
$$;