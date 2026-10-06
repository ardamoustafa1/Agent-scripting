#!/usr/bin/env bash
set -euo pipefail
archive=${1:?archive required}
: "${EXPORT_PUBLIC_KEY:?bundle signer public key required}"
# Verify BEFORE parsing/extracting/loading any untrusted data. No internet/TUF refresh.
cosign verify-blob --key "$EXPORT_PUBLIC_KEY" --bundle "$archive.sigstore.json" --offline "$archive"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
python3 - "$archive" "$work" <<'EXTRACT'
import tarfile,sys
with tarfile.open(sys.argv[1]) as archive:
 archive.extractall(sys.argv[2],filter='data')
EXTRACT
while IFS=$'\t' read -r name source target; do
  digest=${source##*@}
  skopeo copy --all --preserve-digests "oci:$work/images/$name:release" "docker://$target@$digest"
  # Destination signatures are deliberately recreated; source verification is bound by the signed bundle.
  if [[ -n "${DESTINATION_SIGNING_KEY:-}" ]]; then
    cosign sign --yes --key "$DESTINATION_SIGNING_KEY" --tlog-upload=false "$target@$digest"
  fi
done < <(python3 - "$work/inventory.json" <<'ROWS'
import json,sys
for row in json.load(open(sys.argv[1])):
 print(row['name'],row['source'],row['target'],sep='\t')
ROWS
)
: "${OFFLINE_CHART_DIR:?persistent offline chart destination required}"
mkdir -p "$OFFLINE_CHART_DIR"
cp "$work/charts/"*.tgz "$OFFLINE_CHART_DIR/"
echo 'Images imported without changing their digests; chart archives copied.'
