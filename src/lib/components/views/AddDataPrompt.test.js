import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';

// The prompt only routes: import goes through the dataSourceActions seam, so stub that and
// assert the route taken. The load-session modal it owns renders for real (closed).
const openImportData = vi.fn();
vi.mock('$lib/core/dataSourceActions.js', () => ({
	openImportData: (...a) => openImportData(...a)
}));

import AddDataPrompt from './AddDataPrompt.svelte';
import { appState } from '$lib/core/core.svelte.js';

// jsdom has no Web Animations API; Modal's open transition calls element.animate().
Element.prototype.animate ??= () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });

afterEach(() => cleanup());
beforeEach(() => {
	vi.clearAllMocks();
	appState.spawnNodeRequest = null;
});

const openMenu = async () => {
	await fireEvent.click(screen.getByRole('button', { name: /click here to add data/i }));
	return screen.getAllByRole('menuitem');
};

describe('AddDataPrompt', () => {
	it('offers import, simulate and example, and nothing until the call to action is pressed', async () => {
		render(AddDataPrompt);
		expect(screen.queryByRole('menu')).toBeNull();
		const items = await openMenu();
		expect(items.map((b) => b.querySelector('.add-data-choice-title').textContent)).toEqual([
			'Import a file',
			'Simulate data',
			'Load an example'
		]);
	});

	it('routes "Import a file" to the shared import modal and closes the menu', async () => {
		render(AddDataPrompt);
		const [importItem] = await openMenu();
		await fireEvent.click(importItem);
		expect(openImportData).toHaveBeenCalledOnce();
		expect(screen.queryByRole('menu')).toBeNull();
	});

	it('spawns the node in place when the host supplies onSimulate (the canvas)', async () => {
		const onSimulate = vi.fn();
		render(AddDataPrompt, { onSimulate });
		const [, simulate] = await openMenu();
		await fireEvent.click(simulate);
		expect(onSimulate).toHaveBeenCalledOnce();
		expect(appState.spawnNodeRequest).toBeNull();
	});

	it('without onSimulate (the workspace), hops to the canvas and requests the node there', async () => {
		appState.view = 'worksheet';
		render(AddDataPrompt);
		const [, simulate] = await openMenu();
		await fireEvent.click(simulate);
		expect(appState.view).toBe('canvas');
		expect(appState.spawnNodeRequest?.tpType).toBe('SimulatedData');
	});
});
