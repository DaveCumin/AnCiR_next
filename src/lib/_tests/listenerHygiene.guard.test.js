// A guard against listeners that outlive the thing that registered them.
//
// The 2026-08 audit found five leaks with one shared root cause: something is
// registered during setup, and the teardown either does not exist, does not run,
// or was never wired up. The behavioural tests for each fix prove today's code is
// right. THIS test is about the next one: it scans source for the two shapes that
// let all five through review.
//
// Rule 1 is exact and has no false positives: removeEventListener REQUIRES two
// arguments. `document.removeEventListener('keydown')` throws a TypeError at
// runtime and removes nothing, which is exactly what +page.svelte does today.
//
// Rule 2 is deliberately COARSE: it proves a removal path EXISTS in the same file
// for the same event type, not that it always runs. Coarse is the point. It is
// cheap, it has no false positives on correct code, and it would have flagged all
// four dropdown sites and the tooltip helper.
//
// KNOWN_OFFENDERS is a ratchet, not a permanent exemption. It only ever shrinks.
// A genuine app-lifetime listener goes in INTENTIONAL_GLOBAL with its reason.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..', '..'); // src/

// Walked rather than globbed, matching designTokens.guard.test.js next door.
// node:fs globSync needs Node 22+, and a guard test that silently scans nothing
// on an older runtime is worse than no guard at all.
function sourceFiles(dir = srcRoot, out = []) {
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry.startsWith('.')) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			sourceFiles(full, out);
			continue;
		}
		if (!/\.(svelte|js)$/.test(entry)) continue;
		if (entry.includes('.test.') || entry.includes('.spec.')) continue;
		out.push(full);
	}
	return out;
}

/**
 * Listeners that are installed once for the life of the process and are correct
 * to leave attached. Each entry must say why, because "it is fine" is what the
 * tooltip helper's header said for a year while it leaked a pair per plot mount.
 */
const INTENTIONAL_GLOBAL = {
	'lib/core/errorReporter.js':
		'installErrorReporter is idempotent and the backstop must outlive every component',
	'lib/components/plotbits/helpers/tooltipHelpers.js':
		'exactly one shared Alt tracker for the whole app; per-plot state is a Set entry released on destroy'
};

/**
 * Sites that leak today and are fixed by later tasks in this plan. Each entry is
 * `<path relative to src/>:<eventType>`; the path never contains a colon. Delete
 * each entry in the task that fixes it. This list must reach [] by Task 6.
 */
const KNOWN_OFFENDERS = [
	'lib/components/reusables/Draggable.svelte:resize',
	'lib/components/views/WorksheetDisplay.svelte:resize',
	'lib/components/views/ControlDisplay.svelte:resize',
	'lib/components/inputs/ColourPaletteSelect.svelte:resize',
	'routes/+page.svelte:keydown'
];

const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

const addsType = (text, type) =>
	new RegExp(`(?:window|document)\\.addEventListener\\(\\s*['"]${type}['"]`).test(text);

// A removal only counts if it passes a second argument. A one-argument call is
// the rule-1 bug: it throws instead of removing, so treating it as a removal
// here would let the exact leak we are guarding against hide from rule 2.
const removesType = (text, type) =>
	new RegExp(`removeEventListener\\(\\s*['"]${type}['"]\\s*,`).test(text);

// `{ once: true }` self-removes, so a matching removal is not required.
const selfRemoving = (text, type) =>
	new RegExp(`addEventListener\\(\\s*['"]${type}['"][^)]*once:\\s*true`).test(text);

describe('listener hygiene', () => {
	it('finds source files to scan (guards against the walk matching nothing)', () => {
		expect(sourceFiles().length).toBeGreaterThan(200);
	});

	it('every removeEventListener call passes at least two arguments', () => {
		const offenders = [];
		for (const file of sourceFiles()) {
			const rel = relative(srcRoot, file);
			readFileSync(file, 'utf8')
				.split('\n')
				.forEach((line, i) => {
					if (isComment(line)) return;
					const m = /removeEventListener\(([^)]*)\)/.exec(line);
					if (!m) return;
					const args = m[1].split(',').filter((a) => a.trim().length > 0);
					if (args.length >= 2) return;
					const type = /^\s*['"]([\w-]+)['"]\s*$/.exec(args[0] ?? '')?.[1];
					offenders.push({
						key: type ? `${rel}:${type}` : null,
						detail: `${rel}:${i + 1}  ${line.trim()}`
					});
				});
		}
		const unexpected = offenders
			.filter((o) => !o.key || !KNOWN_OFFENDERS.includes(o.key))
			.map((o) => o.detail);
		expect(
			unexpected,
			'removeEventListener requires (type, handler). Called with one argument it throws\n' +
				'a TypeError and removes nothing, so the listener leaks AND the surrounding\n' +
				'cleanup function aborts part-way through.\n\n' +
				unexpected.join('\n')
		).toEqual([]);
	});

	it('every window/document listener has a matching removal in the same file', () => {
		const offenders = [];
		for (const file of sourceFiles()) {
			const rel = relative(srcRoot, file);
			if (INTENTIONAL_GLOBAL[rel]) continue;
			const text = readFileSync(file, 'utf8');
			const added = new Set();
			for (const m of text.matchAll(
				/(?:window|document)\.addEventListener\(\s*['"]([\w-]+)['"]/g
			)) {
				added.add(m[1]);
			}
			for (const type of added) {
				if (removesType(text, type) || selfRemoving(text, type)) continue;
				offenders.push(`${rel}:${type}`);
			}
		}
		const unexpected = offenders.filter((o) => !KNOWN_OFFENDERS.includes(o));
		expect(
			unexpected,
			'These files add a window/document listener with no removal for that event type.\n' +
				'Prefer $effect with a returned cleanup, which covers close AND unmount:\n' +
				"    $effect(() => { if (!open) return; window.addEventListener('resize', f);\n" +
				"                    return () => window.removeEventListener('resize', f); });\n" +
				'If the listener genuinely must live for the whole app, add the file to\n' +
				'INTENTIONAL_GLOBAL with a reason.\n\n' +
				unexpected.join('\n')
		).toEqual([]);
	});

	it('the known-offender list only ever shrinks', () => {
		// Every entry must still be a real offender. A stale entry means a fix landed
		// without removing its line here, which would silently re-open the hole.
		const stale = [];
		for (const entry of KNOWN_OFFENDERS) {
			const split = entry.lastIndexOf(':');
			const rel = entry.slice(0, split);
			const type = entry.slice(split + 1);
			const text = readFileSync(resolve(srcRoot, rel), 'utf8');
			const stillLeaks = addsType(text, type) && !removesType(text, type);
			if (!stillLeaks) stale.push(entry);
		}
		expect(
			stale,
			'Stale KNOWN_OFFENDERS entries: these no longer leak, so delete them from the list.\n\n' +
				stale.join('\n')
		).toEqual([]);
	});
});
