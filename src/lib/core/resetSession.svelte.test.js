// @ts-nocheck
// resetSession: the ONE way the app empties the open session (the session load, the sample-data
// seeder and "New session" all call it). The reset used to be open-coded in importJson's
// preamble, so a second copy would drift the first time a slice was added, and the symptom is a
// "new" session that quietly keeps part of the old one.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, freshCoreState } from './core.svelte.js';
import { resetSession } from './sessionLoad.svelte.js';
import { nodeMemo, _memoSize } from './computeMemo.js';
import { transitionalFigureStyle } from '$lib/plots/figureStyle.js';

/** Put something in every slice, so an unreset slice cannot pass by being empty already. */
function dirtyEverySlice() {
	core.rawData = new Map([[1, [1, 2, 3]]]);
	core.data = [{ id: 1 }];
	core.plots = [{ id: 1 }];
	core.tableProcesses = [{ id: 1 }];
	core.storedValues = { mesor: { source: 'x', staticValue: 3 } };
	core.chainRefs = [{ toId: 1 }];
	core.nodeNotes = { note_1: 'hello' };
	core.notes = [{ id: 'note_1' }];
	core.groups = [{ id: 'group_1' }];
	core.composites = [{ id: 'composite_1' }];
	core.orphanProcesses = [{ id: 1 }];
	core.categoryColours = { control: { hex: '#000000' } };
	core.seriesAppearance = { 1: { colour: { hex: '#ff0000' } } };
	core.plotColormaps = { 1: 'viridis' };
	core.figureStyle = { ...core.figureStyle, basePt: 99, monochrome: true };
	core.activeStyleName = 'Journal';
	core.nodeLayout = { data_1: { x: 1, y: 2 } };
	core.generatedBy = { source: 'ai', sessionId: 'abc' };
	core.unrestoredPlots = [{ type: 'mystery' }];
}

beforeEach(() => {
	resetSession();
});

describe('resetSession', () => {
	it('returns every core slice to its fresh value', () => {
		dirtyEverySlice();
		resetSession();
		const fresh = freshCoreState();
		// Every declared slice, compared to a fresh session. rawData is a Map, which toEqual
		// compares by entries.
		for (const key of Object.keys(fresh)) {
			expect(core[key], `core.${key} was not reset`).toEqual(fresh[key]);
		}
		expect(core.rawData).toBeInstanceOf(Map);
		expect(core.rawData.size).toBe(0);
		expect(core.figureStyle).toEqual(transitionalFigureStyle());
		expect(core.generatedBy).toBeNull();
		expect(core.activeStyleName).toBeNull();
	});

	it('leaves no slice the reset does not know about (e.g. unrestoredPlots)', () => {
		dirtyEverySlice();
		resetSession();
		expect(Object.keys(core).sort()).toEqual(Object.keys(freshCoreState()).sort());
	});

	it('every collection slice is empty afterwards', () => {
		dirtyEverySlice();
		resetSession();
		for (const key of [
			'data',
			'plots',
			'tableProcesses',
			'chainRefs',
			'notes',
			'groups',
			'composites',
			'orphanProcesses'
		]) {
			expect(core[key], key).toEqual([]);
		}
		for (const key of [
			'storedValues',
			'nodeNotes',
			'categoryColours',
			'seriesAppearance',
			'plotColormaps',
			'nodeLayout'
		]) {
			expect(core[key], key).toEqual({});
		}
	});

	it('clears the compute memo (node ids are reused, so a cached result would be served to an unrelated node)', () => {
		const m = nodeMemo({ id: 7, name: 'Cosinor' }, 'tableprocess');
		m.hash = 'h1';
		m.payload = { mesor: 1 };
		expect(_memoSize()).toBeGreaterThan(0);
		resetSession();
		expect(_memoSize()).toBe(0);
	});

	it('hands out fresh objects, so the next session cannot share state with the last', () => {
		resetSession();
		const before = core.data;
		core.data.push({ id: 1 });
		resetSession();
		expect(core.data).not.toBe(before);
		expect(core.data).toEqual([]);
	});
});
