// @ts-nocheck
// UI-17: a Columns Table made every cell editable, including a node's output. The edit was
// stored as an Edit value process on that output, which then overrode the same row POSITION
// through every recompute and reached every plot downstream. A node's output is read-only now
// (no editor, not focusable, a reason on the header); an imported column stays editable.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Plot } from '$lib/core/Plot.svelte';
import { loadPlots } from '$test/plotRegistry.js';
import Tableplot from './Tableplot.svelte';

appConsts.plotMap = await loadPlots();

function mkCol(values, name) {
	const c = new Column({ type: 'number', data: -1, name });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c;
}

let raw, out;
beforeEach(() => {
	core.data = [];
	core.plots.length = 0;
	raw = mkCol([1, 2, 3], 'y');
	out = mkCol([10, 20, 30], 'binned');
	core.tableProcesses = [
		{ id: 5, name: 'BinnedData', displayName: 'Bin Data', args: { out: { binnedy: out.id } } }
	];
});
afterEach(() => cleanup());

const mount = () => {
	const t = new Plot({
		type: 'tableplot',
		name: 'T',
		plot: { columnRefs: [raw.id, out.id], showCol: [true, true] }
	});
	const r = render(Tableplot, { props: { theData: t, which: 'plot' } });
	flushSync();
	return r;
};
const firstRowSpans = (container) => [
	...container.querySelector('.tp-tr').querySelectorAll('.tp-td .inline-edit-span')
];

describe('Columns Table: computed cells are read-only', () => {
	it('marks only the imported column as an editable control', () => {
		const { container } = mount();
		const [a, b] = firstRowSpans(container);
		expect(a.textContent.trim()).toBe('1.00');
		expect(a.getAttribute('role')).toBe('button');
		expect(a.classList.contains('editable')).toBe(true);
		expect(b.textContent.trim()).toBe('10.00');
		expect(b.getAttribute('role')).toBeNull();
		expect(b.getAttribute('tabindex')).toBeNull();
		expect(b.classList.contains('editable')).toBe(false);
	});

	it('opens no editor on a computed cell, and one on an imported cell', async () => {
		const { container } = mount();
		const [a, b] = firstRowSpans(container);
		await fireEvent.dblClick(b);
		await tick();
		await new Promise((r) => setTimeout(r, 0));
		expect(container.querySelector('.tp-td input')).toBeNull();
		await fireEvent.dblClick(a);
		await tick();
		expect(container.querySelector('.tp-td input')).not.toBeNull();
		expect(out.processes).toEqual([]);
	});

	it('says on the header why the column is read-only', () => {
		const { container } = mount();
		const titles = [...container.querySelectorAll('.tp-th')].map((h) => h.getAttribute('title'));
		expect(titles[0]).toBe('y');
		expect(titles[1]).toMatch(/Computed by Bin Data/);
	});
});
