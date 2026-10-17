// @ts-nocheck
// A time column whose times repeat carries a warning (David, 2026-10-17). Multi-file import
// keeps every row, so files that overlap leave times that appear more than once; the
// warning says so on the column, wherever the column is shown, and points to Bin Data.
// It is worked out from the data each time it is shown (never stored), so it holds for a
// single file with repeated times too, survives save and load, and goes when an edit
// removes the repeats.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { core } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { columnWarnings, countRepeatedTimes, repeatedTimesWarning } from './columnWarnings.js';
import GroupNode from '$lib/components/workflow/GroupNode.svelte';
import WorkflowNode from '$lib/components/workflow/WorkflowNode.svelte';
import CompactNode from '$lib/components/workflow/CompactNode.svelte';
import ColumnComponent from '$lib/core/Column.svelte';

const H = 3_600_000;

/** A source column as an import makes it. */
function sourceColumn(values, { type = 'time', name = 'time' } = {}) {
	const c = new Column({ type, data: -1, name });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c;
}

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
	core.groups = [];
});
afterEach(() => cleanup());

describe('countRepeatedTimes', () => {
	it('counts the distinct times that appear more than once', () => {
		expect(countRepeatedTimes([1, 2, 2, 3, 3, 3, 4])).toBe(2);
	});

	it('no repeats, nothing to count', () => {
		expect(countRepeatedTimes([1, 2, 3])).toBe(0);
		expect(countRepeatedTimes([])).toBe(0);
	});

	it('blank cells are not times, so they never repeat', () => {
		expect(countRepeatedTimes([null, null, NaN, NaN, undefined, 1])).toBe(0);
	});
});

describe('repeatedTimesWarning', () => {
	it('names the count and points to Bin Data', () => {
		expect(repeatedTimesWarning(30)).toBe(
			'30 times appear more than once (files that overlap, for example). ' +
				'To combine rows that share a time, bin the data (Bin\u00a0Data).'
		);
	});

	it('one time', () => {
		expect(repeatedTimesWarning(1)).toMatch(/^1 time appears more than once /);
	});

	it('large counts are grouped', () => {
		expect(repeatedTimesWarning(1234)).toMatch(/^1,234 times appear/);
	});

	it('none: no warning, and no em-dash ever', () => {
		expect(repeatedTimesWarning(0)).toBe(null);
		expect(repeatedTimesWarning(2)).not.toMatch(/—/);
	});
});

describe('columnWarnings', () => {
	it('a time column with repeated times', () => {
		const c = sourceColumn([0, H, H, 2 * H, 2 * H, 3 * H]);
		expect(columnWarnings(c)).toEqual([repeatedTimesWarning(2)]);
	});

	it('a time column read from text (an import) compares instants, not text', () => {
		const c = sourceColumn(['2026-03-24 00:00:00', '2026-03-24 01:00:00', '2026-03-24 01:00:00']);
		c.timeFormat = 'YYYY-MM-DD HH:mm:ss';
		expect(columnWarnings(c)).toEqual([repeatedTimesWarning(1)]);
	});

	it('no repeats, no warning', () => {
		expect(columnWarnings(sourceColumn([0, H, 2 * H]))).toEqual([]);
	});

	it('only time columns: repeated numbers are ordinary data', () => {
		expect(columnWarnings(sourceColumn([1, 1, 2], { type: 'number', name: 'v' }))).toEqual([]);
	});

	it('an edit that removes the repeats removes the warning', () => {
		const c = sourceColumn([0, H, H]);
		expect(columnWarnings(c)).toHaveLength(1);
		core.rawData.set(c.data, [0, H, 2 * H]);
		c.rawDataVersion++;
		expect(columnWarnings(c)).toEqual([]);
	});

	it('no column, or a column that cannot be read: no warning, no throw', () => {
		expect(columnWarnings(null)).toEqual([]);
		expect(
			columnWarnings({
				type: 'time',
				getData() {
					throw new Error('broken');
				}
			})
		).toEqual([]);
	});
});

describe('the warning is shown on the column', () => {
	it('on its row in a group card (where an import puts its columns)', async () => {
		const c = sourceColumn([0, H, H, 2 * H]);
		const ok = sourceColumn([1, 2, 3], { type: 'number', name: 'activity' });
		core.groups.push({
			id: 'group_t',
			name: 'g',
			x: 0,
			y: 0,
			width: 240,
			height: 180,
			sourceColumnIds: [c.id, ok.id],
			allColumnIds: null,
			collapsed: false,
			rowState: {}
		});
		const node = { id: 'group_t', type: 'group', groupObj: core.groups[0], label: 'g' };
		const { container } = render(GroupNode, { props: { node } });
		flushSync();
		await tick();
		const badges = container.querySelectorAll('[data-testid="column-warning"]');
		expect(badges).toHaveLength(1);
		expect(badges[0].getAttribute('aria-label')).toBe(`Warning: ${repeatedTimesWarning(1)}`);
		expect(badges[0].closest('.source-row').textContent).toContain('time');
	});

	it('on a standalone data node', async () => {
		const c = sourceColumn([0, H, H]);
		const node = {
			id: `data_${c.id}`,
			type: 'data',
			refId: c.id,
			label: 'time',
			ports: { inputs: [], outputs: [] }
		};
		const { container } = render(WorkflowNode, { props: { node } });
		flushSync();
		await tick();
		const badge = container.querySelector('[data-testid="column-warning"]');
		expect(badge?.getAttribute('aria-label')).toBe(`Warning: ${repeatedTimesWarning(1)}`);
	});

	it('on a collapsed data node (the yellow border and tooltip)', async () => {
		const c = sourceColumn([0, H, H]);
		const node = {
			id: `data_${c.id}`,
			type: 'data',
			refId: c.id,
			label: 'time',
			ports: { inputs: [], outputs: [] }
		};
		const { container } = render(CompactNode, { props: { node } });
		flushSync();
		await tick();
		expect(container.querySelector('.compact-node.has-warning')).not.toBeNull();
	});

	it('in the Data panel row', async () => {
		const c = sourceColumn([0, H, H]);
		const { container } = render(ColumnComponent, { props: { col: c } });
		flushSync();
		await tick();
		const p = container.querySelector('[data-testid="column-warning"]');
		expect(p?.textContent.trim()).toBe(repeatedTimesWarning(1));
	});
});
