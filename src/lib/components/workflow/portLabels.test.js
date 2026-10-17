import { describe, it, expect } from 'vitest';
import { MANY_NOTE, portLabel, portTooltip, portAriaLabel, newSlotHint } from './portLabels.js';

// What a port says about itself: the label on the row, the hover/focus tooltip and the
// accessible name a screen reader announces. One module for all four node cards, so the
// `*` (a port that takes one or more columns) is explained the same way everywhere (UI-20).

const names = { 7: 'Signal' };
const colName = (id) => names[id] ?? null;

describe('portLabel', () => {
	it('display name first, then the port name', () => {
		expect(portLabel({ name: 'ys1', display: 'y' })).toBe('y');
		expect(portLabel({ name: 'xIN' })).toBe('xIN');
	});
	it('a per-column port (col_<id>) shows its column name when there is one', () => {
		expect(portLabel({ name: 'col_7' }, colName)).toBe('Signal');
		expect(portLabel({ name: 'col_8' }, colName)).toBe('col_8');
	});
});

describe('portTooltip', () => {
	it('explains the * on a port that takes one or more columns', () => {
		expect(MANY_NOTE).toBe('The * means it takes one or more columns.');
		expect(portTooltip({ name: 'ys1', display: 'y', dynamic: true }, 'in')).toBe(
			`Input: y*. ${MANY_NOTE}`
		);
		expect(portTooltip({ name: 'out', dynamic: true }, 'out')).toBe(`Output: out*. ${MANY_NOTE}`);
	});
	it('plain inputs and outputs', () => {
		expect(portTooltip({ name: 'x1', display: 'x' }, 'in')).toBe('Input: x');
		expect(portTooltip({ name: 'col_7' }, 'out', { label: 'Signal' })).toBe('Output: Signal');
	});
	it('metric outputs', () => {
		expect(portTooltip({ name: 'm', display: 'R2', metric: true }, 'out')).toBe(
			'Metric output: R2 (one value per series)'
		);
	});
	it('the trailing empty series and line slots say what a drop does', () => {
		expect(portTooltip({ name: 'x3', display: 'x', newSeries: true, series: 3 }, 'in')).toBe(
			'Input: x. Drop a column here to start series 3.'
		);
		expect(
			portTooltip({ name: 'ys3', display: 'y', newSeries: true, series: 3, dynamic: true }, 'in')
		).toBe(`Input: y*. Drop columns here to start series 3. ${MANY_NOTE}`);
		expect(portTooltip({ name: 'ovnew_line', display: 'line', newOverlay: true }, 'in')).toBe(
			'Input: line. Drop a column here to add a line to the plot.'
		);
	});
	it('a compact square has no visible labels, so its tooltip leads with the node', () => {
		expect(portTooltip({ name: 'xIN' }, 'in', { nodeName: 'Cosinor' })).toBe('Cosinor. Input: xIN');
	});
});

describe('portAriaLabel', () => {
	it('node name, direction and port name', () => {
		expect(portAriaLabel('Cosinor', { name: 'amp', display: 'amplitude' }, 'out')).toBe(
			'Cosinor: output port amplitude'
		);
		expect(portAriaLabel('Scatter', { name: 'x1', display: 'x' }, 'in')).toBe(
			'Scatter: input port x'
		);
	});
	it('says what kind of port it is', () => {
		expect(portAriaLabel('Scatter', { name: 'ys1', display: 'y', dynamic: true }, 'in')).toBe(
			'Scatter: input port y, takes one or more columns'
		);
		expect(portAriaLabel('Cosinor', { name: 'm', display: 'R2', metric: true }, 'out')).toBe(
			'Cosinor: metric output port R2, one value per series'
		);
		expect(
			portAriaLabel('Scatter', { name: 'x2', display: 'x', newSeries: true, series: 2 }, 'in')
		).toBe('Scatter: input port x, starts series 2');
		expect(
			portAriaLabel('Scatter', { name: 'ovnew_line', newOverlay: true }, 'in', { label: 'line' })
		).toBe('Scatter: input port line, adds a line');
	});
});

describe('newSlotHint', () => {
	it('the trailing empty series and line slots get a hint; other rows none', () => {
		expect(newSlotHint({ newSeries: true })).toEqual({
			full: '+ Drop a column to add a series',
			short: '+ New series'
		});
		expect(newSlotHint({ newOverlay: true })).toEqual({
			full: '+ Drop a column to add a line',
			short: '+ New line'
		});
		expect(newSlotHint({ name: 'x1' })).toBe(null);
		expect(newSlotHint(undefined)).toBe(null);
	});
});

it('no em-dashes in any of it', () => {
	const all = [
		MANY_NOTE,
		portTooltip({ name: 'a', dynamic: true, newSeries: true, series: 2 }, 'in'),
		portAriaLabel('n', { name: 'a', dynamic: true, metric: true }, 'out'),
		JSON.stringify(newSlotHint({ newSeries: true }))
	].join(' ');
	expect(all).not.toMatch(/—/);
});
