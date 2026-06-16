/**
 * Guard test: every classroom lesson in static/sessions/classroom/ must load
 * through the same reconstruction the app uses (rawData + Column.fromJSON +
 * Plot.fromJSON), carry its "For teachers" note, and reference finite data. This
 * keeps the shipped lessons (and the tours that load them) from silently rotting
 * if the session format changes.
 *
 * (Regenerate the lessons with:
 *   GEN_CLASSROOM=1 npx vitest run src/lib/_classroom/generateClassroom.svelte.test.js)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';

const DIR = join(process.cwd(), 'static', 'sessions', 'classroom');

function loadSession(jsonData) {
	// Mirrors the essential reconstruction in Setting.svelte's importJson.
	core.data = [];
	core.plots = [];
	core.tableProcesses = [];
	core.groups = [];
	core.notes = [];
	core.rawData = new Map(Object.entries(jsonData.rawData ?? {}).map(([k, v]) => [+k, v]));
	for (const cd of jsonData.data ?? []) pushObj(Column.fromJSON(cd));
	for (const pj of jsonData.plots ?? []) pushObj(Plot.fromJSON(pj), false);
	core.notes = [...(jsonData.notes ?? [])];
}

beforeAll(async () => {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();
});

describe('classroom lessons load + render-safe', () => {
	it('index.json manifest is well-formed and points at existing files', () => {
		const idxPath = join(DIR, 'index.json');
		expect(existsSync(idxPath)).toBe(true);
		const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
		expect(Array.isArray(idx.sessions)).toBe(true);
		expect(idx.sessions.length).toBeGreaterThan(0);
		expect(idx.count).toBe(idx.sessions.length);
		for (const s of idx.sessions) {
			expect(s.id && s.name && s.family && s.url).toBeTruthy();
			// Classroom-specific metadata the tours/handbook rely on.
			expect(s.yearLevel, `${s.id} has a yearLevel`).toBeTruthy();
			expect(Array.isArray(s.curriculum) && s.curriculum.length > 0, `${s.id} has curriculum`).toBe(
				true
			);
			for (const c of s.curriculum) {
				expect(c.framework && c.code && c.title && c.confidence).toBeTruthy();
			}
			const file = s.url.split('/').pop();
			expect(existsSync(join(DIR, file)), `${file} referenced by manifest exists`).toBe(true);
		}
	});

	const lessonFiles = existsSync(DIR)
		? readdirSync(DIR).filter((f) => f.startsWith('learn-') && f.endsWith('.json'))
		: [];

	it('has the expected four lessons', () => {
		expect(lessonFiles.length).toBe(4);
	});

	for (const file of lessonFiles) {
		it(`${file} loads, carries a teacher note, and references finite data`, () => {
			const jsonData = JSON.parse(readFileSync(join(DIR, file), 'utf8'));

			// Top-level shape
			expect(Array.isArray(jsonData.data)).toBe(true);
			expect(jsonData.rawData && typeof jsonData.rawData === 'object').toBe(true);

			// Every lesson ships exactly one "For teachers" note carrying curriculum.
			expect(Array.isArray(jsonData.notes)).toBe(true);
			expect(jsonData.notes.length).toBeGreaterThan(0);
			expect(jsonData.notes[0].text && jsonData.notes[0].text.length > 40).toBeTruthy();

			// Reconstruct exactly like the loader does — must not throw.
			expect(() => loadSession(jsonData)).not.toThrow();

			expect(core.data.length).toBe(jsonData.data.length);
			expect(core.data.length).toBeGreaterThan(0);
			expect(core.plots.length).toBe((jsonData.plots ?? []).length);
			expect(core.plots.length).toBeGreaterThan(0);

			// Table-process OUTPUT columns are computed at runtime when the TP node
			// mounts on load, so they are legitimately empty in the serialized file.
			const tpOutIds = new Set();
			for (const tp of jsonData.tableProcesses ?? []) {
				for (const v of Object.values(tp.args?.out ?? {})) {
					if (typeof v === 'number' && v >= 0) tpOutIds.add(v);
				}
			}

			// Every base (source) data column resolves to a non-empty array. Numeric
			// and time columns carry finite values; category columns hold labels.
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

			// Every plot wrapper column points at a real base column and yields an array.
			for (const plot of core.plots) {
				for (const series of plot.plot?.data ?? []) {
					for (const f of ['x', 'y', 'column', 'time', 'values']) {
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
