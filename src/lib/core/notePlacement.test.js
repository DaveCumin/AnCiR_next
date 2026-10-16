// @ts-nocheck
// UI-7: a note never covers a plot on the workspace.
//
// Every worked example ships an explanatory note at the top-left and its plots were packed from
// the same corner, so the note opened on top of the first plot. Notes now get a lane above the
// plots when a session loads, and a new note moves to the nearest free spot. The geometry is pure
// (workspaceLayout.js); this file drives it through the real loader (importJson) for every
// shipped demo and classroom session, and through createNote for new notes.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { core, appConsts, appState, createNote } from '$lib/core/core.svelte.js';
import { importJson } from '$lib/components/iconActions/Setting.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { renderables } from '$lib/core/plotRefs.js';
import {
	plotCardBox,
	noteCardBox,
	boxesOverlap,
	noteLaneLayout,
	freeNoteSpot,
	NOTE_GAP
} from '$lib/core/workspaceLayout.js';
import { loadProcesses } from '$test/processRegistry.js';
import { loadPlots } from '$test/plotRegistry.js';
import { loadTableProcesses } from '$test/tableProcessRegistry.js';

const ROOT = join(process.cwd(), 'static', 'sessions');
const sessionFiles = ['demos', 'classroom'].flatMap((dir) =>
	readdirSync(join(ROOT, dir))
		.filter((f) => f.endsWith('.json') && f !== 'index.json' && !f.includes('conflicted'))
		.map((f) => join(dir, f))
);

const box = (id, x, y, w, h) => ({ id, x, y, w, h });

describe('noteLaneLayout (pure)', () => {
	it('moves nothing when no note covers a plot', () => {
		const out = noteLaneLayout({
			notes: [box('n', 600, 0, 200, 100)],
			plots: [box(1, 0, 0, 500, 300)]
		});
		expect(out.dy).toBe(0);
		expect(out.notes.size).toBe(0);
	});

	it('the demo shape: a top-left note over the first plot gets the lane, plots move below it', () => {
		const note = box('n', 40, 24, 360, 190);
		const plots = [box(1, 60, 60, 540, 360), box(2, 630, 60, 540, 300)];
		const { dy, notes } = noteLaneLayout({ notes: [note], plots, grid: 15 });
		const placed = { ...note, ...notes.get('n') };
		expect(placed).toMatchObject({ x: 40, y: 24 });
		const moved = plots.map((p) => ({ ...p, y: p.y + dy }));
		for (const p of moved) {
			expect(boxesOverlap(placed, p)).toBe(false);
			expect(p.y).toBeGreaterThanOrEqual(placed.y + placed.h + NOTE_GAP);
		}
		expect(dy % 15).toBe(0);
	});

	it('several covering notes share the lane without covering each other; a clear note moves with the plots', () => {
		const notes = [
			box('a', 0, 0, 300, 150),
			box('b', 100, 100, 300, 200),
			box('c', 900, 400, 200, 100)
		];
		const plots = [box(1, 50, 50, 500, 300), box(2, 50, 400, 800, 300)];
		const { dy, notes: m } = noteLaneLayout({ notes, plots, grid: 15 });
		const after = notes.map((n) => ({ ...n, ...(m.get(n.id) ?? {}) }));
		const plotsAfter = plots.map((p) => ({ ...p, y: p.y + dy }));
		for (const n of after) for (const p of plotsAfter) expect(boxesOverlap(n, p)).toBe(false);
		expect(boxesOverlap(after[0], after[1])).toBe(false);
		// 'c' sat clear beside plot 2; it keeps its place relative to it.
		expect(after[2].y - plotsAfter[1].y).toBe(notes[2].y - plots[1].y);
	});
});

describe('freeNoteSpot (pure)', () => {
	it('keeps the wanted spot when it is free', () => {
		expect(freeNoteSpot(box('n', 700, 0, 200, 120), [box(1, 0, 0, 500, 300)])).toEqual({
			x: 700,
			y: 0
		});
	});

	it('moves off a plot to the nearest free spot beside it', () => {
		const plots = [box(1, 0, 0, 500, 300), box(2, 530, 0, 500, 300)];
		const spot = freeNoteSpot(box('n', 80, 80, 200, 120), plots, { grid: 15 });
		const placed = box('n', spot.x, spot.y, 200, 120);
		for (const p of plots) expect(boxesOverlap(placed, p)).toBe(false);
		// Nearest is just above or below the first plot, not off past the second one.
		expect(Math.abs(spot.x - 80)).toBeLessThanOrEqual(15);
	});
});

