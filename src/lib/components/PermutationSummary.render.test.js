// The shared permutation readout (Cosinor, Rectangular wave, Double logistic) names how the
// null was built: a p from shuffled single values and one from one-period blocks are
// different tests (review finding FIT-5), and the readout used to show neither.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import PermutationSummary from './PermutationSummary.svelte';
import { attachPermutation } from '$lib/tableProcesses/permutationSupport.js';

afterEach(() => cleanup());

/** @param {object} [over] */
const perm = (over) => ({
	pValue: 0.03,
	significant: true,
	observedStat: 0.5,
	permutedStats: [0.1, 0.2],
	statistic: 'rSquared',
	...over
});

describe('PermutationSummary', () => {
	it('names the shuffle scheme', () => {
		const { container } = render(PermutationSummary, {
			props: {
				entries: [{ name: 'a', result: attachPermutation({}, perm({ scheme: 'shuffle' })) }],
				nodeId: 1,
				label: 'Cosinor'
			}
		});
		expect(container.textContent).toMatch(/over 2 permutations \(single values shuffled\)/);
	});

	it('names the block scheme and its block length', () => {
		const { container } = render(PermutationSummary, {
			props: {
				entries: [
					{
						name: 'a',
						result: attachPermutation({}, perm({ scheme: 'block', blockLength: 24 }))
					}
				],
				nodeId: 1,
				label: 'Cosinor'
			}
		});
		expect(container.textContent).toMatch(/\(one-period blocks of 24 samples\)/);
	});
});
