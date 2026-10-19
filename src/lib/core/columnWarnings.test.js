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
import {
	columnWarnings,
	countRepeatedTimes,
	repeatedTimesWarning,
	longFormatWarning,
	isSourceColumn,
	LONG_FORMAT_MAX_ROWS
} from './columnWarnings.js';
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

/** Columns imported together: one group holding them, as an import makes it. */
function group(cols, id = 'group_t') {
	const g = {
		id,
		name: 'g',
		x: 0,
		y: 0,
		width: 240,
		height: 180,
		sourceColumnIds: cols.map((c) => c.id),
		allColumnIds: null,
		collapsed: false,
		rowState: {}
	};
	core.groups.push(g);
	return g;
}

/** Long format: each subject has one row per time, `nT` times. */
function longFormat(subjects, nT, { labelType = 'category' } = {}) {
	const times = [];
	const labels = [];
	const values = [];
	for (const s of subjects) {
		for (let i = 0; i < nT; i++) {
			times.push(i * H);
			labels.push(s);
			values.push(i);
		}
	}
	const time = sourceColumn(times);
	const subject = sourceColumn(labels, { type: labelType, name: 'subject' });
	const value = sourceColumn(values, { type: 'number', name: 'activity' });
	return { time, subject, value };
}

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
	core.groups = [];
	core.tableProcesses = [];
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
	it('names the count and both remedies (Bin Data, Long To Wide)', () => {
		expect(repeatedTimesWarning(30)).toBe(
			'30 times appear more than once. ' +
				'If files or datasets overlap, bin the data (Bin\u00a0Data) to combine rows that share a time. ' +
				'If there is one row per subject or group at each time, use Long\u00a0To\u00a0Wide to give each its own column.'
		);
	});

	it('one time', () => {
		expect(repeatedTimesWarning(1)).toMatch(/^1 time appears more than once\. /);
	});

	it('large counts are grouped', () => {
		expect(repeatedTimesWarning(1234)).toMatch(/^1,234 times appear/);
	});

	it('none: no warning, and no em-dash ever', () => {
		expect(repeatedTimesWarning(0)).toBe(null);
		expect(repeatedTimesWarning(2)).not.toMatch(/\u2014/);
		expect(longFormatWarning('subject', 3)).not.toMatch(/\u2014/);
	});
});

