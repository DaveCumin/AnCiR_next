// @ts-nocheck
// Decision 2026-11-01: the Surrogate Test's block bootstrap uses 6 h blocks (a quarter of a
// daily cycle) instead of one 24 h cycle, for NEW nodes. Every creation path (the palette, the
// in-app AI edit, the MCP engine, the Worker's draft normalizer) reads the registry defaults, so
// the default itself is 6 h. A saved node keeps the length it stored; one with no length at
// all computes with the one-cycle block it always did (the compute fallback) and the node writes
// that length on mount so the setting shows it. The size and power numbers behind the choice
// are in utils/surrogates.blockPower.test.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { core, pushObj } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { buildTableProcessDefaults } from '$lib/core/tpDefaults.js';
import SurrogateTest, {
	surrogatetest,
	definition,
	NEW_NODE_BLOCK_HOURS,
	LEGACY_BLOCK_HOURS
} from './SurrogateTest.svelte';

const entry = { defaults: definition.defaults, definition };

function column(name, values) {
	const c = new Column({ type: 'number' });
	c.name = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	pushObj(c);
	return c.id;
}

function lcg(seed) {
	let s = seed;
	return () => {
		s = (1103515245 * s + 12345) % 2147483648;
		return s / 2147483648;
	};
}

/** A weak 24 h rhythm in noise, 10 hourly days: p depends on the block length. */
function series() {
	const rnd = lcg(11);
	const t = Array.from({ length: 240 }, (_, i) => i);
	const y = t.map((h) => 0.15 * Math.cos((2 * Math.PI * h) / 24) + (rnd() - 0.5) * 3);
	return { xIN: column('t', t), yIN: column('y', y) };
}

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
	core.tableProcesses = [];
});
afterEach(() => cleanup());

describe('Surrogate Test block length: 6 h for a new node, 24 h kept for a saved one', () => {
	it('a new node starts at a 6 h block; an explicit length still wins', () => {
		expect(NEW_NODE_BLOCK_HOURS).toBe(6);
		expect(buildTableProcessDefaults(entry).blockLengthHours).toBe(6);
		expect({ ...buildTableProcessDefaults(entry), blockLengthHours: 12 }.blockLengthHours).toBe(12);
	});

	it('the compute fallback is one cycle: an absent block length runs exactly as 24 h', () => {
		expect(LEGACY_BLOCK_HOURS).toBe(24);
		const base = {
			...series(),
			method: 'block',
			nSurrogates: 99,
			seed: 7,
			periodMin: 20,
			periodMax: 28,
			out: {}
		};
		const [absent] = surrogatetest({ ...base });
		const [cycle] = surrogatetest({ ...base, blockLengthHours: 24 });
		const [quarter] = surrogatetest({ ...base, blockLengthHours: 6 });
		expect(absent.pValue).toBe(cycle.pValue);
		// The block length reaches the bootstrap (the p differs between 6 h and 24 h blocks).
		expect(quarter.pValue).not.toBe(cycle.pValue);
	});

	it('a saved node with a 24 h block keeps it, and one with none shows 24 h', () => {
		const ins = series();
		const kept = { id: 901, args: { ...ins, method: 'block', blockLengthHours: 24, out: {} } };
		render(SurrogateTest, { props: { p: kept } });
		flushSync();
		expect(kept.args.blockLengthHours).toBe(24);
		cleanup();

		const bare = { id: 902, args: { ...ins, method: 'block', out: {} } };
		const { container } = render(SurrogateTest, { props: { p: bare } });
		flushSync();
		expect(bare.args.blockLengthHours).toBe(24);
		const shown = [...container.querySelectorAll('input')].map((i) => i.value);
		expect(shown).toContain('24');
	});
});
