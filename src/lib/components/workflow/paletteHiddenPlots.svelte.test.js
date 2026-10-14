// @ts-nocheck
// Plots that nodeMeta marks `hideFromPalette` stay out of BOTH add-node palettes, while
// ordinary plots stay in. The flag used to be honoured for analysis nodes only. No shipped plot
// uses it since Data View was removed (v82.0), so the test injects a hidden entry to keep both
// palette loops guarded; and searching for the old name finds Table, which absorbed it.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import NodePalette from './NodePalette.svelte';
import WorksheetAddPalette from '$lib/components/views/WorksheetAddPalette.svelte';
import { appConsts } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';

const HIDDEN = 'zzhiddenplot';

beforeAll(async () => {
	appConsts.plotMap = new Map(await loadPlots());
	appConsts.plotMap.set(HIDDEN, {
		...appConsts.plotMap.get('tableplot'),
		displayName: 'Hidden Test Plot',
		hideFromPalette: true
	});
}, 120000);
afterAll(() => appConsts.plotMap.delete(HIDDEN));
afterEach(() => cleanup());

const settle = async () => {
	flushSync();
	await tick();
};

const worksheetNames = (container) =>
	[...container.querySelectorAll('.palette-tile-name')].map((n) => n.textContent.trim());

describe('plots flagged hideFromPalette', () => {
	it('no registered plot is hidden any more, and Data View is gone', () => {
		const hidden = [...appConsts.plotMap].filter(([k, e]) => k !== HIDDEN && e.hideFromPalette);
		expect(hidden).toEqual([]);
		expect(appConsts.plotMap.has('dataview')).toBe(false);
	});

	it('NodePalette lists Table plot but not the hidden plot', async () => {
		const { getByTestId, queryByTestId } = render(NodePalette, { props: {} });
		await fireEvent.click(getByTestId('palette-trigger'));
		await settle();
		expect(queryByTestId('palette-item-tableplot')).toBeTruthy();
		expect(queryByTestId(`palette-item-${HIDDEN}`)).toBeNull();
	});

	it('WorksheetAddPalette lists Table plot but not the hidden plot', async () => {
		const { container } = render(WorksheetAddPalette, { props: { open: true } });
		await settle();
		expect(worksheetNames(container)).toContain('Table');
		expect(worksheetNames(container)).not.toContain('Hidden Test Plot');
	});
});

describe('searching for "data view" finds Table', () => {
	it('in NodePalette', async () => {
		const { getByTestId, queryByTestId, container } = render(NodePalette, { props: {} });
		await fireEvent.click(getByTestId('palette-trigger'));
		await settle();
		await fireEvent.input(container.querySelector('.palette-search'), {
			target: { value: 'data view' }
		});
		await settle();
		expect(queryByTestId('palette-item-tableplot')).toBeTruthy();
		expect(queryByTestId('palette-item-scatterplot')).toBeNull();
	});

	it('in WorksheetAddPalette', async () => {
		const { container } = render(WorksheetAddPalette, { props: { open: true } });
		await settle();
		await fireEvent.input(container.querySelector('.palette-search'), {
			target: { value: 'data view' }
		});
		await settle();
		expect(worksheetNames(container)).toEqual(['Table']);
	});
});
