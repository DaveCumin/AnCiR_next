import { describe, it, expect } from 'vitest';
import { gaussianKDE, silvermanBandwidth } from './kde.js';

// Trapezoidal integral of a density on its (evenly spaced) grid.
function integrate({ x, density }) {
	let area = 0;
	for (let i = 1; i < x.length; i++) {
		area += ((density[i] + density[i - 1]) / 2) * (x[i] - x[i - 1]);
	}
	return area;
}

// True standard-normal pdf.
function normalPdf(x, mu = 0, sigma = 1) {
	return (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((x - mu) / sigma) ** 2);
}

// Deterministic pseudo-Gaussian sample via Box–Muller on a seeded LCG.
function gaussianSample(nPairs, mu, sigma, seed) {
	let s = seed >>> 0;
	const rand = () => {
		s = (1103515245 * s + 12345) & 0x7fffffff;
		return (s + 1) / 0x80000000;
	};
	const out = [];
	for (let i = 0; i < nPairs; i++) {
		const u1 = rand();
		const u2 = rand();
		const r = Math.sqrt(-2 * Math.log(u1));
		out.push(mu + sigma * r * Math.cos(2 * Math.PI * u2));
		out.push(mu + sigma * r * Math.sin(2 * Math.PI * u2));
	}
	return out;
}

describe('silvermanBandwidth', () => {
	it('is NaN for fewer than 2 values', () => {
		expect(silvermanBandwidth([])).toBeNaN();
		expect(silvermanBandwidth([5])).toBeNaN();
	});

	it('is NaN when all values are identical (σ = 0)', () => {
		expect(silvermanBandwidth([3, 3, 3, 3])).toBeNaN();
	});

	it('matches 1.06·σ·n^(−1/5) exactly', () => {
		const data = [1, 2, 3, 4, 5];
		// sample std of 1..5 = sqrt(2.5)
		const sigma = Math.sqrt(2.5);
		const expected = 1.06 * sigma * Math.pow(5, -1 / 5);
		expect(silvermanBandwidth(data)).toBeCloseTo(expected, 12);
	});
});

describe('gaussianKDE — guard clauses', () => {
	it('returns empty arrays for empty input', () => {
		expect(gaussianKDE([])).toEqual({ x: [], density: [] });
	});

	it('returns empty arrays for null / non-array input', () => {
		expect(gaussianKDE(null)).toEqual({ x: [], density: [] });
		expect(gaussianKDE(undefined)).toEqual({ x: [], density: [] });
	});

	it('ignores null / NaN / Infinity values', () => {
		const withJunk = [1, null, 2, NaN, 3, Infinity, -Infinity, 4];
		const clean = [1, 2, 3, 4];
		const a = gaussianKDE(withJunk, { bandwidth: 0.5, gridSize: 40 });
		const b = gaussianKDE(clean, { bandwidth: 0.5, gridSize: 40 });
		expect(a.x).toEqual(b.x);
		expect(a.density).toEqual(b.density);
	});

	it('returns empty when auto bandwidth is undefined (single value)', () => {
		expect(gaussianKDE([7])).toEqual({ x: [], density: [] });
	});

	it('returns empty when auto bandwidth is 0 (identical values)', () => {
		expect(gaussianKDE([2, 2, 2, 2])).toEqual({ x: [], density: [] });
	});

	it('still estimates identical values when an explicit bandwidth is given', () => {
		// grid [-1, 5] with 61 points has a point exactly on x = 2 (the peak).
		const r = gaussianKDE([2, 2, 2, 2], { bandwidth: 1, gridSize: 61 });
		expect(r.x.length).toBe(61);
		const peakIdx = r.density.indexOf(Math.max(...r.density));
		expect(r.x[peakIdx]).toBeCloseTo(2, 6);
	});
});

describe('gaussianKDE — shape and normalisation', () => {
	it('honours gridSize (clamped to ≥2) and spans min−3h..max+3h', () => {
		const r = gaussianKDE([0, 10], { bandwidth: 2, gridSize: 100 });
		expect(r.x.length).toBe(100);
		expect(r.density.length).toBe(100);
		expect(r.x[0]).toBeCloseTo(0 - 3 * 2, 10);
		expect(r.x[r.x.length - 1]).toBeCloseTo(10 + 3 * 2, 10);
		expect(gaussianKDE([0, 1], { bandwidth: 1, gridSize: 1 }).x.length).toBe(2);
	});

	it('integrates to ≈1 (density is a proper pdf)', () => {
		const data = gaussianSample(400, 0, 1, 12345);
		const r = gaussianKDE(data, { gridSize: 512 });
		expect(integrate(r)).toBeCloseTo(1, 2);
	});

	it('a single delta approximates one kernel; grid captures ~3σ of its mass', () => {
		// The grid spans only ±3h, so a single narrow kernel integrates to the
		// 3-sigma normal coverage (≈0.9973), not exactly 1.
		const r = gaussianKDE([0, 0, 0, 0], { bandwidth: 1.5, gridSize: 1024 });
		expect(integrate(r)).toBeCloseTo(0.9973, 3);
	});
});

describe('gaussianKDE — recovers a known Gaussian', () => {
	it('tracks the true N(0,1) pdf near the centre', () => {
		const data = gaussianSample(2000, 0, 1, 987654);
		const r = gaussianKDE(data, { bandwidth: 0.3, gridSize: 401 });
		// Check a few interior grid points against the analytic pdf.
		for (const target of [-1, 0, 1]) {
			let best = 0;
			for (let i = 1; i < r.x.length; i++) {
				if (Math.abs(r.x[i] - target) < Math.abs(r.x[best] - target)) best = i;
			}
			expect(r.density[best]).toBeCloseTo(normalPdf(r.x[best]), 1);
		}
	});
});
