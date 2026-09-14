import { describe, it, expect, vi } from 'vitest';

// processNodeWarnings resolves the process definition through the registry;
// give it a controlled one. (The real appConsts.processMap is filled by an
// async loader at app start — irrelevant to the contract under test.)
vi.mock('$lib/core/core.svelte.js', () => ({
	appConsts: {
		processMap: new Map([
			['WithHook', { definition: { getWarnings: (p) => [`warned about ${p.args.thing}`] } }],
			['WithoutHook', { definition: {} }],
			[
				'ThrowingHook',
				{
					definition: {
						getWarnings: () => {
							throw new Error('boom');
						}
					}
				}
			],
			['NullHook', { definition: { getWarnings: () => null } }]
		])
	}
}));

import { processNodeWarnings } from './processWarnings.js';

describe('processNodeWarnings — derived warnings channel for column-process nodes', () => {
	it('delegates to the definition getWarnings hook with the live process', () => {
		expect(processNodeWarnings({ name: 'WithHook', args: { thing: 'x<=0' } })).toEqual([
			'warned about x<=0'
		]);
	});

	it('returns [] for a null/undefined/unnamed process (non-process nodes)', () => {
		expect(processNodeWarnings(null)).toEqual([]);
		expect(processNodeWarnings(undefined)).toEqual([]);
		expect(processNodeWarnings({ args: {} })).toEqual([]);
	});

	it('returns [] when the definition has no hook or is not registered', () => {
		expect(processNodeWarnings({ name: 'WithoutHook', args: {} })).toEqual([]);
		expect(processNodeWarnings({ name: 'NotRegistered', args: {} })).toEqual([]);
	});

	it('a throwing hook renders as no warnings, never an error', () => {
		expect(processNodeWarnings({ name: 'ThrowingHook', args: {} })).toEqual([]);
	});

	it('a hook returning null coalesces to []', () => {
		expect(processNodeWarnings({ name: 'NullHook', args: {} })).toEqual([]);
	});
});
