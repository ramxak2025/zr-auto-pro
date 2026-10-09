CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public_booking_pages ADD COLUMN public_code text;
UPDATE public_booking_pages
SET public_code=encode(gen_random_bytes(16),'hex')
WHERE public_code IS NULL;
ALTER TABLE public_booking_pages
  ALTER COLUMN public_code SET DEFAULT encode(gen_random_bytes(16),'hex'),
  ALTER COLUMN public_code SET NOT NULL;
ALTER TABLE public_booking_pages
  ADD CONSTRAINT public_booking_pages_public_code_shape
    CHECK (public_code ~ '^[a-f0-9]{32}$');
CREATE UNIQUE INDEX public_booking_pages_public_code_unique ON public_booking_pages(public_code);

CREATE OR REPLACE FUNCTION autexa_public_booking_code_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.public_code IS DISTINCT FROM OLD.public_code THEN
    RAISE EXCEPTION 'public booking code is immutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER public_booking_code_immutable
  BEFORE UPDATE OF public_code ON public_booking_pages
  FOR EACH ROW EXECUTE FUNCTION autexa_public_booking_code_immutable();

ALTER TABLE public_booking_resources ADD COLUMN resource_key text;
UPDATE public_booking_resources
SET resource_key=encode(gen_random_bytes(16),'hex')
WHERE resource_key IS NULL;
ALTER TABLE public_booking_resources
  ALTER COLUMN resource_key SET DEFAULT encode(gen_random_bytes(16),'hex'),
  ALTER COLUMN resource_key SET NOT NULL;
ALTER TABLE public_booking_resources
  ADD CONSTRAINT public_booking_resources_resource_key_shape
    CHECK (resource_key ~ '^[a-f0-9]{32}$');
CREATE UNIQUE INDEX public_booking_resources_page_key_unique
  ON public_booking_resources(page_id,resource_key);

CREATE OR REPLACE FUNCTION autexa_public_booking_resource_key_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.resource_key IS DISTINCT FROM OLD.resource_key THEN
    RAISE EXCEPTION 'public booking resource key is immutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER public_booking_resource_key_immutable
  BEFORE UPDATE OF resource_key ON public_booking_resources
  FOR EACH ROW EXECUTE FUNCTION autexa_public_booking_resource_key_immutable();
