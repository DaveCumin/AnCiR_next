// @ts-nocheck
export const POINT_SHAPES = ['circle', 'triangle', 'square', 'star', 'cross', 'x'];
export const POINT_SHAPE_LABELS = ['Circle', 'Triangle', 'Square', 'Star', 'Cross', 'X'];

/**
 * Build the SVG path `d` fragment for a single marker.
 * All shapes are drawn as filled paths so a single <path fill=colour> covers them.
 * `r` is the bounding-circle radius — matches the circle marker for visual sizing.
 */
export function getPointPath(shape, cx, cy, r) {
	switch (shape) {
		case 'square': {
			return `M${cx - r} ${cy - r}h${2 * r}v${2 * r}h${-2 * r}Z`;
		}
		case 'triangle': {
			const h = (r * Math.sqrt(3)) / 2;
			return `M${cx} ${cy - r}L${cx + h} ${cy + r / 2}L${cx - h} ${cy + r / 2}Z`;
		}
		case 'star': {
			// 5-pointed star, inner/outer ratio ≈ golden (sin18°/sin54°)
			const inner = r * 0.3819660113;
			let d = '';
			for (let i = 0; i < 10; i++) {
				const rad = i % 2 === 0 ? r : inner;
				const ang = -Math.PI / 2 + (i * Math.PI) / 5;
				const x = cx + rad * Math.cos(ang);
				const y = cy + rad * Math.sin(ang);
				d += (i === 0 ? 'M' : 'L') + x + ' ' + y;
			}
			return d + 'Z';
		}
		case 'cross':
		case 'x': {
			// Plus-sign outline; rotated 45° for 'x'. Both share a bounding circle of radius r.
			const t = r / 3;
			const base = [
				[-t, -t], [-t, -r], [t, -r], [t, -t],
				[r, -t], [r, t], [t, t], [t, r],
				[-t, r], [-t, t], [-r, t], [-r, -t]
			];
			const [sin, cos] = shape === 'x' ? [Math.SQRT1_2, Math.SQRT1_2] : [0, 1];
			let d = '';
			base.forEach(([px, py], i) => {
				const x = cx + px * cos - py * sin;
				const y = cy + px * sin + py * cos;
				d += (i === 0 ? 'M' : 'L') + x + ' ' + y;
			});
			return d + 'Z';
		}
		case 'circle':
		default:
			return `M${cx} ${cy}m-${r} 0a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
	}
}
