import { describe, it, expect } from 'vitest';
import {
	runGate,
	parsePorcelainZ,
	globToRegExp,
	isVersionOnlyDiff,
	findBlockingChanges
} from './releaseGate.mjs';

// A stub runner: git status returns `porcelain`, git diff returns diffs[path], lint and
// vitest return the given exit codes. Records every call so tests can assert what ran.
function stub({ porcelain = '', diffs = {}, lint = 0, tests = 0, gitStatus = 0, sync = 0 } = {}) {
	const calls = [];
	const run = (cmd, args) => {
		calls.push([cmd, ...args].join(' '));
		if (cmd === 'git' && args[0] === 'status') return { status: gitStatus, stdout: porcelain };
		if (cmd === 'git' && args[0] === 'diff') return { status: 0, stdout: diffs[args.at(-1)] ?? '' };
		if (cmd === 'pnpm' && args.includes('lint')) return { status: lint, stdout: '' };
		if (cmd === 'pnpm' && args.includes('vitest')) return { status: tests, stdout: '' };
		if (cmd === 'node' && args[0] === 'src/lib/utils/generateBuild.js') return { status: sync };
		if (cmd === 'npm' && (args[1] === 'mcp:schema' || args[1] === 'manifest:gen'))
			return { status: 0 };
		throw new Error(`unexpected command ${cmd} ${args.join(' ')}`);
	};
	const out = [];
	const log = {
		log: (m) => out.push(m),
		warn: (m) => out.push(m),
		error: (m) => out.push(m)
	};
	return { run, log, calls, text: () => out.join('\n') };
}

const z = (...recs) => recs.map((r) => r + '\0').join('');

