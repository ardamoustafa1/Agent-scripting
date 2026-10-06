#!/usr/bin/env bash
set -euo pipefail
# export-airgap.sh images.json output-directory
# Requires skopeo, cosign, helm, python3, tar; authenticated source registries.
manifest=${1:?images.json required}
out=${2:?new output directory required}
if [[ -z "${COSIGN_PUBLIC_KEY:-}" ]]; then
  : "${COSIGN_CERTIFICATE_IDENTITY:?exact publisher certificate identity required}"
  : "${COSIGN_OIDC_ISSUER:?publisher OIDC issuer required}"
fi
: "${EXPORT_SIGNING_KEY:?offline bundle signing key required (outside output)}"
[[ ! -e "$out" ]] || { echo 'Output directory already exists' >&2; exit 1; }
mkdir -p "$out/images" "$out/provenance" "$out/charts"
python3 - "$manifest" "$out/inventory.json" <<'CHECK'
import json,re,sys
items=json.load(open(sys.argv[1]))
assert isinstance(items,list) and items, 'image list required'
seen=set()
for row in items:
 assert re.fullmatch(r'[a-z0-9][a-z0-9-]{0,62}',row['name']), 'invalid name'
 assert row['name'] not in seen, 'duplicate image name'
 seen.add(row['name'])
 assert re.fullmatch(r'[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}',row['source']), 'digest required'
 assert re.fullmatch(r'[A-Za-z0-9._:/-]+',row['target']), 'invalid target repository'
 assert '@' not in row['target'], 'target must be repository without digest'
json.dump(items,open(sys.argv[2],'w'),indent=2)
CHECK
while IFS=$'\t' read -r name source target; do
  if [[ -n "${COSIGN_PUBLIC_KEY:-}" ]]; then
    cosign verify --key "$COSIGN_PUBLIC_KEY" "$source" > "$out/provenance/$name.json"
  else
    cosign verify --certificate-identity "$COSIGN_CERTIFICATE_IDENTITY" --certificate-oidc-issuer "$COSIGN_OIDC_ISSUER" "$source" > "$out/provenance/$name.json"
  fi
  skopeo copy --all --preserve-digests "docker://$source" "oci:$out/images/$name:release"
done < <(python3 - "$out/inventory.json" <<'ROWS'
import json,sys
for row in json.load(open(sys.argv[1])):
 print(row['name'],row['source'],row['target'],sep='\t')
ROWS
)
helm package deploy/helm/verbis --destination "$out/charts"
# Optional already-downloaded operator/dependency chart archives; never fetch during offline install.
if [[ -n "${DEPENDENCY_CHART_DIR:-}" ]]; then
  find "$DEPENDENCY_CHART_DIR" -maxdepth 1 -name '*.tgz' -exec cp '{}' "$out/charts/" \;
fi
cp -R deploy/scripts "$out/scripts"
cp docs/ops/INSTALL_ONPREM.md docs/ops/DR.md "$out/"
archive="${out%/}.tar"
[[ ! -e "$archive" ]] || { echo 'Archive already exists' >&2; exit 1; }
tar -C "$out" -cf "$archive" .
cosign sign-blob --yes --key "$EXPORT_SIGNING_KEY" --bundle "$archive.sigstore.json" "$archive"
echo "Bundle and signature created: $archive"
