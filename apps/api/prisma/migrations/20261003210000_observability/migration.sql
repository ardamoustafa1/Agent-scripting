-- Operational aggregate only. Preserve FORCE RLS and the application's tenant policies.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='verbis_metrics_reader') THEN
    CREATE ROLE verbis_metrics_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO verbis_metrics_reader;
GRANT SELECT(state, deleted_at) ON public.sessions TO verbis_metrics_reader;
CREATE POLICY operational_session_count ON public.sessions FOR SELECT TO verbis_metrics_reader USING (true);
CREATE FUNCTION public.operational_active_sessions() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT count(*) FROM public.sessions WHERE deleted_at IS NULL AND state IN ('launching','active','paused','wrapup')
$$;
-- Transfer ownership without granting the monitoring role general schema creation.
GRANT CREATE ON SCHEMA public TO verbis_metrics_reader;
ALTER FUNCTION public.operational_active_sessions() OWNER TO verbis_metrics_reader;
REVOKE CREATE ON SCHEMA public FROM verbis_metrics_reader;
REVOKE ALL ON FUNCTION public.operational_active_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operational_active_sessions() TO verbis_app;
