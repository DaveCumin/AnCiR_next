// @ts-nocheck
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import NodeComputeHost, { computeTargets } from './NodeComputeHost.svelte';
import {
	claimComputeOwner,
	computeKey,
	computeOwnerCount,
	hasComputeOwner,
	_resetComputeOwners
} from '$lib/core/computeOwners.svelte.js';

// Which nodes the hidden compute host can cover. If this ever drops table processes,
// column processes (free or column-owned) or metric plots, those nodes go stale whenever
// they are not on screen (collapsed, hidden, unselected in the plots view).
describe('NodeComputeHost.computeTargets', () => {
	const state = {
		tableProcesses: [{ id: 0, name: 'Cosinor' }],
		orphanProcesses: [{ id: 3, name: 'Add' }],
		data: [{ id: 1, processes: [{ id: 4, name: 'Multiply' }] }, { id: 2 }],
		plots: [
			{ id: 7, type: 'periodogram' },
			{ id: 8, type: 'scatterplot' },
			{ id: 9, type: 'actogram', facet: true }
		]
	};

	it('lists table processes, free and column-owned processes, and metric plots', () => {
		expect(computeTargets(state).map((t) => t.key)).toEqual([
			'tableprocess_0',
			'process_3',
			'process_4',
			'plot_7',
			'plot_9'
		]);
	});

	it('leaves out plots without metric output ports', () => {
		expect(computeTargets(state).some((t) => t.key === 'plot_8')).toBe(false);
	});

	it('is read from core, so members of a collapsed composite are still listed', () => {
		// The projected canvas graph drops collapsed-composite members; core does not.
		const withComposite = {
			...state,
			composites: [{ collapsed: true, memberIds: ['tableprocess_0'] }]
		};
		expect(computeTargets(withComposite).map((t) => t.key)).toContain('tableprocess_0');
	});

	it('tolerates missing / empty input', () => {
		expect(computeTargets(undefined)).toEqual([]);
		expect(computeTargets({ tableProcesses: [null, {}], data: [null] })).toEqual([]);
	});

	it('exports a component', () => {
		expect(NodeComputeHost).toBeDefined();
	});
});

describe('compute-owner registry', () => {
	afterEach(() => _resetComputeOwners());

	it('keys by kind so table-process, process and plot ids cannot collide', () => {
		expect(computeKey('tableprocess', 1)).not.toBe(computeKey('process', 1));
		expect(computeKey('plot', null)).toBe(null);
	});

	it('counts claims, so releasing one of two visible instances keeps the node owned', () => {
		const a = claimComputeOwner('tableprocess_1');
		const b = claimComputeOwner('tableprocess_1');
		expect(computeOwnerCount('tableprocess_1')).toBe(2);
		a();
		flushSync();
		expect(hasComputeOwner('tableprocess_1')).toBe(true);
		b();
		expect(hasComputeOwner('tableprocess_1')).toBe(false);
	});

	it('a release is idempotent', () => {
		const a = claimComputeOwner('plot_2');
		claimComputeOwner('plot_2');
		a();
		a();
		expect(computeOwnerCount('plot_2')).toBe(1);
	});

	it('ignores a null key', () => {
		claimComputeOwner(null)();
		expect(computeOwnerCount(null)).toBe(0);
	});
});
