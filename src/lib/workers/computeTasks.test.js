// @ts-nocheck
// src/lib/workers/computeTasks.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import {
	registerComputeTask,
	getComputeTask,
	listComputeTasks,
	_resetComputeTasks
} from './computeTasks.js';

describe('computeTasks registry', () => {
	beforeEach(() => _resetComputeTasks());

	it('registers and retrieves a task by name', () => {
		registerComputeTask('doubler', ({ x }) => ({ y: x.map((v) => v * 2) }));
		const task = getComputeTask('doubler');
		const result = task({ x: [1, 2, 3] });
		expect(result.y).toEqual([2, 4, 6]);
	});

	it('throws when retrieving an unregistered task', () => {
		expect(() => getComputeTask('missing')).toThrow(/missing/);
	});

	it('lists registered task names', () => {
		registerComputeTask('a', () => null);
		registerComputeTask('b', () => null);
		expect(listComputeTasks().sort()).toEqual(['a', 'b']);
	});

	it('throws when re-registering the same name', () => {
		registerComputeTask('once', () => null);
		expect(() => registerComputeTask('once', () => null)).toThrow(/already/);
	});
});
