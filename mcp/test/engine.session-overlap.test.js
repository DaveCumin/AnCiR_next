// A call still running when another session is created (reviewer repro, 2026-11-09): session A
// started a Cosinor, session B was created while it awaited (emptying the store and restarting
// the id counters), B imported 40 columns, and A then wrote its outputs over B's columns and
// returned valid:true. Now creating B while A's call runs is refused, a superseded run throws
// rather than writing, and the MCP transports run calls one at a time (src/serial.js).
import { beforeAll, describe, expect, it } from 'vitest';
import { AncirSession, ensureRegistry } from '../src/engine/session.js';
import { createSerialQueue } from '../src/serial.js';

const T = Array.from({ length: 96 }, (_, i) => i);
const A = T.map((i) => 5 + 2 * Math.cos((2 * Math.PI * i) / 24));

beforeAll(async () => {
	await ensureRegistry();
});

describe('a session created while another session call is running', () => {
	it('is refused, and the running call completes on its own data', async () => {
		const a = new AncirSession('A');
		a.importColumns([
			{ name: 't', values: T },
			{ name: 'a', values: A }
		]);
		const pending = a.runTableProcess('Cosinor', {
			xIN: 't',
			yIN: ['a'],
			useFixedPeriod: true,
			fixedPeriod: 24
		});
		expect(() => new AncirSession('B')).toThrow(/session "A" is still running\. Await it first/);
		const res = await pending;
		expect(res.valid).toBe(true);
		expect(res.fit[1].mesor).toBeCloseTo(5, 6);

		// Once it has settled, a new session is fine and starts clean.
		const b = new AncirSession('B');
		const cols = Array.from({ length: 40 }, (_, k) => ({ name: 'b' + k, values: T.map(() => 7) }));
		b.importColumns(cols);
		for (const c of b.listColumns()) expect(b.getColumnData(c.id)).toEqual(T.map(() => 7));
	});

	it('a refused call does not count as running', async () => {
		const a = new AncirSession('A2');
		await expect(a.runTableProcess('NoSuchProcess', {})).rejects.toThrow(/Unknown table process/);
		expect(() => new AncirSession('B2')).not.toThrow();
	});
});

describe('createSerialQueue', () => {
	it('starts each call only after the previous one settled, failures included', async () => {
		const q = createSerialQueue();
		const log = [];
		const slow = q(async () => {
			log.push('a start');
			await new Promise((r) => setTimeout(r, 20));
			log.push('a end');
			throw new Error('a failed');
		});
		const next = q(() => {
			log.push('b');
			return 'b done';
		});
		await expect(slow).rejects.toThrow('a failed');
		expect(await next).toBe('b done');
		expect(log).toEqual(['a start', 'a end', 'b']);
	});
});
