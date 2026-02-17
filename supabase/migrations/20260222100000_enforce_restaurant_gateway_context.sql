-- Enforce unified restaurant write gateway context for all direct DML on public.restaurants.

CREATE OR REPLACE FUNCTION public.enforce_restaurant_gateway_context()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text;
BEGIN
  write_context := current_setting('app.restaurant_write_context', true);
  IF COALESCE(write_context, '') <> 'gateway' THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Direct restaurants write blocked: use unified restaurant write gateway.',
      ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_restaurant_gateway_context ON public.restaurants;

CREATE TRIGGER enforce_restaurant_gateway_context
BEFORE INSERT OR UPDATE OR DELETE
ON public.restaurants
FOR EACH ROW
EXECUTE FUNCTION public.enforce_restaurant_gateway_context();
