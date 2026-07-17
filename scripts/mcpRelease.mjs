// The mcp/ steps of `npm run build`: regenerate the node catalogue, deploy the Worker.
//
// Both are LOCAL release steps, and both are skipped on CI. Cloudflare Pages runs the same
// `npm run build` to publish the app, and there:
//
//   - gen-schema needs vite-node + the whole Svelte toolchain out of mcp/node_modules, which
//     Pages never installs (it installs the root package only). It failed with
//     "ViteNodeServer: .../mcp/node_modules/.vite/deps/... not found".
//   - deploying the Worker needs a Cloudflare API token, and a Pages build has no business
//     shipping a Worker anyway — that's the developer's deliberate act.
//
// Neither is a loss: session-schema.generated.json is committed (the build regenerates it so a
// version bump can't be forgotten), and the Worker bundles that committed file when IT is
// deployed, from a machine that does have the toolchain.
//
// Pages sets CI=true and CF_PAGES=1 exactly for this:
// https://developers.cloudflare.com/pages/configuration/build-configuration/

import { execSync } from 'node:child_process';

const TASKS = {
	schema: {
		label: 'Regenerating the mcp node catalogue',
		cmd: 'npx vite-node src/emit/gen-schema.js'
	},
	deploy: {
		label: 'Deploying the ancir-nl Worker',
		cmd: 'npx wrangler deploy --config worker/wrangler.toml'
	}
};

const mode = process.argv[2];
const task = TASKS[mode];
if (!task) {
	console.error(`mcpRelease: expected one of ${Object.keys(TASKS).join(', ')} — got "${mode}"`);
	process.exit(1);
}

if (process.env.CI) {
	console.log(`⏭  ${task.label}: skipped on CI (local release step; see scripts/mcpRelease.mjs).`);
	process.exit(0);
}

console.log(`▶ ${task.label}…`);
try {
	execSync(task.cmd, { cwd: 'mcp', stdio: 'inherit' });
} catch {
	// Fail loudly. A silently-skipped deploy leaves production stale, and a silently-skipped
	// regenerate ships a catalogue that disagrees with the app — the exact drift this replaced.
	console.error(`✖ ${task.label} failed. Fix it, or run \`npm run buildonly\` to build without it.`);
	process.exit(1);
}
