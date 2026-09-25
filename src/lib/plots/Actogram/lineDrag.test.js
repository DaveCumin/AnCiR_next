import { describe, it, expect } from 'vitest';
import {
	actogramPointToDayTime,
	cursorForZone,
	dragLine,
	lineZoneAt,
	pastThreshold,
	DRAG_THRESHOLD_PX,
	END_ZONE_FRACTION
} from './lineDrag.js';

const GEOM = {
	padLeft: 20,
	padTop: 30,
	plotwidth: 480,
	eachplotheight: 20,
	spaceBetween: 4,
	periodHrs: 24,
	doublePlot: 1
};

/** The line's time of day at day `d`, in the same frame PhaseMarkerClass uses. */
function todAt(d, { tau, theta, refDay, periodHrs = 24 }) {
	return theta + (tau - periodHrs) * (d - refDay);
}

describe('actogramPointToDayTime', () => {
	it('maps the top-left of the plot to day 0, hour 0', () => {
		expect(actogramPointToDayTime(GEOM.padLeft, GEOM.padTop, GEOM)).toEqual({ day: 0, tod: 0 });
	});

	it('maps the full plot width to the full plotted period', () => {
		const { tod } = actogramPointToDayTime(GEOM.padLeft + GEOM.plotwidth, GEOM.padTop, GEOM);
		expect(tod).toBe(24);
	});

	it('a repeated (double-plotted) x axis spans two periods', () => {
		const { tod } = actogramPointToDayTime(GEOM.padLeft + GEOM.plotwidth, GEOM.padTop, {
			...GEOM,
			doublePlot: 2
		});
		expect(tod).toBe(48);
	});

	it('runs from the top of a row to its bottom as the day fraction 0 → 1', () => {
		const rowH = GEOM.eachplotheight + GEOM.spaceBetween;
		const top = actogramPointToDayTime(GEOM.padLeft, GEOM.padTop + 3 * rowH, GEOM);
		const mid = actogramPointToDayTime(GEOM.padLeft, GEOM.padTop + 3 * rowH + 10, GEOM);
		const bottom = actogramPointToDayTime(
			GEOM.padLeft,
			GEOM.padTop + 3 * rowH + GEOM.eachplotheight,
			GEOM
		);
		expect(top.day).toBe(3);
		expect(mid.day).toBe(3.5);
		expect(bottom.day).toBe(4);
	});

	it('clamps the dead space between two rows to the end of the row above', () => {
		const rowH = GEOM.eachplotheight + GEOM.spaceBetween;
		// 2 px into the 4 px gap below row 1: still day 2, not 2.1.
		const { day } = actogramPointToDayTime(
			GEOM.padLeft,
			GEOM.padTop + rowH + GEOM.eachplotheight + 2,
			GEOM
		);
		expect(day).toBe(2);
	});
});

describe('lineZoneAt', () => {
	// A line drawn over 1-indexed days 1..11 spans the day coordinate 0..11.
	const span = { lo: 1, hi: 11 };

	it('puts the outer quarter at each end in a rotate zone', () => {
		expect(lineZoneAt(0, span)).toBe('start');
		expect(lineZoneAt(2.74, span)).toBe('start');
		expect(lineZoneAt(11, span)).toBe('end');
		expect(lineZoneAt(8.26, span)).toBe('end');
	});

	it('puts the middle half in the translate zone', () => {
		expect(lineZoneAt(2.76, span)).toBe('middle');
		expect(lineZoneAt(5.5, span)).toBe('middle');
		expect(lineZoneAt(8.24, span)).toBe('middle');
	});

	it('scales the zones with the line, not with the plot', () => {
		// A three-day line: the same fractions, a tenth of the day span.
		const short = { lo: 4, hi: 7 };
		expect(lineZoneAt(3.2, short)).toBe('start');
		expect(lineZoneAt(5, short)).toBe('middle');
		expect(lineZoneAt(6.8, short)).toBe('end');
	});

	it('honours a different end fraction', () => {
		expect(lineZoneAt(4, { ...span, endFraction: 0.1 })).toBe('middle');
		expect(lineZoneAt(4, { ...span, endFraction: 0.5 })).not.toBe('middle');
	});

	it('treats a degenerate span as all middle', () => {
		expect(lineZoneAt(5, { lo: 6, hi: 5 })).toBe('middle');
	});
});

describe('pastThreshold', () => {
	it('is false for a press that has barely moved', () => {
		expect(pastThreshold(1, 1)).toBe(false);
		expect(pastThreshold(DRAG_THRESHOLD_PX, 0)).toBe(false);
	});

	it('is true once the pointer travels further than the threshold', () => {
		expect(pastThreshold(DRAG_THRESHOLD_PX + 0.01, 0)).toBe(true);
		expect(pastThreshold(0, 4)).toBe(true);
		expect(pastThreshold(3, 3)).toBe(true);
	});
});

