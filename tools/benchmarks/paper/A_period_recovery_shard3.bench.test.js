// Study A, shard 3 of 6 (period recovery & detection). Gated: RUN_PAPER_BENCH=1.
// Output: results/raw/A_shard3.csv. Shards exist only so Vitest runs them in parallel.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { runShard } from './lib/runA.js';

const RUN = process.env.RUN_PAPER_BENCH === '1';
const OUT = path.join(
	path.dirname(new URL(import.meta.url).pathname),
	'results',
	'accuracy',
	'raw'
);
const REPS = process.env.PAPER_BENCH_REPS ? Number(process.env.PAPER_BENCH_REPS) : undefined;

describe.skipIf(!RUN)('A period recovery shard 3', () => {
	it('runs', () => {
		expect(runShard(3, 6, OUT, REPS)).toBeGreaterThan(0);
	});
});
