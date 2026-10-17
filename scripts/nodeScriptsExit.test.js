// @vitest-environment node
//
// The release steps that import the app registry in plain Node must EXIT when done.
//
// `npm run mcp:schema` (scripts/mcpRelease.mjs -> vite-node mcp/src/emit/gen-schema.js) once
// wrote its file and then hung, which hung the release gate and `npm run build`. The cause:
// vite-node asks Vite for `server.watch: null`, Vite's mergeConfig drops null values, so a real
// chokidar watcher ran; every ../src/lib module was `watcher.add`ed, and on macOS an fsevents
// instance created after vite-node's server.close() was never stopped. It was a race, so it
// hung only some runs (about 1 in 6 at v82.25). mcp/vite.config.js now sets `watch: null`
// itself outside vitest, and gen-schema.js force-exits (with a warning) if anything still
// holds Node 10 s after writing.
//
// Two checks, because the hang itself is intermittent:
//   1. deterministic: resolving the mcp Vite config the way vite-node does yields no watcher;
//   2. end to end: the real generator exits 0 well inside the limit, without the force-exit
//      warning (which would mean some import-time handle, e.g. a timer, leaked again).
//
// static/nodes.json (`npm run manifest:gen`) is not run here: it goes through vitest, which
// tears its own workers down, and running it from the suite would rewrite the committed
// manifest and so mask nodeManifestFreshness.svelte.test.js.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const mcp = join(repo, 'mcp');
const viteNode = join(mcp, 'node_modules', '.bin', 'vite-node');
const mcpVite = join(mcp, 'node_modules', 'vite', 'dist', 'node', 'index.js');

// The mcp toolchain is a local release dependency; CI / Pages never install it.
const haveToolchain = existsSync(viteNode) && existsSync(mcpVite);

/** The environment `npm run mcp:schema` sees: none of the variables vitest sets. */
function releaseEnv(extra = {}) {
	const env = { ...process.env, ...extra };
	for (const k of Object.keys(env)) if (k.startsWith('VITEST')) delete env[k];
	delete env.TEST;
	if (env.NODE_ENV === 'test') delete env.NODE_ENV;
	return env;
}

describe.skipIf(!haveToolchain)('node-side release scripts exit', () => {
	it('vite-node resolves the mcp config with no file watcher', () => {
		// Exactly vite-node's inline server options (vite-node/dist/cli.mjs), merged with the
		// mcp config file by the mcp workspace's own Vite.
		const probe = `
			const { resolveConfig } = await import(${JSON.stringify('file://' + mcpVite)});
			const c = await resolveConfig(
				{ root: ${JSON.stringify(mcp)}, server: { hmr: false, watch: null } },
				'serve'
			);
			console.log(JSON.stringify({ watch: c.server.watch }));
		`;
		const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
			cwd: mcp,
			env: releaseEnv(),
			encoding: 'utf8',
			timeout: 60_000
		});
		expect(r.status, r.stderr).toBe(0);
		const line = r.stdout.trim().split('\n').at(-1);
		expect(JSON.parse(line)).toEqual({ watch: null });
	}, 70_000);

	it('gen-schema writes the schema and exits 0 promptly', () => {
		const dir = mkdtempSync(join(tmpdir(), 'ancir-gen-schema-'));
		const out = join(dir, 'schema.json');
		try {
			const t0 = Date.now();
			const r = spawnSync(viteNode, ['src/emit/gen-schema.js'], {
				cwd: mcp,
				env: releaseEnv({ ANCIR_SCHEMA_OUT: out }),
				encoding: 'utf8',
				timeout: 90_000,
				killSignal: 'SIGKILL'
			});
			const secs = (Date.now() - t0) / 1000;
			const log = `${r.stdout}\n${r.stderr}`;
			expect(r.error?.code, `gen-schema did not exit within 90 s\n${log}`).toBeUndefined();
			expect(r.status, log).toBe(0);
			expect(log).not.toMatch(/kept Node alive/);
			expect(JSON.parse(readFileSync(out, 'utf8')).count).toBeGreaterThan(0);
			// Normally ~8 s; the force-exit fallback fires at 10 s after the write.
			expect(secs).toBeLessThan(60);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 100_000);
});
