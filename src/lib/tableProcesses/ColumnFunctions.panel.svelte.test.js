// The Column Function node PANEL (the mounted component).
//
// REPORTED (2026-10, vault TODO): under its column selector the panel printed a second list
// of the chosen columns, each with an unstyled "-" remove button and a "+" or "," between
// them. The selector already lists and removes the chosen columns, so the panel now shows
// only the selector, laid out in Input and Calculation sections like the other nodes.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';

const { mockColumns } = vi.hoisted(() => ({ mockColumns: {} }));
const freshCore = () => ({
	rawData: new Map(),
	data: [],
	groups: [],
	plots: [],
	tableProcesses: [],
	storedValues: {}
});
vi.mock('$lib/core/core.svelte', async (importOriginal) => ({
	...(await importOriginal()),
	core: freshCore()
}));
vi.mock('$lib/core/core.svelte.js', async (importOriginal) => ({
	...(await importOriginal()),
	core: freshCore()
}));
vi.mock('$lib/core/Column.svelte', async () => {
	const actual = await vi.importActual('$lib/core/Column.svelte').catch(() => ({}));
	return { ...actual, getColumnById: (id) => mockColumns[id], default: actual.default };
});

const Node = (await import('./ColumnFunctions.svelte')).default;

function mkCol(id, name, data) {
	mockColumns[id] = { id, name, type: 'number', getData: () => data, getDataHash: String(id) };
}

const mkProcess = (func = 'add') => ({
	id: 77,
	name: 'ColumnFunctions',
	warnings: [],
	args: { func, percentile: 50, xsIN: [1, 2], yIN: [], out: { result: -1 }, valid: false }
});

afterEach(() => {
	cleanup();
	for (const k of Object.keys(mockColumns)) delete mockColumns[k];
});

describe('Column Function panel', () => {
	it('lists the chosen columns once, in the selector, with no bare remove buttons', () => {
		mkCol(1, 'alpha_col', [1, 2, 3]);
		mkCol(2, 'beta_col', [10, 20, 30]);
		const { container } = render(Node, { props: { p: mkProcess() } });

		const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent.trim());
		expect(buttons).not.toContain('-');
		// Outside the selector's own dropdown, no column name is printed as a list entry.
		const loose = [...container.querySelectorAll('span')].filter((s) =>
			/^(alpha_col|beta_col)$/.test(s.textContent.trim())
		);
		expect(loose).toEqual([]);
		// The separators of the old list ("+" for Add) are gone too.
		const plus = [...container.querySelectorAll('span')].filter(
			(s) => s.textContent.trim() === '+'
		);
		expect(plus).toEqual([]);
	});

	it('groups its controls under the shared section labels', () => {
		mkCol(1, 'a', [1]);
		mkCol(2, 'b', [2]);
		const { container } = render(Node, { props: { p: mkProcess('percentile') } });
		const sections = [...container.querySelectorAll('.tableProcess-label')].map((d) =>
			d.textContent.trim()
		);
		expect(sections).toEqual(['Input', 'Calculation']);
		const labels = [...container.querySelectorAll('.ci-label, .control-input > p')].map((l) =>
			l.textContent.trim()
		);
		expect(labels).toContain('Columns');
		expect(labels).toContain('Function');
		expect(labels.some((l) => l.startsWith('Percentile'))).toBe(true);
	});

	it('hides the input section when the node runs inside Collect Columns', () => {
		mkCol(1, 'a', [1]);
		mkCol(2, 'b', [2]);
		const { container } = render(Node, { props: { p: mkProcess(), hideInputs: true } });
		const sections = [...container.querySelectorAll('.tableProcess-label')].map((d) =>
			d.textContent.trim()
		);
		expect(sections).toEqual(['Calculation']);
	});
});
