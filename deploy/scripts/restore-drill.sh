#!/usr/bin/env bash
set -euo pipefail
# Generate an isolated CloudNativePG recovery cluster; apply only with --apply.
# Existing CNPG + Barman Cloud plugin + ObjectStore are prerequisites.
namespace=${DRILL_NAMESPACE:?dedicated drill namespace required}
case "$namespace" in verbis-drill-*) ;; *) echo 'Namespace must start with verbis-drill-' >&2; exit 1;; esac
: "${RECOVERY_OBJECT_STORE:?existing Barman ObjectStore in drill namespace required}"
: "${BACKUP_SERVER_NAME:?original backup server name required}"
: "${RECOVERY_TARGET_TIME:?RFC3339 recovery target required}"
: "${POSTGRES_IMAGE:?approved PostgreSQL 16 image with digest required}"
output=${1:?new manifest path required}
[[ ! -e "$output" ]] || { echo 'Output already exists' >&2; exit 1; }
python3 - "$namespace" "$output" <<'MANIFEST'
import os,sys,json,datetime,re
ns,path=sys.argv[1:]
assert re.fullmatch(r'verbis-drill-[a-z0-9-]{1,40}',ns)
target=os.environ['RECOVERY_TARGET_TIME'];parsed=datetime.datetime.fromisoformat(target.replace('Z','+00:00'));assert parsed.tzinfo is not None, 'timezone required'
image=os.environ['POSTGRES_IMAGE'];assert re.fullmatch(r'[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}',image)
name='verbis-restore'
obj={'apiVersion':'postgresql.cnpg.io/v1','kind':'Cluster','metadata':{'name':name,'namespace':ns},'spec':{'instances':1,'imageName':image,'storage':{'size':os.environ.get('DRILL_STORAGE_SIZE','100Gi')},'bootstrap':{'recovery':{'source':'archive','recoveryTarget':{'targetTime':target}}},'externalClusters':[{'name':'archive','plugin':{'name':'barman-cloud.cloudnative-pg.io','parameters':{'barmanObjectName':os.environ['RECOVERY_OBJECT_STORE'],'serverName':os.environ['BACKUP_SERVER_NAME']}}}]}}
json.dump(obj,open(path,'w'),indent=2)
MANIFEST
if [[ "${2:-}" != '--apply' ]]; then
  echo "Recovery manifest authored: $output; pass --apply to create an isolated drill."
  exit 0
fi
# Namespace must already exist, have drill label, and have independently scoped read-only archive credentials.
label=$(kubectl get namespace "$namespace" -o 'jsonpath={.metadata.labels.verbis\.io/drill}')
[[ "$label" == 'true' ]] || { echo 'Namespace lacks verbis.io/drill=true' >&2; exit 1; }
if kubectl get cluster/verbis-restore -n "$namespace" >/dev/null 2>&1; then
  echo 'Restore cluster already exists; use a fresh drill namespace' >&2; exit 1
fi
kubectl create -n "$namespace" -f "$output"
kubectl wait -n "$namespace" --for=condition=Ready cluster/verbis-restore --timeout=30m
# No write traffic, production routes, automatic promotion, or secret values are printed.
echo 'Isolated recovery ready. Verify RLS, row counts, audit chain and archive checkpoint before recording RTO.'
