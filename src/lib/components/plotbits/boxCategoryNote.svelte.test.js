// A category-coloured boxplot must not show live-looking DEAD colour pickers.
//
// When a boxplot colours per CATEGORY (one series + categorical x — see
// categoryColourLabels in plots/seriesColour.js), the per-series Stroke/Fill pickers
// in Box.svelte's controls are overridden per box: they look editable and do nothing
// visible. The host plot now passes `categoryColoursActive`, and the controls swap
// the two pickers for a note pointing at the "Box colours" section that actually
// owns the colours (CategoryColourControls.svelte, rendered below on the Data tab).
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import { scaleLinear } from 'd3-scale';
import Box, { BoxClass } from './Box.svelte';

function renderControls(extraProps = {}) {
	const boxPlotData = new BoxClass(undefined, undefined);
	return render(Box, {
		props: {
			boxPlotData,
			x: [],
			y: [],
			xscale: scaleLinear().domain([0, 1]).range([0, 100]),
			yscale: scaleLinear().domain([0, 1]).range([100, 0]),
			which: 'controls',
			...extraProps
		}
	});
}

describe('Box controls with category colouring active', () => {
	it('replaces the per-series Stroke/Fill pickers with a pointer to Box colours', () => {
		const { container, queryByText } = renderControls({ categoryColoursActive: true });
		expect(queryByText('Per-category colours are in use — see Box colours below.')).toBeTruthy();
		expect(queryByText('Stroke')).toBeNull();
		expect(queryByText('Fill')).toBeNull();
		// The rest of the box controls (widths etc.) stay usable.
		expect(queryByText('Box Width')).toBeTruthy();
		expect(container.textContent).toContain('Median');
	});

	it('shows the pickers as before when category colouring is off', () => {
		// Scope to THIS render's container: testing-library's queries are bound to
		// document.body, which still holds the previous test's render.
		const { container } = renderControls({ categoryColoursActive: false });
		expect(container.textContent).toContain('Stroke');
		expect(container.textContent).toContain('Fill');
		expect(container.textContent).not.toContain('Per-category colours are in use');
	});
});
