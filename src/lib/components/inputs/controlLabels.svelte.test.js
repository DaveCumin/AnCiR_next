// Each way a control-panel field is labelled gives the control its visible label as its
// accessible name (accessibility audit #7, src/lib/_tests/controlLabels.guard.test.js).
//
// A wrapping <ControlInput> names a plain control natively; a ControlInput with
// associate={false} names a composite control through aria-labelledby (controlLabel.js),
// and the plot series rows name their Column's picker through `labelledby`.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { computeAccessibleName } from 'dom-accessibility-api';
import ControlLabelHarness from './__fixtures__/ControlLabelHarness.svelte';
import { Column } from '$lib/core/Column.svelte';
import { core } from '$lib/core/core.svelte.js';

afterEach(() => cleanup());

function mount() {
	core.data = [];
	const col = new Column({ refId: -1 });
	return render(ControlLabelHarness, { props: { col } });
}

describe('ControlInput labels', () => {
	it('a wrapping label names a select and a number box', () => {
		const { getByLabelText } = mount();
		expect(getByLabelText('Method').tagName).toBe('SELECT');
		expect(getByLabelText('Width').getAttribute('type')).toBe('number');
	});

	it('a click on a wrapping label activates its select, not a colour picker', async () => {
		const { getByText, getByLabelText, container } = mount();
		let clicks = 0;
		getByLabelText('Method').addEventListener('click', () => clicks++);
		await fireEvent.click(getByText('Method'));
		expect(clicks).toBe(1);
		// The colour row is not a <label>, so its words do not open (or close) the popup.
		expect(getByText('Fill').closest('label')).toBeNull();
		expect(container.querySelector('.colour-picker')).toBeNull();
	});

	it('a column picker is named "<label> <selected column>", and stays a <div> wrapper', () => {
		const { getByText, getAllByRole } = mount();
		const trigger = getAllByRole('button').find((b) => b.getAttribute('aria-haspopup'));
		expect(computeAccessibleName(trigger)).toMatch(/^Time \(x\) /);
		expect(getByText('Time (x)').closest('label')).toBeNull();
	});

	it('a colour swatch is named "<label> Choose colour"', () => {
		const { getAllByRole } = mount();
		const swatch = getAllByRole('button').find((b) => b.classList.contains('cp-preview'));
		expect(computeAccessibleName(swatch)).toBe('Fill Choose colour');
	});

	it('a number box beside a note is named by the label alone', () => {
		const { getAllByRole } = mount();
		const boxes = getAllByRole('spinbutton');
		expect(boxes.map((b) => computeAccessibleName(b))).toEqual(['Frequency step', 'Width']);
	});

	it('a switch takes the label; the date and time fields carry it too', () => {
		const { getByRole, getByLabelText } = mount();
		expect(computeAccessibleName(getByRole('checkbox'))).toBe('Noise');
		expect(getByLabelText('Start (date)').getAttribute('type')).toBe('date');
		expect(getByLabelText('Start (time)').getAttribute('type')).toBe('time');
	});

	it('a plot series row names its Column picker', () => {
		const { getAllByRole } = mount();
		const triggers = getAllByRole('button').filter((b) => b.getAttribute('aria-haspopup'));
		expect(triggers.map((t) => computeAccessibleName(t).split(' ')[0])).toContain('Values');
		expect(computeAccessibleName(triggers.at(-1))).toMatch(/^Values \(y\) /);
	});
});
