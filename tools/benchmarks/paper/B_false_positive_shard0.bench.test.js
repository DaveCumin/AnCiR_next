// Study B, shard 0 of 4 (false-positive rate on rhythm-free noise). Gated: RUN_PAPER_BENCH=1.
// Output: results/accuracy/raw/B_shard0.csv. Shards exist only so Vitest runs them in parallel.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { runShardB } from './lib/runB.js';

const RUN = process.env.RUN_PAPER_BENCH === '1';
const OUT = path.join(
	path.dirname(new URL(import.meta.url).pathname),
	'results',
	'accuracy',
	'raw'
);
const REPS = process.env.PAPER_BENCH_REPS ? Number(process.env.PAPER_BENCH_REPS) : undefined;

describe.skipIf(!RUN)('B false positives shard 0', () => {
	it('runs', () => {
		expect(runShardB(0, 4, OUT, REPS)).toBeGreaterThan(0);
	});
});
