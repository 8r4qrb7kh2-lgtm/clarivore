-- Enforce one gateway-only write boundary for restaurant runtime data tables.
-- This extends the existing restaurants trigger to all normalized menu + ingredient + changelog tables.

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
      MESSAGE = format(
        'Direct %s write blocked: use unified restaurant write gateway.',
        TG_TABLE_NAME
      ),
      ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.restaurants') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS enforce_restaurant_gateway_context ON public.restaurants;
    DROP TRIGGER IF EXISTS enforce_rw_ctx_restaurants ON public.restaurants;
    CREATE TRIGGER enforce_rw_ctx_restaurants
    BEFORE INSERT OR UPDATE OR DELETE
    ON public.restaurants
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_restaurant_gateway_context();
  END IF;

  IF to_regclass('public.change_logs') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS enforce_rw_ctx_change_logs ON public.change_logs;
    CREATE TRIGGER enforce_rw_ctx_change_logs
    BEFORE INSERT OR UPDATE OR DELETE
    ON public.change_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_restaurant_gateway_context();
  END IF;

  IF to_regclass('public.dish_ingredient_rows') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS enforce_rw_ctx_dish_ing_rows ON public.dish_ingredient_rows;
    CREATE TRIGGER enforce_rw_ctx_dish_ing_rows
    BEFORE INSERT OR UPDATE OR DELETE
    ON public.dish_ingredient_rows
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_restaurant_gateway_context();
  END IF;

  IF to_regclass('public.dish_ingredient_allergens') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS enforce_rw_ctx_dish_ing_allergens ON public.dish_ingredient_allergens;
    CREATE TRIGGER enforce_rw_ctx_dish_ing_allergens
    BEFORE INSERT OR UPDATE OR DELETE
    ON public.dish_ingredient_allergens
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_restaurant_gateway_context();
  END IF;

  IF to_regclass('public.dish_ingredient_diets') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS enforce_rw_ctx_dish_ing_diets ON public.dish_ingredient_diets;
    CREATE TRIGGER enforce_rw_ctx_dish_ing_diets
    BEFORE INSERT OR UPDATE OR DELETE
    ON public.dish_ingredient_diets
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_restaurant_gateway_context();
  END IF;

  IF to_regclass('public.restaurant_menu_pages') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS enforce_rw_ctx_menu_pages ON public.restaurant_menu_pages;
    CREATE TRIGGER enforce_rw_ctx_menu_pages
    BEFORE INSERT OR UPDATE OR DELETE
    ON public.restaurant_menu_pages
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_restaurant_gateway_context();
  END IF;

  IF to_regclass('public.restaurant_menu_dishes') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS enforce_rw_ctx_menu_dishes ON public.restaurant_menu_dishes;
    CREATE TRIGGER enforce_rw_ctx_menu_dishes
    BEFORE INSERT OR UPDATE OR DELETE
    ON public.restaurant_menu_dishes
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_restaurant_gateway_context();
  END IF;

  IF to_regclass('public.restaurant_menu_ingredient_rows') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS enforce_rw_ctx_menu_rows ON public.restaurant_menu_ingredient_rows;
    CREATE TRIGGER enforce_rw_ctx_menu_rows
    BEFORE INSERT OR UPDATE OR DELETE
    ON public.restaurant_menu_ingredient_rows
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_restaurant_gateway_context();
  END IF;

  IF to_regclass('public.restaurant_menu_ingredient_brand_items') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS enforce_rw_ctx_menu_brands ON public.restaurant_menu_ingredient_brand_items;
    CREATE TRIGGER enforce_rw_ctx_menu_brands
    BEFORE INSERT OR UPDATE OR DELETE
    ON public.restaurant_menu_ingredient_brand_items
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_restaurant_gateway_context();
  END IF;
END $$;
