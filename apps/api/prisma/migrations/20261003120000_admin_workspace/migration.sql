-- Narrow control-plane functions; caller and platform tenant membership are checked in SQL too.
CREATE FUNCTION admin_uuidv7() RETURNS uuid
LANGUAGE sql VOLATILE SET search_path=public,pg_temp AS $$
 SELECT (lpad(to_hex(floor(extract(epoch FROM clock_timestamp())*1000)::bigint),12,'0')||'7'||substring(random_bits,1,3)||'8'||substring(random_bits,4,15))::uuid
 FROM (SELECT replace(gen_random_uuid()::text,'-','') AS random_bits) entropy;
$$;
REVOKE ALL ON FUNCTION admin_uuidv7() FROM PUBLIC;
CREATE FUNCTION admin_platform_actor(actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM users u JOIN tenants t ON t.id=u.tenant_id
 JOIN user_roles ur ON ur.user_id=u.id AND ur.tenant_id=t.id
 JOIN roles r ON r.id=ur.role_id AND r.tenant_id=t.id
 WHERE u.id=actor AND t.id=NULLIF(current_setting('app.tenant_id',true),'')::uuid
 AND t.settings->>'platform'='true' AND t.status='active' AND u.status='active'
 AND r.name='super_admin' AND r.is_system AND u.deleted_at IS NULL AND ur.deleted_at IS NULL AND r.deleted_at IS NULL);
$$;
CREATE FUNCTION admin_tenant_list(actor uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT admin_platform_actor(actor) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'name',name,'region',region,'status',status,'version',version,'settings',settings) ORDER BY created_at DESC),'[]'::jsonb) FROM (SELECT * FROM tenants WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 500) t);
END; $$;
CREATE FUNCTION admin_tenant_write(actor uuid,target uuid,input jsonb,expected integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE row tenants;
BEGIN
 IF NOT admin_platform_actor(actor) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF expected IS NULL THEN
 INSERT INTO tenants(id,slug,name,region,status,settings,created_by,updated_by)
 VALUES(target,input->>'slug',input->>'name',input->>'region',(input->>'status')::tenant_status,jsonb_build_object('quotas',input->'quotas','features',input->'features'),'user:'||actor,'user:'||actor) RETURNING * INTO row;
 INSERT INTO roles(id,tenant_id,name,permissions,rules,is_system,created_by,updated_by)
 SELECT admin_uuidv7(),target,name,permissions,rules,true,'user:'||actor,'user:'||actor FROM roles
 WHERE tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid AND is_system AND name<>'super_admin' AND deleted_at IS NULL;
 ELSE
 IF target=NULLIF(current_setting('app.tenant_id',true),'')::uuid AND input->>'status'<>'active' THEN RAISE EXCEPTION 'cannot suspend own platform tenant'; END IF;
 UPDATE tenants SET name=input->>'name',region=input->>'region',status=(input->>'status')::tenant_status,
 settings=settings||jsonb_build_object('quotas',input->'quotas','features',input->'features'),version=version+1,updated_at=now(),updated_by='user:'||actor
 WHERE id=target AND version=expected AND deleted_at IS NULL RETURNING * INTO row;
 IF NOT FOUND THEN RAISE EXCEPTION 'version mismatch' USING ERRCODE='40001'; END IF;
 END IF;
 RETURN jsonb_build_object('id',row.id,'slug',row.slug,'name',row.name,'region',row.region,'status',row.status,'version',row.version,'settings',row.settings);
END; $$;
REVOKE ALL ON FUNCTION admin_platform_actor(uuid),admin_tenant_list(uuid),admin_tenant_write(uuid,uuid,jsonb,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_platform_actor(uuid),admin_tenant_list(uuid),admin_tenant_write(uuid,uuid,jsonb,integer) TO verbis_app;

CREATE TABLE admin_privacy_requests (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),kind text NOT NULL CHECK(kind IN('search','export','anonymize')),
 subject_sealed text NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','completed','blocked')),
 reason text NOT NULL, matched_ids jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(),
 created_by varchar(128) NOT NULL, version integer NOT NULL DEFAULT 1
);
CREATE INDEX admin_privacy_requests_tenant_idx ON admin_privacy_requests(tenant_id,created_at,id);
ALTER TABLE admin_privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_privacy_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON admin_privacy_requests USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON admin_privacy_requests TO verbis_app;
