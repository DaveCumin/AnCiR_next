// The release gate: `npm run build` runs this first (as `prebuild`), and it fails the build
// BEFORE anything is generated or deployed when:
//
//   1. the working tree has uncommitted or untracked changes (`git status --porcelain`), or
//   2. lint fails (`pnpm run lint`: prettier --check + eslint), or
//   3. the unit suite fails (`pnpm exec vitest run`, no flags).
//
// Why: `npm run build` publishes as a side effect (postbuild: mcp:deploy + FTP), and that is
// intended. So a build IS a release, and a release must be of committed, tested code. On
// 2026-09-30 a build put a mid-edit tree into production; this gate is what stops that.
//
// Before lint and tests it runs the build's version-sync steps (VERSION_SYNC_STEPS), which
// only write files that may be dirty, so a version bump does not fail the freshness tests.
//
// Release ritual under the gate: commit the source (including the version bump in
// core.svelte.js) FIRST, then `npm run build`, then commit the build artefacts it writes
// (or `git commit --amend --no-edit` to keep one commit per release). The build's own
// artefacts are allowed to be dirty (see BUILD_OUTPUTS), so re-running a build after, say,
// a failed upload is not blocked by the previous build's output.
//
// Overrides (deliberate cases only; each prints a loud warning):
//   ANCIR_ALLOW_DIRTY_BUILD=1 npm run build   skip the clean-tree check (lint + tests still run)
//   ANCIR_SKIP_BUILD_GATE=1   npm run build   skip the whole gate
//
// On CI (Cloudflare Pages sets CI=true and CF_PAGES=1) the gate is skipped, like the other
// local release steps (see scripts/mcpRelease.mjs, scripts/genManifest.mjs): Pages builds a
// fresh clone of a pushed commit and deploys nothing outside Pages.
//
// npm runs `prebuild` automatically before `build`, as does pnpm 9 (checked: `pnpm build`
// runs prebuild, build, postbuild in order), so both entry points are gated.

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * Untracked files the author deliberately keeps in the tree that must not block a build.
 * Matched only against UNTRACKED (`??`) paths; a tracked file is never excused by this list.
 * Globs: `*` matches within one path segment, `**` across segments; everything else is
 * literal (so brackets and spaces in pCloud "[conflicted]" names need no escaping).
 *
 * To add one: append its repo-relative path (or a glob) here, with a comment saying why.
 */
export const KNOWN_LEFTOVERS = [
	'dbg-datapanel.png', // local debugging screenshot
	'src/lib/components/plotbits/Band [conflicted].svelte', // pCloud conflict copy, kept for reference
	'tools/benchmarks/paper/*_Data.json' // large local benchmark inputs, not for the repo
];

/**
 * Tracked files the build itself rewrites (generateBuild.js, mcp:schema, manifest:gen,
 * vite build). They may be dirty when the gate runs, because they only ever hold the
 * previous build's output and this build regenerates them.
 */
export const BUILD_OUTPUTS = [
	'build/index.html',
	'src/lib/utils/build-info.js',
	'CITATION.cff',
	'mcp/src/emit/session-schema.generated.json',
	'static/nodes.json'
];

/**
 * Files allowed to be dirty ONLY when every changed line is a `version` line: package.json
 * (generateBuild.js writes its version) and core.svelte.js (the hand-edited source of truth,
 * so a bump alone does not need its own commit before building). Any other change blocks.
 */
export const VERSION_ONLY_FILES = ['package.json', 'src/lib/core/core.svelte.js'];

/** The build's first steps, run by the gate too so the freshness tests see this version. */
export const VERSION_SYNC_STEPS = [
	['node', ['src/lib/utils/generateBuild.js']],
	['npm', ['run', 'mcp:schema']],
	['npm', ['run', 'manifest:gen']]
];

const VERSION_LINE = /^\s*"?version"?\s*:\s*["'][^"']*["'],?\s*$/;

/** Convert a KNOWN_LEFTOVERS glob into an anchored RegExp. */
export function globToRegExp(glob) {
	let re = '';
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === '*' && glob[i + 1] === '*') {
			re += '.*';
			i++;
		} else if (c === '*') {
			re += '[^/]*';
		} else {
			re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
		}
	}
	return new RegExp(`^${re}$`);
}

/**
 * Parse `git status --porcelain=v1 -z` output into [{ code, path }].
 * In -z mode paths are never quoted, and a rename/copy entry is followed by its source path.
 */
export function parsePorcelainZ(text) {
	const parts = text.split('\0');
	const entries = [];
	for (let i = 0; i < parts.length; i++) {
		const rec = parts[i];
		if (!rec) continue;
		const code = rec.slice(0, 2);
		entries.push({ code, path: rec.slice(3) });
		if (code[0] === 'R' || code[0] === 'C') i++; // skip the "from" path
	}
	return entries;
}

/** True when a `git diff --unified=0` changes nothing but `version` lines. */
export function isVersionOnlyDiff(diffText) {
	const changed = diffText
		.split('\n')
		.filter((l) => (l.startsWith('+') || l.startsWith('-')) && !/^(\+\+\+|---) /.test(l));
	return changed.length > 0 && changed.every((l) => VERSION_LINE.test(l.slice(1)));
}

/**
 * Decide which status entries block the build.
 * @param {{code: string, path: string}[]} entries
 * @param {(path: string) => string} diffOf  `git diff HEAD --unified=0 -- path` for a file
 * @returns {{code: string, path: string}[]} the blocking entries
 */
