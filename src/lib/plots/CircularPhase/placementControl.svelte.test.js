// @ts-nocheck
// Placement (stacked / binned / on circumference) only arranges series WITHOUT a wired time
// column; a timed series is drawn at its measured value on the radial axis. When every series
// is timed the control changed nothing, so it is disabled, and the note says why.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { core, appState } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import CircularPhase, { CircularPhaseClass } from './CircularPhase.svelte';

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
	appState.currentControlTab = 'properties';
});
afterEach(() => cleanup());

function mkCol(type, values) {
	const c = new Column({ type, data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

const t0 = Date.UTC(2026, 0, 1);
const times = [t0, t0 + 3.6e6, t0 + 7.2e6];
const timed = () => ({
	x: { refId: mkCol('time', times) },
	y: { refId: mkCol('number', [1, 2, 3]) }
});
const untimed = () => ({ y: { refId: mkCol('number', [1, 5, 9]) } });

function mount(...series) {
	const wrapper = { id: 1, type: 'circularphase', name: 'c', width: 400, height: 400, plot: null };
	const p = new CircularPhaseClass(wrapper, null);
	wrapper.plot = p;
	for (const s of series) p.addData(s);
	const r = render(CircularPhase, { props: { theData: p, which: 'controls' } });
	const select = [...r.container.querySelectorAll('label.control-input')]
		.find((l) => l.querySelector('.ci-label')?.textContent.trim() === 'Placement')
		?.querySelector('select');
	return { ...r, p, select };
}

describe('Circular phase Placement control', () => {
	it('is disabled, with a reason, when every series is timed', () => {
		const { select, container } = mount(timed(), timed());
		expect(select.disabled).toBe(true);
		expect(select.title).toMatch(/every series has a time column/i);
		expect(container.textContent).toMatch(/every series has a time column/i);
	});

	it('is enabled when at least one series is untimed', () => {
		const { select, container } = mount(timed(), untimed());
		expect(select.disabled).toBe(false);
		expect(container.textContent).toMatch(/applies to series without a wired time column/i);
		expect(container.textContent).not.toMatch(/every series has a time column/i);
	});

	it('is enabled with no series yet', () => {
		expect(mount().select.disabled).toBe(false);
	});

	it('follows the wiring: unwiring the last timed series enables it', () => {
		const { select, p } = mount(timed());
		expect(select.disabled).toBe(true);
		p.data[0].x = new Column({ refId: -1 });
		flushSync();
		expect(select.disabled).toBe(false);
	});
});
