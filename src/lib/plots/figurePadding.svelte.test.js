// @ts-nocheck
// Padding belongs to the FIGURE. While a workflow node draws the plot (renderBox set),
// `plot.padding` reads back a SCALED copy (a $derived) so the smaller view keeps room for its
// smaller type. The Padding controls used to bind to that copy: an edit made while the node
// was on screen changed the derived object, was never stored or saved, and vanished on the
// next recompute (Svelte also warned binding_property_non_reactive). The controls now edit
// `figurePadding`, the stored value.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { core } from '$lib/core/core.svelte.js';
import Scatterplot, { Scatterplotclass } from './Scatterplot/Scatterplot.svelte';
import FFT, { FFTclass } from './FFT/FFT.svelte';

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
});
afterEach(() => cleanup());

function topField(container) {
	const label = [...container.querySelectorAll('label.control-input')].find(
		(l) => l.querySelector('.ci-label')?.textContent.trim() === 'Top'
	);
	return label?.querySelector('input');
}

describe.each([
	['Scatterplot', Scatterplot, Scatterplotclass, 'scatterplot'],
	['FFT', FFT, FFTclass, 'fft']
])('%s Padding controls while a node view is mounted', (_name, Comp, Cls, type) => {
	it('an edit lands in the stored figure padding', () => {
		const wrapper = { id: 1, type, name: 'p', width: 600, height: 400, plot: null };
		const s = new Cls(wrapper, null);
		wrapper.plot = s;
		s.parentBox = { id: 1, width: 600, height: 400 };
		s.padding = { top: 15, right: 30, bottom: 30, left: 50 };
		s.renderBox = { w: 240, h: 200 };
		const { container } = render(Comp, { props: { theData: s, which: 'controls' } });
		const input = topField(container);
		expect(input).toBeTruthy();
		// The panel shows the figure's value, not the node's scaled one.
		expect(Number(input.value)).toBe(15);
		// A node view cannot measure automatic padding (autoScalePadding refuses there), so
		// it offers no reset that would do nothing.
		expect(container.querySelector('[aria-label="Reset all padding to automatic"]')).toBeNull();
		input.value = '40';
		fireEvent.input(input);
		flushSync();
		expect(s.toJSON().padding.top).toBe(40);
		// Clearing the node view shows the edited figure padding.
		s.renderBox = null;
		expect(s.padding.top).toBe(40);
	});

	it('a path write to plot.padding (shared panel, AI edit, facet) lands in the figure', () => {
		// setByPath(plot, 'padding.top', v) reads `padding` (the scaled view while a node is
		// mounted) and assigns into it; the view writes through to the stored value.
		const wrapper = { id: 1, type, name: 'p', width: 600, height: 400, plot: null };
		const s = new Cls(wrapper, null);
		s.parentBox = { id: 1, width: 600, height: 400 };
		s.padding = { top: 15, right: 30, bottom: 30, left: 50 };
		s.renderBox = { w: 240, h: 200 };
		s.padding.top = 44;
		expect(s.toJSON().padding.top).toBe(44);
		// ...and the node keeps drawing it scaled.
		expect(s.padding.top).toBeLessThan(44);
	});
});
