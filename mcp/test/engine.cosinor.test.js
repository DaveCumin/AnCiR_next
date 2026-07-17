import { describe, it, expect } from 'vitest';
import { AncirSession } from '../src/engine/session.js';

// Build a clean 24h-period cosine: y = MESOR + amp*cos(2π t / 24)
function makeCosine({ hours = 72, mesor = 10, amp = 5, period = 24 }) {
	const t = [];
	const y = [];
	for (let i = 0; i < hours; i++) {
		t.push(i);
		y.push(mesor + amp * Math.cos((2 * Math.PI * i) / period));
	}
	return { t, y };
}

describe('AncirSession — headless cosinor via real AnCiR engine', () => {
	it('imports columns and lists them', () => {
		const s = new AncirSession('t1');
		const { t, y } = makeCosine({});
		const [tc, yc] = s.importColumns([
			{ name: 'time_h', type: 'number', values: t },
			{ name: 'signal', type: 'number', values: y }
		]);
		const cols = s.listColumns();
		expect(cols).toHaveLength(2);
		expect(cols.find((c) => c.id === tc.id).length).toBe(t.length);
		expect(cols.find((c) => c.id === yc.id).name).toBe('signal');
	});

	it('recovers MESOR and amplitude from a fixed-period cosinor fit', async () => {
		const s = new AncirSession('t2');
		const { t, y } = makeCosine({ mesor: 10, amp: 5, period: 24 });
		const [tc, yc] = s.importColumns([
			{ name: 'time_h', type: 'number', values: t },
			{ name: 'signal', type: 'number', values: y }
		]);

		const fit = await s.runCosinor({ x: tc.id, y: yc.id, fixedPeriod: 24, nHarmonics: 1 });
		expect(fit.valid).toBe(true);
		expect(fit.results).toHaveLength(1);

		const r = fit.results[0];
		expect(r.valid).toBe(true);
		// Clean signal → near-perfect fit.
		expect(r.rSquared).toBeGreaterThan(0.99);
		expect(r.mesor).toBeCloseTo(10, 1);
		expect(r.harmonics[0].amplitude).toBeCloseTo(5, 1);
	});

	it('exports an AnCiR-compatible session object', () => {
		const s = new AncirSession('t3');
		const { t, y } = makeCosine({});
		s.importColumns([
			{ name: 'time_h', type: 'number', values: t },
			{ name: 'signal', type: 'number', values: y }
		]);

		const obj = s.exportSessionObject();
		// Shape that the AnCiR GUI's importer expects.
		expect(Array.isArray(obj.data)).toBe(true);
		expect(obj.data).toHaveLength(2);
		expect(obj.rawData).toBeTruthy();
		expect(obj.appState).toBeTruthy();
		expect(typeof obj.version).toBe('string');
	});
});
