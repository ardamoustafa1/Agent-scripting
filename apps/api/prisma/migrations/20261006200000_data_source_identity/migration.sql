-- Published pins address sources by key. Renaming must never invalidate those pins.
CREATE FUNCTION data_source_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'data source identity is immutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER data_sources_identity_immutable BEFORE UPDATE ON data_sources
FOR EACH ROW EXECUTE FUNCTION data_source_identity_immutable();
