ALTER TABLE public.restaurants
ADD COLUMN IF NOT EXISTS map_location text;
