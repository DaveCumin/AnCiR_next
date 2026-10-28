// @ts-nocheck
/**
 * A refused FFT (a long gap, too much missing data) drew empty axes on its node, with the
 * reason only in the Data tab. The plot now carries the reason as lines it draws over the
 * plot area (`refusalLines`), in the node preview and in the workspace alike.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { firstSentence, wrapWords, refusalLines } from '$lib/plots/plotRefusal.js';

const HOURS = Array.from({ length: 192 }, (_, i) => i);
const WAVE = HOURS.map((t) => 10 + 5 * Math.cos((2 * Math.PI * t) / 24));
const GAPPY = WAVE.map((v, i) => (i >= 40 && i < 90 ? null : v));

function mkCol(values, name) {
	const c = new Column({ type: 'number', data: -1, name });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function makeFft(...series) {
	const plot = new Plot({ type: 'fft', name: 'fft', width: 500, height: 300, plot: {} });
	const t = mkCol(HOURS, 'hour');
	for (const [values, name] of series)
		plot.plot.addData({ x: { refId: t }, y: { refId: mkCol(values, name) } });
	core.plots.push(plot);
	return core.plots[core.plots.length - 1].plot;
}

beforeAll(async () => {
	appConsts.plotMap = await loadPlots();
});

beforeEach(() => {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
});

describe('refusal message helpers', () => {
	it('keep the first sentence, not a decimal point', () => {
		expect(firstSentence('a gap of 0.5 h (2 samples). Use Lomb-Scargle.')).toBe(
			'a gap of 0.5\u00a0h (2\u00a0samples).'
		);
		expect(firstSentence('need at least 4 samples')).toBe('need at least 4\u00a0samples');
	});
	it('wrap to the width, never between a number and its unit', () => {
		expect(wrapWords('one two three four', 9)).toEqual(['one two', 'three', 'four']);
		expect(wrapWords(firstSentence('at the 1 h interval'), 8)).toEqual([
			'at the',
			'1\u00a0h',
			'interval'
		]);
	});
	it('name the series only when there is more than one', () => {
		const r = [{ label: 'signal', reason: 'too short. More.' }];
		expect(refusalLines(r, 80, 'No spectrum', 1)).toEqual(['No spectrum: too short.']);
		expect(refusalLines(r, 80, 'No spectrum', 2)).toEqual(['signal: no spectrum: too short.']);
	});
});

describe('FFT plot draws its refusal', () => {
	it('a series over a long gap gives the reason on the plot', () => {
		const p = makeFft([GAPPY, 'signal']);
		expect(p.data[0].fftData.reason).toMatch(/gap/);
		expect(p.allRefused).toBe(true);
		const text = p.refusalLines.join(' ');
		expect(text).toMatch(/^No spectrum: the record has a gap of 50\sh/);
		// Only the first sentence: the advice stays in the Data tab.
		expect(text).not.toMatch(/Lomb-Scargle/);
	});

	it('a good series beside a refused one names the refused one and keeps drawing', () => {
		const p = makeFft([WAVE, 'good'], [GAPPY, 'gappy']);
		expect(p.allRefused).toBe(false);
		expect(p.refusalLines.join(' ')).toMatch(/^gappy: no spectrum: the record has a gap/);
	});

	it('a good series draws no message', () => {
		const p = makeFft([WAVE, 'good']);
		expect(p.refusalLines).toEqual([]);
		expect(p.allRefused).toBe(false);
	});
});
