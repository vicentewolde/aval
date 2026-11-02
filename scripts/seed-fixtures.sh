#!/usr/bin/env bash
# Copies the four invented listings (real Muse Spark + SAM 3.1 + Voice results, saved in fixtures/listings/)
# into .aval/ so you can try search, ask and the gateway without spending anything:
#   ./scripts/seed-fixtures.sh && node src/cli.ts search '{"min_bedrooms":2,"pets_required":true}'
# (Evidence images are not included in the repo; the claims and their evidence data are.)
set -euo pipefail
cd "$(dirname "$0")/.."
for f in fixtures/listings/*.json; do
  id=$(basename "$f" .json)
  mkdir -p ".aval/listings/$id/evidence"
  cp "$f" ".aval/listings/$id/listing.json"
done
ls .aval/listings
