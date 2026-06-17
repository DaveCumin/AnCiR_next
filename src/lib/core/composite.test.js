import { describe, it, expect } from 'vitest';
import { computeInterface, flattenMembers, nestedCompositeIds } from './composite.js';

describe('flattenMembers / nestedCompositeIds', () => {
	const composites = [
		{ id: 'composite_1', memberIds: ['process_1', 'composite_2'] },
		{ id: 'composite_2', memberIds: ['tableprocess_3', 'process_4'] }
	];
	it('flattens nested composites to leaf node ids', () => {
		expect(flattenMembers(['composite_1'], composites)).toEqual([
			'process_1',
			'tableprocess_3',
			'process_4'
		]);
	});
	it('passes through plain leaf members', () => {
		expect(flattenMembers(['process_9', 'tableprocess_8'], composites)).toEqual([
			'process_9',
			'tableprocess_8'
		]);
	});
	it('collects nested composite ids transitively', () => {
		expect(nestedCompositeIds(['composite_1', 'process_9'], composites)).toEqual([
			'composite_1',
			'composite_2'
		]);
	});
});

const members = ['tableprocess_1'];
const conns = [
	{ fromId: 'data_5', fromPort: 'column', toId: 'tableprocess_1', toPort: 'xIN' },
	{ fromId: 'data_6', fromPort: 'column', toId: 'tableprocess_1', toPort: 'yIN' },
	{ fromId: 'tableprocess_1', fromPort: 'col_9', toId: 'plot_2', toPort: 'y1' },
	{ fromId: 'tableprocess_1', fromPort: 'col_9', toId: 'plot_3', toPort: 'y1' }, // 2nd consumer, same port
	{ fromId: 'process_8', fromPort: 'output', toId: 'process_9', toPort: 'input' } // unrelated
];

describe('computeInterface', () => {
	it('finds external inputs (deduped by member+port)', () => {
		const { inputs } = computeInterface(members, conns);
		expect(inputs.map((p) => `${p.member}|${p.port}`).sort()).toEqual([
			'tableprocess_1|xIN',
			'tableprocess_1|yIN'
		]);
	});

	it('finds external outputs, deduped across multiple consumers', () => {
		const { outputs } = computeInterface(members, conns);
		expect(outputs.map((p) => `${p.member}|${p.port}`)).toEqual(['tableprocess_1|col_9']);
	});

	it('ignores internal member<->member edges', () => {
		const m = ['process_3', 'tableprocess_1'];
		const c = [{ fromId: 'process_3', fromPort: 'output', toId: 'tableprocess_1', toPort: 'xIN' }];
		const { inputs, outputs } = computeInterface(m, c);
		expect(inputs).toEqual([]);
		expect(outputs).toEqual([]);
	});

	it('assigns stable unique ids and default names', () => {
		const { inputs } = computeInterface(members, conns);
		const x = inputs.find((p) => p.port === 'xIN');
		expect(x.id).toBe('in:tableprocess_1|xIN');
		expect(x.name).toBe('xIN');
	});

	it('accepts a Set or an array of member ids', () => {
		const a = computeInterface(new Set(members), conns);
		const b = computeInterface(members, conns);
		expect(a).toEqual(b);
	});
});
