-- Identity tables: tenant isolation, grants and the narrow cross-tenant lookups needed before a
-- tenant is known (home-realm discovery, tenant resolution by slug). Reviewed SQL (ADR-0012).

-- ─── Grants ───────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON
  user_identities, identity_provider_domains, groups, group_members, scim_tokens, service_clients,
  local_credentials
TO verbis_app;

-- ─── Row-Level Security ───────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_identities', 'identity_provider_domains', 'groups', 'group_members', 'scim_tokens',
    'service_clients', 'local_credentials'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) '
      'WITH CHECK (tenant_id = app_current_tenant())', t);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (version > 0)', t, t || '_version_check');
  END LOOP;
END
$$;

-- ─── Integrity checks ─────────────────────────────────────────────────────────
ALTER TABLE identity_provider_domains ADD CONSTRAINT identity_provider_domains_domain_check
  CHECK (domain = lower(domain) AND domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$');
ALTER TABLE scim_tokens ADD CONSTRAINT scim_tokens_token_hash_check
  CHECK (token_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE service_clients ADD CONSTRAINT service_clients_credentials_check CHECK (
  (auth_method = 'tls_client_auth' AND certificate_thumbprint IS NOT NULL)
  OR (auth_method <> 'tls_client_auth' AND secret_hash ~ '^[0-9a-f]{64}$')
);
ALTER TABLE user_roles ADD CONSTRAINT user_roles_source_check
  CHECK (source = 'manual' OR source ~ '^(claims|scim):[0-9a-f-]{36}$');
ALTER TABLE local_credentials ADD CONSTRAINT local_credentials_password_hash_check
  CHECK (password_hash LIKE '$argon2id$%');

-- ─── Pre-tenant lookups (SECURITY DEFINER, minimal surface) ───────────────────

-- Tenant by slug (login routes, SCIM and token endpoints carry the slug in the path).
CREATE OR REPLACE FUNCTION tenant_resolve(p_slug text)
  RETURNS TABLE (id uuid, status tenant_status)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.status FROM tenants t
   WHERE t.slug = p_slug AND t.deleted_at IS NULL
$$;

-- Home-realm discovery: which active tenant and IdP claim this email domain?
CREATE OR REPLACE FUNCTION identity_discover_domain(p_domain text)
  RETURNS TABLE (tenant_id uuid, tenant_slug text, idp_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT d.tenant_id, t.slug, d.idp_id
    FROM identity_provider_domains d
    JOIN tenants t ON t.id = d.tenant_id
    JOIN identity_providers i ON i.id = d.idp_id
   WHERE d.domain = lower(p_domain) AND d.deleted_at IS NULL
     AND t.status = 'active' AND t.deleted_at IS NULL
     AND i.status = 'active' AND i.deleted_at IS NULL
$$;

REVOKE ALL ON FUNCTION tenant_resolve(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION identity_discover_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_resolve(text) TO verbis_app;
GRANT EXECUTE ON FUNCTION identity_discover_domain(text) TO verbis_app;