export function findBlockingChanges(entries, diffOf) {
	const leftovers = KNOWN_LEFTOVERS.map(globToRegExp);
	return entries.filter(({ code, path }) => {
		if (code === '??') return !leftovers.some((re) => re.test(path));
		if (BUILD_OUTPUTS.includes(path)) return false;
		if (VERSION_ONLY_FILES.includes(path) && code.trim() === 'M') {
			return !isVersionOnlyDiff(diffOf(path));
		}
		return true;
	});
}

/** Default command runner: inherit output unless `capture`, return { status, stdout }. */
function defaultRun(cmd, args, { capture = false } = {}) {
	const r = spawnSync(cmd, args, {
		stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
		shell: process.platform === 'win32'
	});
	if (r.error) return { status: 127, stdout: '', error: r.error };
	return { status: r.status ?? 1, stdout: r.stdout ?? '' };
}

const truthy = (v) => v !== undefined && v !== '' && v !== '0' && v !== 'false';

/**
 * Run the gate. Returns the process exit code (0 = build may proceed).
 * `run`, `env` and `log` are injectable so the gate is testable without git, lint or vitest.
 */
export function runGate({ run = defaultRun, env = process.env, log = console } = {}) {
	if (truthy(env.CI) || truthy(env.CF_PAGES)) {
		log.log('Release gate: skipped on CI (local release step; see scripts/releaseGate.mjs).');
		return 0;
	}
	if (truthy(env.ANCIR_SKIP_BUILD_GATE)) {
		log.warn(
			'Release gate: SKIPPED ENTIRELY because ANCIR_SKIP_BUILD_GATE is set. ' +
				'This build is untested and may contain uncommitted work.'
		);
		return 0;
	}

	const started = Date.now();
	const secs = (t0) => ((Date.now() - t0) / 1000).toFixed(1);
	log.log('Release gate: checking the tree, lint and unit tests before building...');

	// 1. Clean tree.
	if (truthy(env.ANCIR_ALLOW_DIRTY_BUILD)) {
		log.warn(
			'Release gate: clean-tree check SKIPPED because ANCIR_ALLOW_DIRTY_BUILD is set. ' +
				'Uncommitted changes WILL be built and deployed.'
		);
	} else {
		const st = run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
			capture: true
		});
		if (st.status !== 0) {
			log.error(
				`Release gate FAILED: clean-tree check. \`git status\` exited ${st.status}.\n` +
					'  Fix: make sure this is a working git checkout (pCloud has corrupted .git before: ' +
					'look for `.git/* [conflicted*]` files).'
			);
			return 1;
		}
		const diffOf = (p) =>
			run('git', ['diff', 'HEAD', '--unified=0', '--', p], { capture: true }).stdout;
		const blocking = findBlockingChanges(parsePorcelainZ(st.stdout), diffOf);
		if (blocking.length) {
			log.error(
				`Release gate FAILED: clean-tree check. ${blocking.length} uncommitted or untracked ` +
					'change(s) would be built and deployed:\n' +
					blocking.map((e) => `    ${e.code} ${e.path}`).join('\n') +
					'\n  Fix: commit (or discard) these changes, then build again.\n' +
					'  If a file is a permanent local leftover, add it to KNOWN_LEFTOVERS in ' +
					'scripts/releaseGate.mjs.\n' +
					'  To build this tree on purpose: ANCIR_ALLOW_DIRTY_BUILD=1 npm run build'
			);
			return 1;
		}
		log.log('Release gate: tree is clean.');
	}

	// 2. Sync the version-derived files (package.json and CITATION.cff versions, the MCP
	// schema, static/nodes.json) before testing them. The build regenerates these anyway, and
	// the suite checks they match appConsts.version, so without this step every version bump
	// would fail the gate. They are all in BUILD_OUTPUTS or VERSION_ONLY_FILES.
	let t0 = Date.now();
	for (const [cmd, args] of VERSION_SYNC_STEPS) {
		const r = run(cmd, args);
		if (r.status !== 0) {
			log.error(
				`Release gate FAILED: version sync (\`${[cmd, ...args].join(' ')}\` exited ${r.status}).\n` +
					'  Fix: run that command on its own and fix the error it shows.\n' +
					'  To skip the gate on purpose: ANCIR_SKIP_BUILD_GATE=1 npm run build'
			);
			return 1;
		}
	}
	log.log(`Release gate: version-derived files synced (${secs(t0)} s).`);

	// 3. Lint.
	t0 = Date.now();
	const lint = run('pnpm', ['run', 'lint']);
	if (lint.status !== 0) {
		log.error(
			`Release gate FAILED: lint (\`pnpm run lint\` exited ${lint.status}, after ${secs(t0)} s).\n` +
				'  Fix: `pnpm run format` for prettier warnings, then fix any eslint errors shown above.\n' +
				'  To skip the gate on purpose: ANCIR_SKIP_BUILD_GATE=1 npm run build'
		);
		return 1;
	}
	log.log(`Release gate: lint passed (${secs(t0)} s).`);

	// 4. Unit tests.
	t0 = Date.now();
	const tests = run('pnpm', ['exec', 'vitest', 'run']);
	if (tests.status !== 0) {
		log.error(
			`Release gate FAILED: unit tests (\`pnpm exec vitest run\` exited ${tests.status}, after ${secs(t0)} s).\n` +
				'  Fix: make the failing tests above pass (`pnpm exec vitest run <file>` to iterate).\n' +
				'  To skip the gate on purpose: ANCIR_SKIP_BUILD_GATE=1 npm run build'
		);
		return 1;
	}
	log.log(`Release gate: unit tests passed (${secs(t0)} s).`);

	log.log(`Release gate: passed in ${secs(started)} s. Building.`);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exit(runGate());
}
