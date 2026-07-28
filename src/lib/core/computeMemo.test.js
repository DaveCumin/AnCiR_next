// The memo must skip work that is genuinely unchanged, and must NOT skip work
// that changed. The second half matters as much as the first: a memo that always
// reported a hit would make every "did it skip?" test pass while quietly serving
// stale results, which is exactly the failure this change risks.
import { describe, it, expect, beforeEach } from 'vitest';
import {
	nodeMemo,
	memoForget,
	memoClear,
	_memoSize,
	_setMemoEnabled,
	_computeCount,
	_resetComputeCount
} from './computeMemo.js';

const tp = (id, name = 'Cosinor') => ({ id, name });

beforeEach(() => {
	memoClear();
	_setMemoEnabled(true);
});

/**
 * The guard every node's $effect performs, so the tests assert the real
 * condition rather than the cache internals.
 */
function wouldCompute(memo, hash) {
	return memo.hash !== hash;
}

describe('the memo behaves like lastHash, but outlives the component', () => {
	it('a fresh node computes', () => {
		expect(wouldCompute(nodeMemo(tp(1), 'tableprocess'), 'h1')).toBe(true);
	});

	it('a REMOUNTED node with unchanged inputs does not compute', () => {
		// This is the whole point: two separate nodeMemo() calls stand in for the
		// component being destroyed and rebuilt by the view switch.
		const first = nodeMemo(tp(1), 'tableprocess');
		first.hash = 'h1';
		const remounted = nodeMemo(tp(1), 'tableprocess');
		expect(wouldCompute(remounted, 'h1')).toBe(false);
	});

	it('a remounted node whose inputs CHANGED does compute', () => {
		const first = nodeMemo(tp(1), 'tableprocess');
		first.hash = 'h1';
		const remounted = nodeMemo(tp(1), 'tableprocess');
		expect(wouldCompute(remounted, 'h2')).toBe(true);
	});
});

describe('transient payload', () => {
	it('survives a remount so a stats panel can rehydrate without recomputing', () => {
		// Cosinor / the fit nodes keep MESOR, amplitude, R², CIs only in component
		// state. Skipping the recompute without this would blank their panels.
		const first = nodeMemo(tp(1), 'tableprocess');
		first.hash = 'h1';
		first.payload = { mesor: 4.2 };
		expect(nodeMemo(tp(1), 'tableprocess').payload).toEqual({ mesor: 4.2 });
	});

	it('is undefined for a node that never stored one', () => {
		nodeMemo(tp(1), 'tableprocess').hash = 'h1';
		expect(nodeMemo(tp(1), 'tableprocess').payload).toBeUndefined();
	});

	it('can be set before any hash without losing the hash later', () => {
		const m = nodeMemo(tp(1), 'tableprocess');
		m.payload = 'p';
		m.hash = 'h1';
		const again = nodeMemo(tp(1), 'tableprocess');
		expect(again.payload).toBe('p');
		expect(again.hash).toBe('h1');
	});
});

describe('identity', () => {
	it('separates nodes by id', () => {
		nodeMemo(tp(1), 'tableprocess').hash = 'h1';
		expect(wouldCompute(nodeMemo(tp(2), 'tableprocess'), 'h1')).toBe(true);
	});

	it('separates table-processes from column-processes sharing an id', () => {
		// Both kinds number from 1 independently, so kind must be part of the key.
		nodeMemo(tp(1), 'tableprocess').hash = 'h1';
		expect(wouldCompute(nodeMemo(tp(1), 'process'), 'h1')).toBe(true);
	});

	it('an id-less node never caches, rather than sharing one bucket', () => {
		const m = nodeMemo({ name: 'X' }, 'tableprocess');
		m.hash = 'h1';
		expect(_memoSize()).toBe(0);
		expect(wouldCompute(nodeMemo({ name: 'X' }, 'tableprocess'), 'h1')).toBe(true);
	});
});