describe('dragLine: translate (the middle of the line)', () => {
	const base = { tau: 23.5, theta: 6, refDay: 1, periodHrs: 24 };

	it('moves θ by exactly how far the pointer moved, and never touches τ', () => {
		const grab = { day: 5, tod: 4.4 };
		const out = dragLine({
			...base,
			zone: 'middle',
			grab,
			pointer: { day: 5.2, tod: 6.9 }
		});
		expect(out).toEqual({ theta: 8.5 });
		expect(out).not.toHaveProperty('tau');
	});

	it('moves θ backwards for a leftward drag', () => {
		const out = dragLine({
			...base,
			zone: 'middle',
			grab: { day: 5, tod: 10 },
			pointer: { day: 5, tod: 8.75 }
		});
		expect(out).toEqual({ theta: 4.75 });
	});

	it('does not jump when the grab was not exactly on the line', () => {
		// Grabbed 3 hours to the right of the line, then not moved: no change.
		const grab = { day: 5, tod: todAt(5, base) + 3 };
		expect(dragLine({ ...base, zone: 'middle', grab, pointer: { ...grab } })).toBeNull();
	});
});

describe('dragLine: rotate (either end)', () => {
	const base = { tau: 24, theta: 6, refDay: 1, periodHrs: 24 };

	it('changes τ only, and leaves θ at the reference day untouched', () => {
		// τ = 24 = the plotted period, so the line is vertical at 6 h.
		const grab = { day: 10, tod: todAt(10, base) };
		const out = dragLine({ ...base, zone: 'end', grab, pointer: { day: 10, tod: 9 } });
		expect(out).not.toHaveProperty('theta');
		// Dragging the day-10 end 3 hours right over a 9-day lever.
		expect(out.tau).toBeCloseTo(24 + 3 / 9, 12);
		// θ at the reference day is exactly where it was.
		expect(todAt(base.refDay, { ...base, tau: out.tau })).toBeCloseTo(6, 12);
	});

	it('rotates the other way when the near end is dragged, because the lever flips sign', () => {
		const before = { ...base, tau: 24.5 };
		const grab = { day: 0, tod: todAt(0, before) };
		const out = dragLine({
			...before,
			zone: 'start',
			grab,
			pointer: { day: 0, tod: grab.tod + 1 }
		});
		// Lever = 0 - 1 = -1: pushing the early end right shortens τ.
		expect(out.tau).toBeCloseTo(23.5, 12);
		expect(todAt(before.refDay, { ...before, tau: out.tau })).toBeCloseTo(before.theta, 12);
	});

	it('does not jump when the grab was not exactly on the line', () => {
		const grab = { day: 9, tod: todAt(9, base) + 2.5 };
		expect(dragLine({ ...base, zone: 'end', grab, pointer: { ...grab } })).toBeNull();
		// …and one hour further right is the same rotation as if the grab had been on the line.
		const off = dragLine({ ...base, zone: 'end', grab, pointer: { day: 9, tod: grab.tod + 1 } });
		const on = dragLine({
			...base,
			zone: 'end',
			grab: { day: 9, tod: todAt(9, base) },
			pointer: { day: 9, tod: todAt(9, base) + 1 }
		});
		expect(off.tau).toBeCloseTo(on.tau, 12);
	});

	it('refuses to rotate about the pivot itself', () => {
		expect(
			dragLine({
				...base,
				zone: 'end',
				grab: { day: 1, tod: 6 },
				pointer: { day: 1, tod: 9 }
			})
		).toBeNull();
	});
});

describe('dragLine: no-ops', () => {
	const base = { tau: 23.5, theta: 6, refDay: 1, periodHrs: 24 };

	it('returns null when the pointer has not moved at all', () => {
		const grab = { day: 5, tod: 4 };
		expect(dragLine({ ...base, zone: 'middle', grab, pointer: { ...grab } })).toBeNull();
		expect(dragLine({ ...base, zone: 'end', grab, pointer: { ...grab } })).toBeNull();
	});

	it('returns null when the line has no finite parameters to move', () => {
		expect(
			dragLine({
				...base,
				tau: NaN,
				zone: 'middle',
				grab: { day: 5, tod: 4 },
				pointer: { day: 5, tod: 6 }
			})
		).toBeNull();
	});
});

describe('cursorForZone', () => {
	it('offers a grab hand over the body and a resize cursor at the ends', () => {
		expect(cursorForZone('middle')).toBe('grab');
		expect(cursorForZone('middle', true)).toBe('grabbing');
		expect(cursorForZone('start')).toBe('ew-resize');
		expect(cursorForZone('end', true)).toBe('ew-resize');
	});
});

describe('the exported constants are the ones the module actually uses', () => {
	it('END_ZONE_FRACTION is the default end fraction', () => {
		const span = { lo: 1, hi: 11 };
		// The span runs from day 0 to day 11, so the end zone starts at 11*(1 - fraction).
		const justInside = (1 - END_ZONE_FRACTION) * 11 - 0.01;
		expect(lineZoneAt(justInside, span)).toBe('middle');
		expect(lineZoneAt(justInside + 0.02, span)).toBe('end');
	});
});