describe('every shipped session opens with no note over a plot (Workspace view)', () => {
	beforeAll(async () => {
		appConsts.processMap = await loadProcesses();
		appConsts.plotMap = await loadPlots();
		appConsts.tableProcessMap = await loadTableProcesses();
		history.init();
	});

	const overlapsAfterLoad = () => {
		const grid = appState.gridSize ?? 15;
		const plots = renderables().map((p) => plotCardBox(p, grid));
		const hits = [];
		for (const n of core.notes)
			for (const p of plots)
				if (boxesOverlap(noteCardBox(n), p)) hits.push(`${n.id} covers plot ${p.id}`);
		return hits;
	};

	const savedPlotBoxes = (json) => {
		const grid = appState.gridSize ?? 15;
		return (json.plots ?? []).filter((p) => !p.facet).map((p) => plotCardBox(p, grid));
	};

	// Plain cases: every shipped file, as shipped, opens with no note over a plot.
	it.each(sessionFiles)(
		'%s',
		async (file) => {
			const json = JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
			await importJson(json);
			expect(overlapsAfterLoad()).toEqual([]);
		},
		60_000
	);

	// As saved, before any load-time move: the demo and classroom generators give their notes
	// the lane themselves, so a shipped file never relies on the loader to fix it (and opens
	// unchanged, with no layout shift, wherever it is read).
	it.each(sessionFiles)('%s is saved with no note over a plot', (file) => {
		const json = JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
		const plots = savedPlotBoxes(json);
		const hits = [];
		for (const n of json.notes ?? [])
			for (const p of plots)
				if (boxesOverlap(noteCardBox(n), p)) hits.push(`${n.id} covers plot ${p.id}`);
		expect(hits).toEqual([]);
	});

	// Injected cases: the shipped files may already be clean (the demo generator lays notes out
	// clear of plots), so they alone cannot prove the load-time fix runs. For every session with
	// a note and a plot, move the first note onto the first plot in the saved JSON (the same
	// x/y/width/height fields the loader reads), then load it.
	const injectable = sessionFiles.filter((file) => {
		const json = JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
		return (json.notes ?? []).length > 0 && savedPlotBoxes(json).length > 0;
	});
	const injected = [];

	it.each(injectable)(
		'%s with its first note moved onto its first plot',
		async (file) => {
			const json = JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
			const note = json.notes[0];
			const target = savedPlotBoxes(json)[0];
			note.x = target.x + 20;
			note.y = target.y + 20;
			const overlappedBeforeLoad = boxesOverlap(noteCardBox(note), target);
			injected.push({ file, overlappedBeforeLoad });

			const savedXY = new Map((json.plots ?? []).map((p) => [p.id, [p.x ?? 0, p.y ?? 0]]));
			await importJson(json);
			expect(overlapsAfterLoad()).toEqual([]);

			// The fix shifts every plot by one rigid offset, so their arrangement is unchanged.
			const offsets = core.plots
				.filter((p) => savedXY.has(p.id))
				.map((p) => {
					const [x, y] = savedXY.get(p.id);
					return [(p.x ?? 0) - x, (p.y ?? 0) - y];
				});
			expect(offsets.length).toBe(savedXY.size);
			for (const o of offsets) expect(o).toEqual(offsets[0]);
		},
		60_000
	);

	it('every injected variant really put a note on a plot before load (so the cases above test the fix)', () => {
		expect(injected.length).toBe(injectable.length);
		expect(injected.length).toBeGreaterThanOrEqual(20);
		expect(injected.filter((v) => !v.overlappedBeforeLoad).map((v) => v.file)).toEqual([]);
	});

	it('a session with no overlap opens exactly as saved', async () => {
		const json = JSON.parse(readFileSync(join(ROOT, 'demos', 'demo-tp-cosinor.json'), 'utf8'));
		json.notes[0].x = 2000; // well clear of every plot
		const before = (json.plots ?? []).map((p) => [p.id, p.x, p.y]);
		await importJson(json);
		expect(core.plots.map((p) => [p.id, p.x, p.y])).toEqual(before);
		expect([core.notes[0].x, core.notes[0].y]).toEqual([2000, json.notes[0].y]);
	});

	it('a new note never lands on a plot or another note', async () => {
		const json = JSON.parse(readFileSync(join(ROOT, 'demos', 'demo-tp-cosinor.json'), 'utf8'));
		await importJson(json);
		const first = core.plots[0];
		// Ask for a spot squarely on the first plot.
		createNote({ x: first.x + 20, y: first.y + 20 });
		createNote({ x: first.x + 20, y: first.y + 20 });
		expect(overlapsAfterLoad()).toEqual([]);
		const [a, b] = core.notes.slice(-2).map(noteCardBox);
		expect(boxesOverlap(a, b)).toBe(false);
	});
});
