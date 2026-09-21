// The shared Data-tab series block header: column-name title and a delete
// button that routes through the undoable shared helper.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { mutationService as M } from '$lib/core/mutationService.js';
import { core, appConsts } from '$lib/core/core.svelte';
import { notifications } from '$lib/core/notifications.svelte.js';
import SeriesBlockHeader from './SeriesBlockHeader.svelte';

function makeInner(parent, json) {
	return {
		parentBox: parent,
		data: (json?.data ?? []).map((d) => ({
			label: d.label ?? '',
			y: { refId: d.y?.refId ?? -1, name: d.y?.name ?? '' },
			colour: d.colour ?? null
		})),
		removeData(idx) {
			this.data.splice(idx, 1);
		},
		toJSON() {
			return { data: this.data };
		}
	};
}

beforeAll(() => {
	if (!appConsts.plotMap.has('stubheaderplot')) {
		appConsts.plotMap.set('stubheaderplot', {
			displayName: 'Stub header plot',
			data: { fromJSON: (parent, json) => makeInner(parent, json) }
		});
	}
	history.init();
});

beforeEach(() => {
	history.clear();
	core.plots.length = 0;
	notifications.list.length = 0;
});

function addPlotWith(series) {
	const plot = M.addPlot({ type: 'stubheaderplot', name: 'p', plot: { data: series } });
	history.clear();
	return plot;
}

describe('SeriesBlockHeader', () => {
	it('titles the block with the wired column name (editable placeholder + title attr)', () => {
		const plot = addPlotWith([{ y: { refId: 7, name: 'activity' } }]);
		const { container } = render(SeriesBlockHeader, {
			props: { inner: plot.plot, datum: plot.plot.data[0], index: 0 }
		});
		const title = container.querySelector('.series-title');
		expect(title.getAttribute('title')).toBe('activity');
		expect(container.textContent).toContain('activity');
	});

	it('falls back to the positional title while unwired', () => {
		const plot = addPlotWith([{ y: { refId: -1, name: '' } }, { y: { refId: -1, name: '' } }]);
		const { container } = render(SeriesBlockHeader, {
			props: { inner: plot.plot, datum: plot.plot.data[1], index: 1, editable: false }
		});
		expect(container.querySelector('.series-title').textContent.trim()).toBe('Data 2');
	});

	it('honours a plot-specific fallback ("Variable N")', () => {
		const plot = addPlotWith([{ y: { refId: -1, name: '' } }]);
		const { container } = render(SeriesBlockHeader, {
			props: {
				inner: plot.plot,
				datum: plot.plot.data[0],
				index: 0,
				editable: false,
				fallback: 'Variable 1'
			}
		});
		expect(container.querySelector('.series-title').textContent.trim()).toBe('Variable 1');
	});

	it('renders no passive colour swatch (tried and rejected 2026-09-14)', () => {
		// The inert dot looked clickable but was not; the column-name title is the
		// block's identifier. See the vault note "2026-09-14-series-swatch-rejected".
		const plot = addPlotWith([{ y: { refId: 7, name: 'activity' }, colour: '#123456' }]);
		const { container } = render(SeriesBlockHeader, {
			props: { inner: plot.plot, datum: plot.plot.data[0], index: 0 }
		});
		expect(container.querySelector('.series-swatch')).toBeNull();
	});

	it('the trash button deletes through history and raises the Undo toast', async () => {
		const plot = addPlotWith([
			{ y: { refId: 7, name: 'activity' }, colour: '#123456' },
			{ y: { refId: 9, name: 'temp' }, colour: '#654321' }
		]);
		const { container } = render(SeriesBlockHeader, {
			props: { inner: plot.plot, datum: plot.plot.data[0], index: 0 }
		});
		await fireEvent.click(container.querySelector('button.icon'));

		expect(plot.plot.data.length).toBe(1);
		expect(history.undoCount).toBe(1);
		expect(notifications.list[0]?.message).toBe('Series "activity" removed');

		history.undo();
		expect(plot.plot.data.length).toBe(2);
		expect(plot.plot.data[0].y.name).toBe('activity');
		expect(plot.plot.data[0].colour).toBe('#123456'); // styling restored with it
	});
});

