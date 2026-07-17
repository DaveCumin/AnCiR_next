// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import EmbeddedPlot from './EmbeddedPlot.svelte';
import ThrowingPlot from './__fixtures__/ThrowingPlot.svelte';
import { appConsts, core } from '$lib/core/core.svelte.js';
import { notifications } from '$lib/core/notifications.svelte.js';

describe('EmbeddedPlot', () => {
	it('exports a component', () => {
		expect(EmbeddedPlot).toBeDefined();
	});
});

// A plot renders whatever columns it happens to be wired to, and a wrong pairing is an ordinary
// mistake: the AI makes one, a shared session carries one, a user drags a wire. Before the
// boundary, one such plot threw during render and unmounted the WHOLE canvas — every other node
// disappeared and the session looked lost. (Real case: a periodogram whose fromJSON left
// `periodlimsIN` undefined → "Cannot read properties of undefined (reading '0')".)
describe('a plot that throws while rendering', () => {
	beforeEach(() => {
		notifications.list.length = 0;
		core.plots.length = 0;
		vi.spyOn(console, 'error').mockImplementation(() => {});
		globalThis.fetch = () => Promise.resolve(new Response('{}'));
		appConsts.plotMap.set('throwing', { plot: ThrowingPlot, displayName: 'Throwing (test)' });
	});
	afterEach(() => {
		appConsts.plotMap.delete('throwing');
		vi.restoreAllMocks();
	});

	// `plot.plot` with no periodlimsIN — exactly the shape the fixture blows up on.
	const plot = { id: 1, type: 'throwing', name: 'boom', width: 400, height: 300, plot: {} };

	// One render for the whole story: reportError collapses repeats of the SAME error for 30s
	// (a broken render throws over and over), so a second render here would legitimately raise
	// no second toast. Asserting both outcomes from one render keeps that suppressor honest
	// instead of working around it.
	it('is contained, shown in place, and reported', () => {
		expect(() => render(EmbeddedPlot, { props: { plot, size: { w: 200, h: 150 } } })).not.toThrow();

		// Told in place, on the node that broke...
		const failed = screen.getByRole('alert');
		expect(failed.textContent).toMatch(/couldn't be drawn/);
		// ...and told what to do about it, since undo is the way back.
		expect(failed.textContent).toMatch(/undo reverses/i);
		expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();

		// A toast too, so it's noticed even if the node is scrolled off-screen.
		const toast = notifications.list.find((n) => n.type === 'error');
		expect(toast, 'an error toast was raised').toBeTruthy();
		expect(toast.message).toMatch(/was contained/);
		// Names what was being done — the whole point of passing `context`.
		expect(toast.message).toMatch(/rendering the throwing plot/);
		// Still logged for whoever opens the console.
		expect(console.error).toHaveBeenCalled();
	});
});
