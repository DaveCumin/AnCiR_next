// Dynamic-output processes now run with NO hand-written `out` (the server
// synthesises the per-input/per-param keys), and GroupComparison surfaces stats.
import { beforeAll, describe, expect, it } from 'vitest';
import { AncirSession, ensureRegistry } from '../src/engine/session.js';

const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));

beforeAll(async () => {
	await ensureRegistry();
});

function rhythmSession() {
	const s = new AncirSession('dyn');
	s.importColumns([
		{ name: 'x', values: seq(96, (i) => i) },
		{ name: 'y', values: seq(96, (i) => Math.cos((2 * Math.PI * i) / 24)) }
	]);
	return s;
}

describe('dynamic-output processes auto-seed their out keys', () => {
	it('RhythmicityAnalysis (periodogram) — no explicit out', async () => {
		const s = rhythmSession();
		const res = await s.runTableProcess('RhythmicityAnalysis', {
			xIN: 0,
			yIN: [1],
			analysis: 'periodogram',
			pgMethod: 'Lomb-Scargle',
			periodMin: 20,
			periodMax: 28,
			periodStep: 0.5,
			pgBinSize: 0.25,
			pgAlpha: 0.05
		});
		expect(res.valid).toBe(true);
		const keys = res.outputs.map((o) => o.key).sort();
		expect(keys).toEqual(['1_period', '1_power']);
	});

	it('Split — segment keys from splitTimes, no explicit out', async () => {
		const s = new AncirSession('dyn-split');
		s.importColumns([
			{ name: 'x', values: seq(50, (i) => i) },
			{ name: 'y', values: seq(50, (i) => i * 10) }
		]);
		const res = await s.runTableProcess('Split', { xIN: 0, yIN: [1], splitTimes: [15, 30] });
		expect(res.valid).toBe(true);
		// 2 split points → 3 segments per Y.
		expect(res.outputs.map((o) => o.key).sort()).toEqual(['1_1', '1_2', '1_3']);
	});

	it('CollectColumns — per-input col_<id> keys', async () => {
		const s = new AncirSession('dyn-collect');
		s.importColumns([
			{ name: 'a', values: seq(10, (i) => i) },
			{ name: 'b', values: seq(10, (i) => i * 2) }
		]);
		const res = await s.runTableProcess('CollectColumns', { colIds: [0, 1] });
		expect(res.valid).toBe(true);
		expect(res.outputs.map((o) => o.key).sort()).toEqual(['col_0', 'col_1']);
	});

	it('LongToWide — value_<category> keys from the category column data', async () => {
		const s = new AncirSession('dyn-l2w');
		s.importColumns([
			{ name: 'cat', type: 'category', values: seq(60, (i) => i % 3) },
			{ name: 'time', values: seq(60, (i) => Math.floor(i / 3)) },
			{ name: 'val', values: seq(60, (i) => (i % 3) * 100 + Math.floor(i / 3)) }
		]);
		const res = await s.runTableProcess('LongToWide', { categoryIN: 0, timeIN: 1, valueIN: 2 });
		expect(res.valid).toBe(true);
		const keys = res.outputs.map((o) => o.key).sort();
		expect(keys).toContain('time');
		expect(keys).toContain('value_0');
		expect(keys).toContain('value_2');
	});
});

describe('GroupComparison surfaces statistics (no output columns)', () => {
	it('returns a stats object with a test name and groups', async () => {
		const s = new AncirSession('gc');
		s.importColumns([
			{ name: 'group', type: 'category', values: seq(60, (i) => i % 3) },
			{ name: 'value', values: seq(60, (i) => (i % 3) * 5 + (i % 7)) }
		]);
		const res = await s.runTableProcess('GroupComparison', {
			xIN: 0,
			yIN: [1],
			method: 'auto',
			alpha: 0.05
		});
		expect(res.outputs.length).toBe(0);
		expect(res.stats).toBeTruthy();
		expect(res.stats.comparisons).toBeTruthy();
		const first = Object.values(res.stats.comparisons)[0];
		expect(typeof first.test).toBe('string');
		expect(first.groupCount).toBeGreaterThanOrEqual(2);
	});
});
