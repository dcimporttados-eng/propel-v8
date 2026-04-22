UPDATE public.users
SET phone = regexp_replace(phone, '\D', '', 'g')
WHERE phone IS NOT NULL;