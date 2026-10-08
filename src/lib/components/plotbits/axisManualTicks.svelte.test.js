// @ts-nocheck
// Manual axis ticks (requested 2026-10-05). The axis panel offers Auto (d3 picks about
// `nticks` ticks) or Manual (the user types the values). Entries that are not numbers are
// ignored with an inline message; values outside the axis domain are not drawn. The setting
// is saved with the axis (AxisClass.toJSON / fromJSON / withDefaults).
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { scaleLinear, scaleUtc } from 'd3-scale';
import Axis, { AxisClass } from '$lib/components/plotbits/Axis.svelte';

afterEach(() => cleanup());

const PAD = { top: 10, right: 10, bottom: 30, left: 40 };

function mountPlot(axisData, props = {}) {
	return render(Axis, {
		props: {
			which: 'plot',
			axisData,
			position: 'bottom',
			scale: scaleLinear().domain([0, 24]).range([0, 240]),
			width: 240,
			height: 100,
			plotPadding: PAD,
			...props
		}
	});
}

function mountControls(axisData, props = {}) {
	return render(Axis, { props: { which: 'controls', axisData, title: 'X-Axis', ...props } });
}

const tickValues = (container) =>
	[...container.querySelectorAll('g[class^="axis-"] .tick')].map((t) => t.__data__);

const modeSelect = (c) => c.querySelector('select[aria-label="Tick placement"]');
const tickBox = (c) => c.querySelector('input[aria-label="Tick values"]');

function type(input, text) {
	input.value = text;
	fireEvent.input(input);
	flushSync();
}

describe('Manual axis ticks: drawing', () => {
	it('draws exactly the manual ticks, and redraws them in place when they change', () => {
		const axisData = new AxisClass({ nticks: 5 });
		const { container } = mountPlot(axisData);
		const g = container.querySelector('g.axis-bottom');
		const auto = tickValues(container);
		expect(auto.length).toBeGreaterThan(0);

		axisData.manualTicks = [0, 6, 12, 18, 24];
		flushSync();
		expect(container.querySelector('g.axis-bottom')).toBe(g);
		expect(tickValues(container)).toEqual([0, 6, 12, 18, 24]);

		axisData.manualTicks = [3, 9];
		flushSync();
		expect(tickValues(container)).toEqual([3, 9]);
	});

	it('does not draw manual ticks outside the axis domain', () => {
		const axisData = new AxisClass({ manualTicks: [-6, 0, 12, 24, 36] });
		const { container } = mountPlot(axisData);
		expect(tickValues(container)).toEqual([0, 12, 24]);
	});

	it('a time scale ignores a stored manual list and draws its automatic ticks', () => {
		const axisData = new AxisClass({ nticks: 5, manualTicks: [0, 6, 12] });
		const scale = scaleUtc()
			.domain([new Date('2026-01-01T00:00Z'), new Date('2026-01-02T00:00Z')])
			.range([0, 240]);
		const { container } = mountPlot(axisData, { scale });
		const ticks = tickValues(container);
		expect(ticks.length).toBeGreaterThan(0);
		expect(ticks.every((t) => t instanceof Date)).toBe(true);
	});

	it('a categorical axis ignores a stored manual list, and draws it again once numeric', async () => {
		// The list is kept (not cleared) so a plot whose x goes categorical and back gets the
		// user's ticks back; the categorical panel has no control to clear it with.
		const axisData = new AxisClass({ nticks: 5, manualTicks: [3, 9] });
		const ref = mountPlot(new AxisClass({ nticks: 5 })).container;
		const auto = tickValues(ref);
		cleanup();
		const { container, rerender } = mountPlot(axisData, { tickMode: 'categorical' });
		expect(tickValues(container)).toEqual(auto);
		expect(axisData.manualTicks).toEqual([3, 9]);

		await rerender({ tickMode: 'numeric' });
		expect(tickValues(container)).toEqual([3, 9]);
	});

	it('a time tickMode ignores a stored manual list even on a numeric scale', () => {
		const axisData = new AxisClass({ nticks: 5, manualTicks: [3, 9] });
		const { container } = mountPlot(axisData, { tickMode: 'time' });
		expect(tickValues(container)).not.toEqual([3, 9]);
	});

	it('an empty manual list draws the automatic ticks', () => {
		const axisData = new AxisClass({ nticks: 5, manualTicks: [] });
		const { container } = mountPlot(axisData);
		const auto = new AxisClass({ nticks: 5 });
		const ref = mountPlot(auto).container;
		expect(tickValues(container)).toEqual(tickValues(ref));
		expect(tickValues(container).length).toBeGreaterThan(0);
	});
});

