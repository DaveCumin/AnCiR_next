// @ts-nocheck
// Plots that nodeMeta marks `hideFromPalette` (Data View: it only means something when a
// plot's "View data" action spawns it) stay out of BOTH add-node palettes, while ordinary
// plots stay in. The flag used to be honoured for analysis nodes only.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import NodePalette from './NodePalette.svelte';
import WorksheetAddPalette from '$lib/components/views/WorksheetAddPalette.svelte';
import { appConsts } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';

beforeAll(async () => {
	appConsts.plotMap = await loadPlots();
}, 120000);
afterEach(() => cleanup());

const settle = async () => {
	flushSync();
	await tick();
};

describe('plots flagged hideFromPalette', () => {
	it('the plot registry carries the flag, and Data View is still registered', () => {
		expect(appConsts.plotMap.get('dataview')?.hideFromPalette).toBe(true);
		expect(appConsts.plotMap.get('tableplot')?.hideFromPalette).toBe(false);
	});

	it('NodePalette lists Table plot but not Data View', async () => {
		const { getByTestId, queryByTestId } = render(NodePalette, { props: {} });
		await fireEvent.click(getByTestId('palette-trigger'));
		await settle();
		expect(queryByTestId('palette-item-tableplot')).toBeTruthy();
		expect(queryByTestId('palette-item-dataview')).toBeNull();
	});

	it('WorksheetAddPalette lists Table plot but not Data View', async () => {
		const { container } = render(WorksheetAddPalette, { props: { open: true } });
		await settle();
		const names = [...container.querySelectorAll('.palette-tile-name')].map((n) =>
			n.textContent.trim()
		);
		const display = (key) => appConsts.plotMap.get(key).displayName;
		expect(names).toContain(display('tableplot'));
		expect(names).not.toContain(display('dataview'));
	});
});
