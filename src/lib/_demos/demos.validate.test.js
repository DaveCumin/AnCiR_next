/**
 * Guard test: every demo session in static/sessions/demos/ must load through the
 * same reconstruction the app uses (rawData + Column.fromJSON + Plot.fromJSON),
 * produce the expected columns/plots, and yield finite plotted data. This keeps
 * the shipped demos from silently rotting if the session format changes.
 *
 * (Regenerate the demos with: GEN_DEMOS=1 npx vitest run src/lib/_demos/generateDemos.svelte.test.js)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { Process } from '$lib/core/Process.svelte';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';

const DIR = join(process.cwd(), 'static', 'sessions', 'demos');

function loadSession(jsonData) {
	// Mirrors the essential reconstruction in Setting.svelte's importJson.
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.orphanProcesses = [];
	core.rawData = new Map(Object.entries(jsonData.rawData ?? {}).map(([k, v]) => [+k, v]));
	for (const cd of jsonData.data ?? []) pushObj(Column.fromJSON(cd));
	// Rehydrate free (orphan) processes so producer columns (whose value IS a free
	// node's output, e.g. an Add node) resolve, exactly as Setting.svelte does.
	core.orphanProcesses = (jsonData.orphanProcesses ?? [])
		.map((p) => Process.fromJSON(p, null))
		.filter(Boolean);
	for (const pj of jsonData.plots ?? []) pushObj(Plot.fromJSON(pj), false);
}

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
});

describe('demo sessions load + render-safe', () => {
	it('index.json manifest is well-formed and points at existing files', () => {
		const idxPath = join(DIR, 'index.json');
		expect(existsSync(idxPath)).toBe(true);
		const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
		expect(Array.isArray(idx.sessions)).toBe(true);
		expect(idx.sessions.length).toBeGreaterThan(0);
		expect(idx.count).toBe(idx.sessions.length);
		for (const s of idx.sessions) {
			expect(s.id && s.name && s.family && s.url).toBeTruthy();
			const file = s.url.split('/').pop();
			expect(existsSync(join(DIR, file)), `${file} referenced by manifest exists`).toBe(true);
		}
	});

	const demoFiles = existsSync(DIR)
		? readdirSync(DIR).filter((f) => f.startsWith('demo-') && f.endsWith('.json'))
		: [];

	it('has demo files to validate', () => {
		expect(demoFiles.length).toBeGreaterThan(0);
	});

	it('the example gallery showcases every node type', () => {
		// Drive coverage off the manifest's `showcases`/`kind` metadata (the same
		// fields the modal search uses). DataView is a viewer wired to a source
		// plot, not a standalone session, so it is exempt.
		const idx = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8'));
		const showcasedBy = (kind) =>
			new Set(idx.sessions.filter((s) => s.kind === kind).flatMap((s) => s.showcases ?? []));

		const plots = showcasedBy('plot');
		for (const type of [...appConsts.plotMap.keys()].filter((k) => k !== 'dataview')) {
			expect(plots.has(type), `gallery showcases plot ${type}`).toBe(true);
		}
		expect(showcasedBy('process')).toEqual(new Set([...appConsts.processMap.keys()]));
		expect(showcasedBy('tableProcess')).toEqual(new Set([...appConsts.tableProcessMap.keys()]));
	});

	for (const file of demoFiles) {
		it(`${file} loads, has data + plots, and plots reference finite data`, () => {
			const jsonData = JSON.parse(readFileSync(join(DIR, file), 'utf8'));

			// Top-level shape
			expect(Array.isArray(jsonData.data)).toBe(true);
			expect(jsonData.rawData && typeof jsonData.rawData === 'object').toBe(true);

			// Reconstruct exactly like the loader does — must not throw.
			expect(() => loadSession(jsonData)).not.toThrow();

			expect(core.data.length).toBe(jsonData.data.length);
			expect(core.data.length).toBeGreaterThan(0);
			expect(core.plots.length).toBe((jsonData.plots ?? []).length);
			expect(core.plots.length).toBeGreaterThan(0);

			// Table-process OUTPUT columns are computed at runtime when the TP node
			// mounts on load, so they are legitimately empty in the serialized file;
			// exclude them from the finite check (source columns must still resolve).
			const tpOutIds = new Set();
			for (const tp of jsonData.tableProcesses ?? []) {
				for (const v of Object.values(tp.args?.out ?? {})) {
					if (typeof v === 'number' && v >= 0) tpOutIds.add(v);
				}
			}

			// Every base (source) data column resolves to a non-empty array. Numeric
			// and time columns must carry finite values; category columns hold
			// (non-empty) string labels.
			for (const col of core.data) {
				if (tpOutIds.has(col.id)) continue;
				const d = col.getData();
				expect(Array.isArray(d)).toBe(true);
				expect(d.length).toBeGreaterThan(0);
				if (col.type === 'category') {
					expect(d.some((v) => v != null && v !== '')).toBe(true);
				} else {
					expect(d.some((v) => Number.isFinite(v))).toBe(true);
				}
			}

			// Every plot wrapper column points at a real base column (refId present
			// in core.data) and its getData() yields a non-empty array.
			for (const plot of core.plots) {
				for (const series of plot.plot?.data ?? []) {
					for (const f of ['x', 'y', 'column']) {
						const w = series?.[f];
						if (w && typeof w === 'object' && 'refId' in w && w.refId >= 0) {
							expect(
								core.data.some((c) => c.id === w.refId),
								`${file}: plot wrapper ${f} refId ${w.refId} exists in data`
							).toBe(true);
							expect(Array.isArray(w.getData?.() ?? null)).toBe(true);
						}
					}
				}
			}
		});
	}
});
