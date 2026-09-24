// @ts-nocheck
// The scatterplot's automatic domain leaves room for its markers.
//
// The domain used to be the data's exact range, so a point at the maximum sat ON the edge of
// the plot area and half its marker was drawn outside it, over the axis line or into the
// margin. Automatic ends now carry half the widest mark (plus a pixel); limits the user set,
// or a zoom set, are kept exactly.
import { describe, it, expect, beforeEach } from 'vitest';
import { core } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Scatterplotclass } from './Scatterplot.svelte';

function mkCol(values) {
	const c = new Column({ type: 'number', data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

function mkScatter(xs, ys) {
	const parentBox = { id: 1, width: 500, height: 300 };
	const s = new Scatterplotclass(parentBox, null);
	s.parentBox = parentBox;
	s.padding = { top: 15, right: 30, bottom: 30, left: 40 };
	s.addData({ x: { refId: mkCol(xs) }, y: { refId: mkCol(ys) } });
	s.legend.show = false; // keep the plot width fixed; placement has its own tests
	return s;
}

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
});

describe('scatterplot marker room', () => {
	it('the outermost markers are wholly inside the plot area', () => {
		const s = mkScatter([0, 5, 10], [0, 50, 100]);
		const r = s.data[0].points.radius;
		expect(s.data[0].points.draw).toBe(true);
		// Every extreme point is at least its radius from each edge.
		expect(s.XScale(0)).toBeGreaterThanOrEqual(r);
		expect(s.plotwidth - s.XScale(10)).toBeGreaterThanOrEqual(r);
		expect(s.YScaleLeft(100)).toBeGreaterThanOrEqual(r);
		expect(s.plotheight - s.YScaleLeft(0)).toBeGreaterThanOrEqual(r);
		// ...and not much more: the room is the marker's, not a generous margin.
		expect(s.XScale(0)).toBeLessThanOrEqual(r + 1 + 1e-9);
	});

	it('limits the user set are kept EXACTLY, end by end', () => {
		const s = mkScatter([0, 5, 10], [0, 50, 100]);
		s.xlimsIN = [0, 10];
		s.ylimsLeftIN = [0, null];
		expect(s.xlims).toEqual([0, 10]);
		expect(s.ylimsLeft[0]).toBe(0);
		expect(s.ylimsLeft[1]).toBeGreaterThan(100); // the automatic end still has room
	});

	it('bigger markers get more room', () => {
		const s = mkScatter([0, 10], [0, 10]);
		const small = s.xlims[1] - s.xlims[0];
		s.data[0].points.radius = 10;
		expect(s.xlims[1] - s.xlims[0]).toBeGreaterThan(small);
	});

	it('nothing drawn means no room: the domain is the data extent', () => {
		const s = mkScatter([0, 10], [0, 10]);
		s.data[0].points.draw = false;
		s.data[0].line.draw = false;
		expect(s.xlims).toEqual([0, 10]);
		expect(s.ylimsLeft).toEqual([0, 10]);
	});

	it('the unpadded limits stay available (repeating bands anchor on them)', () => {
		const s = mkScatter([2, 10], [0, 10]);
		expect(s.xlimsUnpadded).toEqual([2, 10]);
		expect(s.xlims[0]).toBeLessThan(2);
		expect(s.overlayContext().xAnchorMin).toBe(2);
	});
});
