/* global $state, $effect */
import { describe, it, expect, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import {
	registerNodeResultTables,
	useNodeResultTables,
	readNodeResultTable,
	listNodeResultTables,
	nodeResultTableTitle,
	publishingNodeIds,
	clearNodeResultTables,
	readNodeResultOutputs
} from './nodeResultTables.svelte.js';
import { resetSession } from './sessionLoad.svelte.js';

beforeEach(() => clearNodeResultTables());

const table = (headers, rows) => ({ headers, rows });

describe('node result tables registry', () => {
	it('reads a registered table and lists it', () => {
		registerNodeResultTables('tableprocess_1', {
			stats: { title: 'Cosinor stats', get: () => table(['a'], [[1]]) }
		});
		expect(readNodeResultTable('tableprocess_1', 'stats')).toEqual(table(['a'], [[1]]));
		expect(listNodeResultTables('tableprocess_1')).toEqual([
			{ key: 'stats', title: 'Cosinor stats' }
		]);
		expect(nodeResultTableTitle('tableprocess_1', 'stats')).toBe('Cosinor stats');
		expect(publishingNodeIds()).toEqual(['tableprocess_1']);
	});

	it('answers null for an unknown node, an unknown key, or a provider with no result yet', () => {
		registerNodeResultTables('tableprocess_1', {
			stats: { title: 'S', get: () => table([], []) }
		});
		expect(readNodeResultTable('tableprocess_2', 'stats')).toBeNull();
		expect(readNodeResultTable('tableprocess_1', 'permutations')).toBeNull();
		expect(readNodeResultTable('tableprocess_1', 'stats')).toBeNull();
	});

	it('a getter that throws is skipped, not propagated', () => {
		const warn = console.warn;
		console.warn = () => {};
		try {
			registerNodeResultTables('tableprocess_1', {
				stats: {
					title: 'S',
					get: () => {
						throw new Error('boom');
					}
				}
			});
			expect(readNodeResultTable('tableprocess_1', 'stats')).toBeNull();
		} finally {
			console.warn = warn;
		}
	});

	it('two instances of one node: either answers, and unmounting one keeps the other', () => {
		const offA = registerNodeResultTables('tableprocess_1', {
			stats: { title: 'S', get: () => table([], []) } // not computed yet
		});
		const offB = registerNodeResultTables('tableprocess_1', {
			stats: { title: 'S', get: () => table(['b'], [[2]]) }
		});
		// The instance with a result answers even though it registered second.
		expect(readNodeResultTable('tableprocess_1', 'stats')).toEqual(table(['b'], [[2]]));
		offA();
		expect(readNodeResultTable('tableprocess_1', 'stats')).toEqual(table(['b'], [[2]]));
		offB();
		expect(readNodeResultTable('tableprocess_1', 'stats')).toBeNull();
		expect(publishingNodeIds()).toEqual([]);
	});

	it('a reader re-runs when a provider registers, updates, and goes away', () => {
		let rows = $state([[1]]);
		const seen = [];
		const stop = $effect.root(() => {
			$effect(() => {
				seen.push(readNodeResultTable('tableprocess_1', 'stats')?.rows ?? null);
			});
		});
		flushSync();
		expect(seen).toEqual([null]);
		const off = registerNodeResultTables('tableprocess_1', {
			stats: { title: 'S', get: () => table(['a'], rows) }
		});
		flushSync();
		expect(seen.at(-1)).toEqual([[1]]);
		rows = [[1], [2]];
		flushSync();
		expect(seen.at(-1)).toEqual([[1], [2]]);
		off();
		flushSync();
		expect(seen.at(-1)).toBeNull();
		stop();
	});

	it('the hook registers on mount and unregisters on teardown', () => {
		const stop = $effect.root(() => {
			useNodeResultTables(() => 'tableprocess_9', {
				permutations: { title: 'P', get: () => table(['x'], [[0]]) }
			});
		});
		flushSync();
		expect(readNodeResultTable('tableprocess_9', 'permutations')).toEqual(table(['x'], [[0]]));
		stop();
		expect(readNodeResultTable('tableprocess_9', 'permutations')).toBeNull();
	});

	it('resetSession clears every registration', () => {
		registerNodeResultTables('tableprocess_1', {
			stats: { title: 'S', get: () => table(['a'], []) }
		});
		resetSession();
		expect(publishingNodeIds()).toEqual([]);
	});

	it('declared outputs: the list when a node publishes the table, null when nobody does', () => {
		const outputs = [
			{ key: 'series', type: 'category' },
			{ key: 'permuted_statistic', type: 'number' }
		];
		registerNodeResultTables('tableprocess_1', {
			stats: { title: 'S', get: () => table(['a'], []) },
			// Declared whether or not a result exists yet: ports must not wait for a run.
			permutations: { title: 'P', get: () => null, outputs }
		});
		expect(readNodeResultOutputs('tableprocess_1', 'permutations')).toEqual(
			outputs.map((o) => ({ ...o, label: o.key }))
		);
		// A table published without outputs declares none (an empty list, not "unknown").
		expect(readNodeResultOutputs('tableprocess_1', 'stats')).toEqual([]);
		// Nobody publishes it (node gone, not mounted yet, unknown key): unknown.
		expect(readNodeResultOutputs('tableprocess_1', 'posthoc')).toBeNull();
		expect(readNodeResultOutputs('tableprocess_2', 'permutations')).toBeNull();
		expect(readNodeResultOutputs(null, 'permutations')).toBeNull();
		expect(readNodeResultOutputs('tableprocess_1', null)).toBeNull();
	});

	it('declared outputs are copies, normalised, and drop malformed entries', () => {
		const outputs = [{ key: 'a', type: 'category', label: 'A' }, { key: 'b' }, { type: 'x' }, null];
		registerNodeResultTables('tableprocess_1', { t: { title: 'T', get: () => null, outputs } });
		const got = readNodeResultOutputs('tableprocess_1', 't');
		expect(got).toEqual([
			{ key: 'a', type: 'category', label: 'A' },
			{ key: 'b', type: 'number', label: 'b' }
		]);
		got[0].key = 'changed';
		expect(outputs[0].key).toBe('a');
	});
});
