#!/usr/bin/env bash
# Build a PRODUCTION bundle of the app for the browser benchmark WITHOUT touching
# the repo's own build/ directory and WITHOUT running `pnpm build` (whose postbuild
# step FTP-deploys). The app sources are copied to a temp directory, node_modules is
# symlinked, and only `vite build` is run there. Then serve with `vite preview`.
#
# Usage: tools/benchmarks/paper/scaling/browser/prepare-app.sh [DEST]
#   DEST defaults to ${TMPDIR:-/tmp}/ancir-bench-app
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../../.." && pwd)"
DEST="${1:-${TMPDIR:-/tmp}/ancir-bench-app}"

rm -rf "$DEST"
mkdir -p "$DEST/tools"
for item in src static packages scripts svelte.config.js vite.config.js package.json jsconfig.json pnpm-workspace.yaml; do
	cp -R "$REPO/$item" "$DEST/"
done
cp "$REPO/tools/ancir_runtime.py" "$REPO/tools/ancir_runtime.R" "$DEST/tools/"
ln -s "$REPO/node_modules" "$DEST/node_modules"

cd "$DEST"
git -C "$REPO" rev-parse --short HEAD > "$DEST/.bench-git-rev" 2>/dev/null || true
git -C "$REPO" status --porcelain > "$DEST/.bench-git-status" 2>/dev/null || true
# Optional diagnostic variant (NOT the shipped configuration): BUNDLE_SPLIT=1 switches the
# COPY's kit.output.bundleStrategy from 'inline' to 'split'. With 'inline', the compute
# worker URL resolves relative to index.html (/workers/...) instead of /_app/immutable/
# workers/..., so the Web Worker fails to load and every task falls back to the main
# thread. The split variant lets us measure what worker offloading would deliver.
if [ "${BUNDLE_SPLIT:-0}" = "1" ]; then
	sed -i.bak "s/bundleStrategy: 'inline'/bundleStrategy: 'split'/" svelte.config.js
	grep -q "bundleStrategy: 'split'" svelte.config.js || { echo "failed to patch copy"; exit 1; }
fi
node_modules/.bin/svelte-kit sync
node_modules/.bin/vite build --logLevel warn
echo "Built production app in $DEST/build (git $(cat "$DEST/.bench-git-rev" 2>/dev/null))"
echo "Serve with: (cd $DEST && node_modules/.bin/vite preview --port 4317 --strictPort)"
