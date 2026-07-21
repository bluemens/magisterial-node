#!/usr/bin/env bash
# Regenerate src/generated/api.ts from the published OpenAPI contract.
#
# By default pulls the live spec; pass a path to use a local artifact
# (e.g. ../magisterial/api/public_api/openapi.json during development).
#
#   ./scripts/sync-types.sh [spec-path-or-url]
set -euo pipefail
cd "$(dirname "$0")/.."

SPEC="${1:-https://api.magisterial.ai/v1/openapi.json}"

if [[ "$SPEC" == http* ]]; then
  curl -fsS "$SPEC" -o openapi.json
else
  cp "$SPEC" openapi.json
fi

npx openapi-typescript openapi.json -o src/generated/api.ts

echo "Regenerated src/generated/api.ts from $SPEC"
echo "Review the diff (src/types.ts aliases may need additions), run npm test,"
echo "and bump the version if shapes changed."