describe('longFormatWarning', () => {
	it('names the label column, its label count, and Long To Wide', () => {
		expect(longFormatWarning('subject', 3)).toBe(
			"Times repeat once per 'subject' (3 values): this looks like long format " +
				'(one row per subject per time). Use Long\u00a0To\u00a0Wide to give each subject its own column.'
		);
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

describe('long format', () => {
	it('two subjects with text labels: names the label column and Long To Wide', () => {
		const { time, subject, value } = longFormat(['m1', 'm2'], 5);
		group([time, subject, value]);
		expect(columnWarnings(time)).toEqual([longFormatWarning('subject', 2)]);
	});

	it('three subjects whose labels are numbers in a category column', () => {
		const { time, subject, value } = longFormat([1, 2, 3], 4);
		group([time, subject, value]);
		expect(columnWarnings(time)).toEqual([longFormatWarning('subject', 3)]);
	});

	it('a label column typed text counts too', () => {
		const { time, subject, value } = longFormat(['a', 'b'], 4, { labelType: 'text' });
		group([time, subject, value]);
		expect(columnWarnings(time)).toEqual([longFormatWarning('subject', 2)]);
	});

	it('a numeric column never counts as the label (values are nearly always unique)', () => {
		const { time, value } = longFormat(['a', 'b'], 4);
		const ids = sourceColumn(
			time.getData().map((_, i) => i % 3),
			{ type: 'number', name: 'id' }
		);
		group([time, value, ids]);
		expect(columnWarnings(time)).toEqual([repeatedTimesWarning(4)]);
	});

	it('blank labels are left out of the check', () => {
		const { time, subject, value } = longFormat(['m1', 'm2'], 5);
		const labels = subject.getData().slice();
		labels[1] = '';
		labels[7] = null;
		labels[8] = '  ';
		core.rawData.set(subject.data, labels);
		subject.rawDataVersion++;
		group([time, subject, value]);
		expect(columnWarnings(time)).toEqual([longFormatWarning('subject', 2)]);
	});

	it('repeats that only blank-label rows make are not explained by the labels', () => {
		const time = sourceColumn([0, 0, H, H]);
		const lab = sourceColumn(['a', null, 'b', null], { type: 'category', name: 'subject' });
		group([time, lab]);
		expect(columnWarnings(time)).toEqual([repeatedTimesWarning(2)]);
	});

	it('two candidate label columns with as many labels: column order decides', () => {
		const t = sourceColumn([0, 0, H, H, 2 * H, 2 * H]);
		const animal = sourceColumn(['a1', 'a2', 'a1', 'a2', 'a1', 'a2'], {
			type: 'category',
			name: 'animal'
		});
		const sex = sourceColumn(['F', 'M', 'F', 'M', 'F', 'M'], { type: 'category', name: 'sex' });
		group([t, animal, sex]);
		expect(columnWarnings(t)).toEqual([longFormatWarning('animal', 2)]);
	});

	it('two candidates with different label counts: fewest labels wins over column order', () => {
		const times = [];
		const fine = [];
		const coarse = [];
		// Times 0..3 each appear twice; "fine" has 4 labels, "coarse" 2; both unique per time.
		for (let i = 0; i < 4; i++) {
			times.push(i * H, i * H);
			fine.push(`f${(i % 2) * 2}`, `f${(i % 2) * 2 + 1}`);
			coarse.push('X', 'Y');
		}
		const t = sourceColumn(times);
		const f = sourceColumn(fine, { type: 'category', name: 'fine' });
		const c = sourceColumn(coarse, { type: 'category', name: 'coarse' });
		group([t, f, c]);
		expect(columnWarnings(t)).toEqual([longFormatWarning('coarse', 2)]);
	});

	it('a label column that does not make pairs unique falls back', () => {
		const t = sourceColumn([0, 0, 0, H, H, H]);
		const lab = sourceColumn(['a', 'a', 'b', 'a', 'b', 'b'], { type: 'category', name: 'subject' });
		group([t, lab]);
		expect(columnWarnings(t)).toEqual([repeatedTimesWarning(2)]);
	});

	it('a row-id column (as many labels as rows) is not a grouping', () => {
		const t = sourceColumn([0, 0, H, H]);
		const lab = sourceColumn(['r1', 'r2', 'r3', 'r4'], { type: 'category', name: 'row' });
		group([t, lab]);
		expect(columnWarnings(t)).toEqual([repeatedTimesWarning(2)]);
	});

	it('overlapping files with no label column: the broader text', () => {
		const t = sourceColumn([0, H, 2 * H, H, 2 * H, 3 * H]);
		const v = sourceColumn([1, 2, 3, 4, 5, 6], { type: 'number', name: 'activity' });
		group([t, v]);
		expect(columnWarnings(t)).toEqual([repeatedTimesWarning(2)]);
	});

	it('a single repeated time with a label column that explains it', () => {
		const t = sourceColumn([0, H, H, 2 * H]);
		const lab = sourceColumn(['a', 'a', 'b', 'b'], { type: 'category', name: 'subject' });
		group([t, lab]);
		expect(columnWarnings(t)).toEqual([longFormatWarning('subject', 2)]);
	});

	it('a column with no siblings (a standalone data node): the broader text', () => {
		const { time } = longFormat(['m1', 'm2'], 3);
		expect(columnWarnings(time)).toEqual([repeatedTimesWarning(3)]);
	});

	it('a label column of another length is not compared', () => {
		const t = sourceColumn([0, 0, H, H]);
		const lab = sourceColumn(['a', 'b', 'a'], { type: 'category', name: 'subject' });
		group([t, lab]);
		expect(columnWarnings(t)).toEqual([repeatedTimesWarning(2)]);
	});

	it('a numeric time-like column is never flagged, labels or not', () => {
		const n = sourceColumn([0, 0, 1, 1], { type: 'number', name: 'hour' });
		const lab = sourceColumn(['a', 'b', 'a', 'b'], { type: 'category', name: 'subject' });
		group([n, lab]);
		expect(columnWarnings(n)).toEqual([]);
	});

	it("a node output: its node's other outputs are its siblings", () => {
		const { time, subject, value } = longFormat(['A', 'B'], 3);
		core.tableProcesses.push({
			id: 7,
			args: { out: { time: time.id, category: subject.id, value: value.id } }
		});
		expect(columnWarnings(time)).toEqual([longFormatWarning('subject', 2)]);
	});

	it('the threshold: at most LONG_FORMAT_MAX_ROWS rows are checked, one more is not', () => {
		const make = (n) => {
			core.data = [];
			core.groups = [];
			const times = new Array(n);
			const labels = new Array(n);
			for (let i = 0; i < n; i++) {
				times[i] = Math.floor(i / 2) * 1000;
				labels[i] = i % 2 ? 'b' : 'a';
			}
			const t = sourceColumn(times);
			const lab = sourceColumn(labels, { type: 'category', name: 'subject' });
			group([t, lab]);
			return t;
		};
		expect(columnWarnings(make(LONG_FORMAT_MAX_ROWS))).toEqual([longFormatWarning('subject', 2)]);
		expect(columnWarnings(make(LONG_FORMAT_MAX_ROWS + 2))).toEqual([
			repeatedTimesWarning((LONG_FORMAT_MAX_ROWS + 2) / 2)
		]);
	});
});

describe('source columns (where rows came from) are never the label', () => {
	it('names: Source file, Source file (2), Source, source_file, File, Dataset', () => {
		for (const name of [
			'Source file',
			'Source file (2)',
			'Source',
			'source_file',
			'File',
			'Filename',
			'Dataset'
		]) {
			expect(isSourceColumn({ name }), name).toBe(true);
		}
		for (const name of ['subject', 'Sources of light', 'animal', 'profile', 'resource']) {
			expect(isSourceColumn({ name }), name).toBe(false);
		}
		expect(isSourceColumn({ name: 'x', isSourceColumn: true })).toBe(true);
	});

	it('a Join Data-like output (A stacked on B, with a "Source" column): bin, not Long To Wide', () => {
		const times = [0, H, 2 * H, 0, H, 2 * H];
		const t = sourceColumn(times);
		const src = sourceColumn(['A', 'A', 'A', 'B', 'B', 'B'], { type: 'category', name: 'Source' });
		const v = sourceColumn([1, 2, 3, 4, 5, 6], { type: 'number', name: 'value' });
		core.tableProcesses.push({ id: 9, args: { out: { time: t.id, source: src.id, value: v.id } } });
		expect(columnWarnings(t)).toEqual([repeatedTimesWarning(3)]);
	});

	it("Join Data's source output still counts after the user renames it (its out key)", () => {
		const t = sourceColumn([0, H, 2 * H, 0, H, 2 * H]);
		const src = sourceColumn(['A', 'A', 'A', 'B', 'B', 'B'], { type: 'category', name: 'batch' });
		core.tableProcesses.push({ id: 11, args: { out: { jointime: t.id, source: src.id } } });
		expect(isSourceColumn(src)).toBe(true);
		expect(columnWarnings(t)).toEqual([repeatedTimesWarning(3)]);
	});

	it('a renamed import source column still counts when every label is a file name', () => {
		const t = sourceColumn([0, H, H, 2 * H]);
		const src = sourceColumn(['a.csv', 'a.csv', 'b.csv', 'b.csv'], {
			type: 'category',
			name: 'mouse'
		});
		group([t, src]);
		expect(columnWarnings(t)).toEqual([repeatedTimesWarning(1)]);
	});

	it('a source column beside a real label column: the label column still wins', () => {
		const t = sourceColumn([0, 0, H, H]);
		const src = sourceColumn(['a.csv', 'a.csv', 'a.csv', 'a.csv'], {
			type: 'category',
			name: 'Source file'
		});
		const lab = sourceColumn(['m1', 'm2', 'm1', 'm2'], { type: 'category', name: 'subject' });
		group([t, src, lab]);
		expect(columnWarnings(t)).toEqual([longFormatWarning('subject', 2)]);
	});
});

describe('cache and edits', () => {
	it('editing the label column so pairs repeat switches to the broader text, and back', () => {
		const t = sourceColumn([0, 0, H, H]);
		const lab = sourceColumn(['a', 'b', 'a', 'b'], { type: 'category', name: 'subject' });
		group([t, lab]);
		expect(columnWarnings(t)).toEqual([longFormatWarning('subject', 2)]);
		core.rawData.set(lab.data, ['a', 'a', 'a', 'b']);
		lab.rawDataVersion++;
		expect(columnWarnings(t)).toEqual([repeatedTimesWarning(2)]);
		core.rawData.set(lab.data, ['a', 'b', 'a', 'b']);
		lab.rawDataVersion++;
		expect(columnWarnings(t)).toEqual([longFormatWarning('subject', 2)]);
	});

	it('editing the time column re-checks against the same labels', () => {
		const t = sourceColumn([0, 0, H, H]);
		const lab = sourceColumn(['a', 'b', 'a', 'b'], { type: 'category', name: 'subject' });
		group([t, lab]);
		expect(columnWarnings(t)).toHaveLength(1);
		core.rawData.set(t.data, [0, 0, 0, H]);
		t.rawDataVersion++;
		expect(columnWarnings(t)).toEqual([repeatedTimesWarning(1)]);
	});

	it('renaming the label column renames it in the warning; changing its type drops it', () => {
		const t = sourceColumn([0, 0, H, H]);
		const lab = sourceColumn(['a', 'b', 'a', 'b'], { type: 'category', name: 'subject' });
		group([t, lab]);
		lab.name = 'mouse';
		expect(columnWarnings(t)).toEqual([longFormatWarning('mouse', 2)]);
		lab.type = 'number';
		expect(columnWarnings(t)).toEqual([repeatedTimesWarning(2)]);
	});

	it('a label column that throws on read is skipped, no throw', () => {
		const t = sourceColumn([0, 0, H, H]);
		const lab = sourceColumn(['a', 'b', 'a', 'b'], { type: 'category', name: 'subject' });
		group([t, lab]);
		lab.getData = () => {
			throw new Error('broken');
		};
		expect(columnWarnings(t)).toEqual([repeatedTimesWarning(2)]);
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

describe('the long-format warning is shown in every place the column is shown', () => {
	/** A long-format group: time, subject (2 labels), activity. */
	function longGroup() {
		const t = sourceColumn([0, 0, H, H]);
		const lab = sourceColumn(['m1', 'm2', 'm1', 'm2'], { type: 'category', name: 'subject' });
		const v = sourceColumn([1, 2, 3, 4], { type: 'number', name: 'activity' });
		const g = group([t, lab, v]);
		return { t, g };
	}
	const LONG = () => longFormatWarning('subject', 2);

	it('group card row', async () => {
		const { g } = longGroup();
		const node = { id: g.id, type: 'group', groupObj: g, label: 'g' };
		const { container } = render(GroupNode, { props: { node } });
		flushSync();
		await tick();
		const badges = container.querySelectorAll('[data-testid="column-warning"]');
		expect(badges).toHaveLength(1);
		expect(badges[0].getAttribute('aria-label')).toBe(`Warning: ${LONG()}`);
	});

	it('data node header (its node-output siblings)', async () => {
		const t = sourceColumn([0, 0, H, H]);
		const lab = sourceColumn(['m1', 'm2', 'm1', 'm2'], { type: 'category', name: 'subject' });
		core.tableProcesses.push({ id: 3, args: { out: { time: t.id, cat: lab.id } } });
		const node = {
			id: `data_${t.id}`,
			type: 'data',
			refId: t.id,
			label: 'time',
			ports: { inputs: [], outputs: [] }
		};
		const { container } = render(WorkflowNode, { props: { node } });
		flushSync();
		await tick();
		const badge = container.querySelector('[data-testid="column-warning"]');
		expect(badge?.getAttribute('aria-label')).toBe(`Warning: ${LONG()}`);
	});

	it('collapsed data node tooltip', async () => {
		const { t } = longGroup();
		const node = {
			id: `data_${t.id}`,
			type: 'data',
			refId: t.id,
			label: 'time',
			ports: { inputs: [], outputs: [] }
		};
		const { container } = render(CompactNode, { props: { node } });
		flushSync();
		await tick();
		const el = container.querySelector('.compact-node.has-warning');
		expect(el).not.toBeNull();
		el.dispatchEvent(new MouseEvent('mouseenter', { clientX: 5, clientY: 5 }));
		expect(document.querySelector('.app-tooltip')?.textContent ?? '').toContain(LONG());
	});

	it('Data panel row', async () => {
		const { t } = longGroup();
		const { container } = render(ColumnComponent, { props: { col: t } });
		flushSync();
		await tick();
		const p = container.querySelector('[data-testid="column-warning"]');
		expect(p?.textContent.trim()).toBe(LONG());
	});
});