describe('releaseGate', () => {
	it('passes a clean tree with passing lint and tests, running all three checks', () => {
		const s = stub();
		expect(runGate({ run: s.run, env: {}, log: s.log })).toBe(0);
		expect(s.calls).toEqual([
			'git status --porcelain=v1 -z --untracked-files=all',
			'node src/lib/utils/generateBuild.js',
			'npm run mcp:schema',
			'npm run manifest:gen',
			'pnpm run lint',
			'pnpm exec vitest run'
		]);
		expect(s.text()).toMatch(/passed in/);
	});

	it('syncs version-derived files before testing, and stops if a sync step fails', () => {
		const s = stub({ sync: 1 });
		expect(runGate({ run: s.run, env: {}, log: s.log })).toBe(1);
		expect(s.text()).toMatch(/FAILED: version sync/);
		expect(s.calls).not.toContain('pnpm exec vitest run');
	});

	it('fails on a modified tracked file, names it, and runs nothing else', () => {
		const s = stub({ porcelain: z(' M src/lib/core/Column.svelte') });
		expect(runGate({ run: s.run, env: {}, log: s.log })).toBe(1);
		expect(s.text()).toMatch(/FAILED: clean-tree check/);
		expect(s.text()).toMatch(/ M src\/lib\/core\/Column\.svelte/);
		expect(s.text()).toMatch(/ANCIR_ALLOW_DIRTY_BUILD=1/);
		expect(s.calls).toHaveLength(1);
	});

	it('fails on an untracked file that is not a known leftover', () => {
		const s = stub({ porcelain: z('?? handbook/scripts/build-animations.mjs') });
		expect(runGate({ run: s.run, env: {}, log: s.log })).toBe(1);
		expect(s.text()).toMatch(/\?\? handbook\/scripts\/build-animations\.mjs/);
	});

	it('ignores the listed known leftovers (untracked only)', () => {
		const s = stub({ porcelain: z('?? dbg-datapanel.png') });
		expect(runGate({ run: s.run, env: {}, log: s.log })).toBe(0);
	});

	it('fails on a stray pCloud conflict copy (no longer on the leftover list)', () => {
		const s = stub({ porcelain: z('?? src/lib/components/plotbits/Band [conflicted].svelte') });
		expect(runGate({ run: s.run, env: {}, log: s.log })).toBe(1);
		expect(s.text()).toMatch(/Band \[conflicted\]\.svelte/);
	});

	it('does not excuse a TRACKED file just because its path is on the leftover list', () => {
		const s = stub({ porcelain: z(' M dbg-datapanel.png') });
		expect(runGate({ run: s.run, env: {}, log: s.log })).toBe(1);
	});

	it("allows the build's own outputs and version-only bumps to be dirty", () => {
		const s = stub({
			porcelain: z(' M build/index.html', ' M src/lib/utils/build-info.js', ' M package.json'),
			diffs: {
				'package.json':
					'diff --git a/package.json b/package.json\n--- a/package.json\n+++ b/package.json\n' +
					'@@ -3 +3 @@\n-\t"version": "78.1",\n+\t"version": "78.2",\n'
			}
		});
		expect(runGate({ run: s.run, env: {}, log: s.log })).toBe(0);
	});

	it('blocks package.json when it changes more than the version', () => {
		const s = stub({
			porcelain: z(' M package.json'),
			diffs: { 'package.json': '@@ -9 +9 @@\n-\t\t"build": "a",\n+\t\t"build": "b",\n' }
		});
		expect(runGate({ run: s.run, env: {}, log: s.log })).toBe(1);
	});

	it('honours ANCIR_ALLOW_DIRTY_BUILD (skips only the tree check)', () => {
		const s = stub({ porcelain: z(' M src/routes/+page.svelte') });
		expect(runGate({ run: s.run, env: { ANCIR_ALLOW_DIRTY_BUILD: '1' }, log: s.log })).toBe(0);
		expect(s.calls).toEqual([
			'node src/lib/utils/generateBuild.js',
			'npm run mcp:schema',
			'npm run manifest:gen',
			'pnpm run lint',
			'pnpm exec vitest run'
		]);
		expect(s.text()).toMatch(/clean-tree check SKIPPED/);
	});

	it('honours ANCIR_SKIP_BUILD_GATE and skips on CI', () => {
		for (const env of [{ ANCIR_SKIP_BUILD_GATE: '1' }, { CI: 'true' }, { CF_PAGES: '1' }]) {
			const s = stub({ porcelain: z(' M x.js'), lint: 1, tests: 1 });
			expect(runGate({ run: s.run, env, log: s.log })).toBe(0);
			expect(s.calls).toEqual([]);
		}
	});

	it('treats ANCIR_ALLOW_DIRTY_BUILD=0 as unset', () => {
		const s = stub({ porcelain: z(' M x.js') });
		expect(runGate({ run: s.run, env: { ANCIR_ALLOW_DIRTY_BUILD: '0' }, log: s.log })).toBe(1);
	});

	it('fails when lint fails, and does not run the tests', () => {
		const s = stub({ lint: 1 });
		expect(runGate({ run: s.run, env: {}, log: s.log })).toBe(1);
		expect(s.text()).toMatch(/FAILED: lint/);
		expect(s.calls).not.toContain('pnpm exec vitest run');
	});

	it('fails when the unit tests fail', () => {
		const s = stub({ tests: 1 });
		expect(runGate({ run: s.run, env: {}, log: s.log })).toBe(1);
		expect(s.text()).toMatch(/FAILED: unit tests/);
	});

	it('fails when git status itself fails', () => {
		const s = stub({ gitStatus: 128 });
		expect(runGate({ run: s.run, env: {}, log: s.log })).toBe(1);
		expect(s.text()).toMatch(/git status` exited 128/);
	});
});

describe('releaseGate helpers', () => {
	it('parses -z porcelain, including renames and names with spaces', () => {
		expect(parsePorcelainZ(z('R  new name.js', 'old.js', '?? a b [c].txt', ' D gone.js'))).toEqual([
			{ code: 'R ', path: 'new name.js' },
			{ code: '??', path: 'a b [c].txt' },
			{ code: ' D', path: 'gone.js' }
		]);
	});

	it('globs: * stays within a segment, ** crosses, brackets are literal', () => {
		expect(globToRegExp('tools/*_Data.json').test('tools/x_Data.json')).toBe(true);
		expect(globToRegExp('tools/*_Data.json').test('tools/a/x_Data.json')).toBe(false);
		expect(globToRegExp('tools/**.json').test('tools/a/x.json')).toBe(true);
		expect(globToRegExp('Band [conflicted].svelte').test('Band [conflicted].svelte')).toBe(true);
		expect(globToRegExp('Band [conflicted].svelte').test('Band c.svelte')).toBe(false);
	});

	it('recognises version-only diffs in both quote styles', () => {
		expect(
			isVersionOnlyDiff("@@ -1 +1 @@\n-\t\tversion: 'β.78.1',\n+\t\tversion: 'β.78.2',\n")
		).toBe(true);
		expect(isVersionOnlyDiff('')).toBe(false);
		expect(isVersionOnlyDiff("-\t\tversion: '1',\n+\t\tversion: '2',\n+\t\tfoo: 1,\n")).toBe(false);
	});

	it('a deleted build output is still excused, a staged-deleted source is not', () => {
		const blocking = findBlockingChanges(
			[
				{ code: ' M', path: 'static/nodes.json' },
				{ code: 'D ', path: 'src/x.js' }
			],
			() => ''
		);
		expect(blocking.map((e) => e.path)).toEqual(['src/x.js']);
	});
});
