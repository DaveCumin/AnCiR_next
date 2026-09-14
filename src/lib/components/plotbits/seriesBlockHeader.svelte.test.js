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
