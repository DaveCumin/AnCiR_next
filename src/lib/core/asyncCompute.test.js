// ROB-11: the shared guard for a node's deferred/async compute.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createComputeRunner, computeErrorMessage } from './asyncCompute.js';

function harness(memoHash = '') {
	const state = { busy: false, error: null, busyLog: [] };
	const memo = { hash: memoHash };
	const runner = createComputeRunner({
		memo,
		label: 'test',
		setBusy: (v) => {
			state.busy = v;
			state.busyLog.push(v);
		},
		setError: (m) => (state.error = m)
	});
	return { state, memo, runner };
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('createComputeRunner', () => {
	it('success: commits, records the hash, clears busy and any previous error', async () => {
		const { state, memo, runner } = harness();
		state.error = 'old';
		let got;
		const outcome = await runner.run(
			'h1',
			async () => 42,
			(v) => (got = v)
		);
		expect(outcome).toBe('ok');
		expect(got).toBe(42);
		expect(memo.hash).toBe('h1');
		expect(state.busy).toBe(false);
		expect(state.error).toBeNull();
	});

	it('failure: busy is cleared, the error is reported, the stale result is cleared, the claim released', async () => {
		// The node's effect claimed the hash before starting (computeMemo's two-instance rule).
		const { state, memo, runner } = harness('h1');
		const commit = vi.fn();
		const onError = vi.fn();
		const outcome = await runner.run(
			'h1',
			async () => {
				throw new RangeError('Invalid array length');
			},
			commit,
			onError
		);
		expect(outcome).toBe('error');
		expect(state.busy).toBe(false);
		expect(state.error).toBe('Invalid array length');
		expect(commit).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledTimes(1);
		// Released, so a remount (or the same inputs coming back) computes again.
		expect(memo.hash).toBe('');
	});

	it('a synchronous throw from work() is handled the same way', async () => {
		const { state, runner } = harness();
		const outcome = await runner.run(
			'h',
			() => {
				throw new Error('sync boom');
			},
			() => {}
		);
		expect(outcome).toBe('error');
		expect(state.busy).toBe(false);
		expect(state.error).toBe('sync boom');
	});

	it('a throw in commit() is a failure too, not a stuck spinner', async () => {
		const { state, memo, runner } = harness();
		const outcome = await runner.run(
			'h',
			async () => 1,
			() => {
				throw new Error('commit boom');
			}
		);
		expect(outcome).toBe('error');
		expect(state.busy).toBe(false);
		expect(memo.hash).toBe('');
	});

	it('the failure releases only its own claim, never a newer one', async () => {
		const { memo, runner } = harness('h1');
		const p = runner.run(
			'h1',
			async () => {
				memo.hash = 'h2'; // a newer input claimed meanwhile (by another instance)
				throw new Error('x');
			},
			() => {}
		);
		await p;
		expect(memo.hash).toBe('h2');
	});

	it('a superseded run does nothing: no commit, no error, no busy change', async () => {
		const { state, memo, runner } = harness();
		let release;
		const slow = runner.run(
			'old',
			() =>
				new Promise((_, rej) => {
					release = () => rej(new Error('late failure'));
				}),
			() => {
				throw new Error('must not commit');
			}
		);
		// Let the slow run actually start its work before superseding it.
		await new Promise((r) => setTimeout(r, 0));
		expect(typeof release).toBe('function');
		const fresh = runner.run(
			'new',
			async () => 'v',
			() => {}
		);
		await fresh;
		await new Promise((r) => setTimeout(r, 0));
		release();
		expect(await slow).toBe('stale');
		expect(state.error).toBeNull();
		expect(state.busy).toBe(false);
		expect(memo.hash).toBe('new');
	});

	it('the next run after a failure clears the error and succeeds (Retry)', async () => {
		const { state, runner } = harness();
		await runner.run(
			'h',
			() => Promise.reject(new Error('first')),
			() => {}
		);
		expect(state.error).toBe('first');
		const outcome = await runner.run(
			'h',
			async () => 1,
			() => {}
		);
		expect(outcome).toBe('ok');
		expect(state.error).toBeNull();
	});

	it('cancel() stops a run in flight and clears busy', async () => {
		const { state, runner } = harness();
		const commit = vi.fn();
		const p = runner.run('h', async () => 1, commit);
		runner.cancel();
		expect(state.busy).toBe(false);
		expect(await p).toBe('stale');
		expect(commit).not.toHaveBeenCalled();
	});
});

describe('the failure on the node card (node.warnings)', () => {
	it('adds the failure to node.warnings, keeps other warnings, and takes it back on the next run', async () => {
		const node = { warnings: ['non-normal data'] };
		const runner = createComputeRunner({ node });
		await runner.run(
			'h',
			() => Promise.reject(new Error('boom')),
			() => {}
		);
		expect(node.warnings).toEqual(['non-normal data', 'The analysis failed: boom']);
		await runner.run(
			'h',
			async () => 1,
			() => {}
		);
		expect(node.warnings).toEqual(['non-normal data']);
	});
});

describe('computeErrorMessage', () => {
	it('reads Errors, strings and odd values', () => {
		expect(computeErrorMessage(new Error('a'))).toBe('a');
		expect(computeErrorMessage('b')).toBe('b');
		expect(computeErrorMessage({ message: 'c' })).toBe('c');
		expect(computeErrorMessage(null)).toBe('Unknown error');
		expect(computeErrorMessage(7)).toBe('7');
	});
});