// ─── Drag-handle reorder ──────────────────────────────────────────────────────
// The grip on the left of every block mirrors the Data view's Plots list: drag a
// block onto another and it takes that position; Alt+Arrow does the same from the
// keyboard. Both route through reorderSeriesWithUndo (one undo step).
describe('SeriesBlockHeader reorder handle', () => {
	const THREE = [
		{ y: { refId: 7, name: 'a' }, colour: '#aa0000' },
		{ y: { refId: 8, name: 'b' }, colour: '#00aa00' },
		{ y: { refId: 9, name: 'c' }, colour: '#0000aa' }
	];
	const refs = (plot) => plot.plot.data.map((d) => d.y.refId);
	function renderHeader(plot, i) {
		return render(SeriesBlockHeader, {
			props: { inner: plot.plot, datum: plot.plot.data[i], index: i }
		});
	}

	it('renders a grip button before the title when the plot has 2+ series', () => {
		const plot = addPlotWith(THREE);
		const { container } = renderHeader(plot, 1);
		const handle = container.querySelector('.series-drag-handle');
		expect(handle).not.toBeNull();
		expect(handle.tagName).toBe('BUTTON');
		expect(handle.getAttribute('draggable')).toBe('true');
		expect(handle.getAttribute('aria-label')).toMatch(/reorder/i);
		// It precedes the title in DOM order (left of the header).
		const header = container.querySelector('.series-block-header');
		expect(header.firstElementChild.contains(handle)).toBe(true);
		expect(
			handle.compareDocumentPosition(container.querySelector('.series-title')) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	it('shows no grip on a single-series plot (nothing to reorder)', () => {
		const plot = addPlotWith([THREE[0]]);
		const { container } = renderHeader(plot, 0);
		expect(container.querySelector('.series-drag-handle')).toBeNull();
	});

	it('dropping block 3 on block 1 moves it to the top, as one undoable step, colours intact', async () => {
		const plot = addPlotWith(THREE);
		const top = renderHeader(plot, 0);
		const third = renderHeader(plot, 2);

		await fireEvent.dragStart(third.container.querySelector('.series-drag-handle'));
		// The drop target is the whole block (the header's parent), not just the header.
		const targetBlock = top.container.querySelector('.series-block-header').parentElement;
		await fireEvent.dragOver(targetBlock);
		// The indicator rides on the BLOCK (top edge = "before"), not the header.
		expect(targetBlock.classList.contains('series-drop-before')).toBe(true);
		await fireEvent.drop(targetBlock);

		expect(refs(plot)).toEqual([9, 7, 8]);
		expect(plot.plot.data.map((d) => d.colour)).toEqual(['#0000aa', '#aa0000', '#00aa00']);
		expect(history.undoCount).toBe(1);
		expect(notifications.list.length).toBe(0); // quiet, like the Plots list
		// Indicator cleared after the drop.
		expect(targetBlock.classList.contains('series-drop-before')).toBe(false);
		expect(targetBlock.classList.contains('series-drop-after')).toBe(false);

		history.undo();
		expect(refs(plot)).toEqual([7, 8, 9]);
		expect(plot.plot.data.map((d) => d.colour)).toEqual(['#aa0000', '#00aa00', '#0000aa']);
	});

	it('shows the indicator BELOW the target when dragging downward, and drops there', async () => {
		const plot = addPlotWith(THREE);
		const first = renderHeader(plot, 0);
		const last = renderHeader(plot, 2);
		await fireEvent.dragStart(first.container.querySelector('.series-drag-handle'));
		const targetBlock = last.container.querySelector('.series-block-header').parentElement;
		await fireEvent.dragOver(targetBlock);
		expect(targetBlock.classList.contains('series-drop-after')).toBe(true);
		expect(targetBlock.classList.contains('series-drop-before')).toBe(false);
		await fireEvent.drop(targetBlock);
		expect(refs(plot)).toEqual([8, 9, 7]);
	});

	it('dropping a block on itself is a no-op with no history entry', async () => {
		const plot = addPlotWith(THREE);
		const { container } = renderHeader(plot, 1);
		const handle = container.querySelector('.series-drag-handle');
		await fireEvent.dragStart(handle);
		const block = container.querySelector('.series-block-header').parentElement;
		await fireEvent.dragOver(block);
		expect(block.classList.contains('series-drop-before')).toBe(false);
		expect(block.classList.contains('series-drop-after')).toBe(false);
		await fireEvent.drop(block);
		expect(refs(plot)).toEqual([7, 8, 9]);
		expect(history.undoCount).toBe(0);
	});

	it('a drop with no drag in flight (foreign drag) does nothing', async () => {
		const plot = addPlotWith(THREE);
		const { container } = renderHeader(plot, 0);
		await fireEvent.drop(container.querySelector('.series-block-header').parentElement);
		expect(refs(plot)).toEqual([7, 8, 9]);
		expect(history.undoCount).toBe(0);
	});

	it('Alt+ArrowDown / Alt+ArrowUp on the grip move the block one step (keyboard path)', async () => {
		const plot = addPlotWith(THREE);
		const { container } = renderHeader(plot, 0);
		const handle = container.querySelector('.series-drag-handle');
		await fireEvent.keyDown(handle, { key: 'ArrowDown', altKey: true });
		expect(refs(plot)).toEqual([8, 7, 9]);
		expect(history.undoCount).toBe(1);
		// Plain arrows (no Alt) must not reorder.
		await fireEvent.keyDown(handle, { key: 'ArrowDown' });
		expect(refs(plot)).toEqual([8, 7, 9]);
	});
});