describe('the compute metric counts work, not bookkeeping', () => {
	// This measures the change it is meant to prove, so a false positive here
	// sends you hunting a performance bug that does not exist. It did: four nodes
	// (Split, SmoothedData, LongToWide, CollectColumns) re-pin their unchanged
	// hash on every mount to say "the baked data is still current", and counting
	// that as a compute made each remount look like a full recompute. Logging
	// inside Split showed its compute effect never fired at all.
	beforeEach(() => _resetComputeCount());

	it('counts a hash that actually changed', () => {
		const m = nodeMemo({ id: 1, name: 'Split' }, 'tableprocess');
		m.hash = 'h1';
		expect(_computeCount()).toBe(1);
	});

	it('does NOT count a remount re-pinning the same hash', () => {
		nodeMemo({ id: 1, name: 'Split' }, 'tableprocess').hash = 'h1';
		_resetComputeCount();
		// A fresh handle for the same node is exactly what a remount produces.
		nodeMemo({ id: 1, name: 'Split' }, 'tableprocess').hash = 'h1';
		expect(_computeCount()).toBe(0);
	});

	it('does NOT double-count one run that marks the hash twice', () => {
		// The effect claims the hash before dispatching; the compute function
		// records it again on completion. That is one compute, not two.
		const m = nodeMemo({ id: 1, name: 'Cosinor' }, 'tableprocess');
		m.hash = 'h1';
		m.hash = 'h1';
		expect(_computeCount()).toBe(1);
	});

	it('counts again once the inputs really change', () => {
		const m = nodeMemo({ id: 1, name: 'Cosinor' }, 'tableprocess');
		m.hash = 'h1';
		_resetComputeCount();
		m.hash = 'h2';
		expect(_computeCount()).toBe(1);
	});
});

describe('a write is always readable back from the same handle', () => {
	// The termination condition for every node's $effect. A compute writes output
	// columns, which changes the input hash of anything downstream and re-fires the
	// effect; the ONLY thing that stops it re-running forever is reading back the
	// hash it just recorded. An early version returned a constant '' whenever the
	// cache was unavailable, which spun the whole pipeline until the tab died.
	for (const [label, node] of [
		['a normal node', () => ({ id: 1, name: 'Cosinor' })],
		['a node with no id', () => ({ name: 'Cosinor' })]
	]) {
		it(`${label}, memo on`, () => {
			_setMemoEnabled(true);
			const m = nodeMemo(node(), 'tableprocess');
			m.hash = 'h1';
			expect(m.hash).toBe('h1');
		});

		it(`${label}, memo off`, () => {
			_setMemoEnabled(false);
			const m = nodeMemo(node(), 'tableprocess');
			m.hash = 'h1';
			expect(m.hash).toBe('h1');
		});
	}
});

describe('invalidation', () => {
	it('forget drops one node and leaves the rest', () => {
		nodeMemo(tp(1), 'tableprocess').hash = 'h1';
		nodeMemo(tp(2), 'tableprocess').hash = 'h1';
		memoForget(tp(1), 'tableprocess');
		expect(wouldCompute(nodeMemo(tp(1), 'tableprocess'), 'h1')).toBe(true);
		expect(wouldCompute(nodeMemo(tp(2), 'tableprocess'), 'h1')).toBe(false);
	});

	it('clear drops everything', () => {
		// Session import restarts node ids at 1. Without this, loading session B
		// would serve session A's cached results to unrelated nodes.
		nodeMemo(tp(1), 'tableprocess').hash = 'h1';
		nodeMemo(tp(1), 'tableprocess').payload = { mesor: 1 };
		memoClear();
		expect(_memoSize()).toBe(0);
		expect(wouldCompute(nodeMemo(tp(1), 'tableprocess'), 'h1')).toBe(true);
		expect(nodeMemo(tp(1), 'tableprocess').payload).toBeUndefined();
	});
});

describe('the A/B switch reproduces the unmemoised behaviour exactly', () => {
	it('always recomputes and never rehydrates while disabled', () => {
		const m = nodeMemo(tp(1), 'tableprocess');
		m.hash = 'h1';
		m.payload = { mesor: 4.2 };
		_setMemoEnabled(false);
		const off = nodeMemo(tp(1), 'tableprocess');
		expect(wouldCompute(off, 'h1')).toBe(true);
		expect(off.payload).toBeUndefined();
		_setMemoEnabled(true);
		expect(wouldCompute(nodeMemo(tp(1), 'tableprocess'), 'h1')).toBe(false);
	});
});
