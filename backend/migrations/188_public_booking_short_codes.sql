-- Add a compact immutable alias; published legacy codes and slugs remain valid.
-- Fixed first segments matching the alias shape must be reserved before adding
-- application routes; mirror public-booking-code.ts and publicAuthPath.js.
CREATE FUNCTION autexa_generate_public_booking_short_code() RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE code text;
BEGIN
  LOOP
    code := translate(encode(gen_random_bytes(12),'base64'),'+/','-_');
    IF lower(code) NOT IN ('company-settings') THEN RETURN code; END IF;
  END LOOP;
END
$$;

ALTER TABLE public_booking_pages ADD COLUMN short_code text;
UPDATE public_booking_pages SET short_code=autexa_generate_public_booking_short_code();
ALTER TABLE public_booking_pages
  ALTER COLUMN short_code SET DEFAULT autexa_generate_public_booking_short_code(),
  ALTER COLUMN short_code SET NOT NULL,
  ADD CONSTRAINT public_booking_pages_short_code_shape CHECK (short_code ~ '^[A-Za-z0-9_-]{16}$' AND lower(short_code) NOT IN ('company-settings'));
CREATE UNIQUE INDEX public_booking_pages_short_code_unique ON public_booking_pages(short_code);
CREATE FUNCTION autexa_public_booking_short_code_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.short_code IS DISTINCT FROM OLD.short_code THEN
    RAISE EXCEPTION 'public booking short code is immutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER public_booking_short_code_immutable
  BEFORE UPDATE OF short_code ON public_booking_pages
  FOR EACH ROW EXECUTE FUNCTION autexa_public_booking_short_code_immutable();
