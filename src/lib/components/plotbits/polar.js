// Generic polar projection. A value on a circle of length `period` maps to a
// screen point: 0 sits at the TOP and values increase CLOCKWISE. Not specific
// to the Circular phase plot — any polar plot (polar scatter, radar, wind-rose,
// clock heatmap) can import this, exactly as Cartesian plots share a linear
// scale. Marks stay Cartesian and just draw at toXY(...).
const TAU = Math.PI * 2;

/**
 * @param {{cx:number, cy:number, radius:number, period:number}} cfg
 */
export function createPolar({ cx, cy, radius, period }) {
	const angle = (v) => (v / period) * TAU; // radians, 0 = up
	const toXY = (v, r01) => {
		const th = angle(v);
		const r = r01 * radius;
		return [cx + r * Math.sin(th), cy - r * Math.cos(th)];
	};
	const fromXY = (px, py) => {
		const dx = px - cx;
		const dy = py - cy;
		let th = Math.atan2(dx, -dy);
		if (th < 0) th += TAU;
		return { value: (th / TAU) * period, r01: Math.hypot(dx, dy) / radius };
	};
	return { cx, cy, radius, period, angle, toXY, fromXY };
}