describe('Manual axis ticks: controls', () => {
	it('entering values in Manual mode stores exactly those ticks', () => {
		const axisData = new AxisClass({});
		const { container } = mountControls(axisData);
		const select = modeSelect(container);
		expect(select.value).toBe('auto');
		expect(tickBox(container)).toBeNull();

		select.value = 'manual';
		fireEvent.change(select);
		flushSync();
		type(tickBox(container), '0, 6, 12, 18, 24');
		expect(axisData.manualTicks).toEqual([0, 6, 12, 18, 24]);
		expect(container.querySelector('.axis-ticks-message')).toBeNull();

		type(tickBox(container), '0 6 12');
		expect(axisData.manualTicks).toEqual([0, 6, 12]);
	});

	it('ignores entries that are not numbers, with an inline message', () => {
		const axisData = new AxisClass({ manualTicks: [] });
		const { container } = mountControls(axisData);
		type(tickBox(container), '0, six, 12');
		expect(axisData.manualTicks).toEqual([0, 12]);
		const msg = container.querySelector('.axis-ticks-message');
		expect(msg).not.toBeNull();
		expect(msg.textContent).toContain('six');

		type(tickBox(container), '0, 12');
		expect(container.querySelector('.axis-ticks-message')).toBeNull();
	});

	it('switching back to Auto restores the automatic ticks', () => {
		const axisData = new AxisClass({ nticks: 5, manualTicks: [0, 6] });
		const controls = mountControls(axisData).container;
		const plot = mountPlot(axisData).container;
		expect(tickValues(plot)).toEqual([0, 6]);

		const select = modeSelect(controls);
		expect(select.value).toBe('manual');
		select.value = 'auto';
		fireEvent.change(select);
		flushSync();
		expect(axisData.manualTicks).toBeNull();
		expect(tickBox(controls)).toBeNull();
		expect(tickValues(plot)).toEqual(scaleLinear().domain([0, 24]).ticks(5));

		// ...and Manual again brings the typed values back.
		select.value = 'manual';
		fireEvent.change(select);
		flushSync();
		expect(tickBox(controls).value).toBe('0, 6');
		expect(axisData.manualTicks).toEqual([0, 6]);
	});

	it('a change made elsewhere (undo, load) shows in the box', () => {
		const axisData = new AxisClass({ manualTicks: [1, 2] });
		const { container } = mountControls(axisData);
		expect(tickBox(container).value).toBe('1, 2');
		axisData.manualTicks = [5, 10];
		flushSync();
		expect(tickBox(container).value).toBe('5, 10');
	});

	it('a time axis keeps Auto: the control is disabled with a note', () => {
		const axisData = new AxisClass({});
		const { container } = mountControls(axisData, { tickMode: 'time' });
		const select = modeSelect(container);
		expect(select.disabled).toBe(true);
		expect(select.title).toMatch(/time axis/i);
		expect(container.textContent).toMatch(/not available on a time axis/i);
	});

	it('a categorical axis shows no tick placement control', () => {
		const axisData = new AxisClass({});
		const { container } = mountControls(axisData, { tickMode: 'categorical' });
		expect(modeSelect(container)).toBeNull();
		expect(tickBox(container)).toBeNull();
	});
});

describe('Manual axis ticks: save and load', () => {
	it('round-trips through toJSON / fromJSON', () => {
		const a = new AxisClass({ manualTicks: [0, 6, 12] });
		const b = AxisClass.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
		expect(b.manualTicks).toEqual([0, 6, 12]);
		expect(AxisClass.fromJSON({}).manualTicks).toBeNull();
	});

	it('survives the per-plot constructor path (withDefaults)', () => {
		const a = new AxisClass({ manualTicks: [0, 6, 12] });
		const b = AxisClass.withDefaults(JSON.parse(JSON.stringify(a.toJSON())), { label: 'x' });
		expect(b.manualTicks).toEqual([0, 6, 12]);
		expect(AxisClass.withDefaults(undefined).manualTicks).toBeNull();
	});
});
