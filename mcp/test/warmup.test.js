// Warm-up gate (src/warmup.js): tool calls made while the engine loads wait for it, with
// progress notifications, and past the limit get the "Just warming up the bots" message.
import { describe, expect, it } from 'vitest';
import { createWarmup, isColdStart, WARMING_MESSAGE } from '../src/warmup.js';

const deferred = () => {
	let resolve, reject;
	const promise = new Promise((ok, no) => {
		resolve = ok;
		reject = no;
	});
	return { promise, resolve, reject };
};
const handler = async (args) => ({ content: [{ type: 'text', text: `ran ${args.x}` }] });

describe('warm-up gate', () => {
	it("uses David's wording", () => {
		expect(WARMING_MESSAGE).toBe(
			'Just warming up the bots (first start after an update takes a minute or two). Try again shortly.'
		);
	});

	it('runs the handler straight away once ready', async () => {
		const w = createWarmup({ waitMs: 50 });
		await w.start(async () => {});
		expect(w.state).toBe('ready');
		expect(await w.gate(handler)({ x: 1 }, {})).toEqual({
			content: [{ type: 'text', text: 'ran 1' }]
		});
	});

	it('waits for a load that finishes within the limit, then runs the handler', async () => {
		const load = deferred();
		const w = createWarmup({ waitMs: 1000 });
		w.start(() => load.promise);
		const call = w.gate(handler)({ x: 2 }, {});
		setTimeout(() => load.resolve(), 30);
		expect(await call).toEqual({ content: [{ type: 'text', text: 'ran 2' }] });
	});

	it('returns the warming message (an error result) when still loading after the limit', async () => {
		const load = deferred();
		const w = createWarmup({ waitMs: 40 });
		w.start(() => load.promise);
		let ran = false;
		const res = await w.gate(async () => {
			ran = true;
		})({}, {});
		expect(ran).toBe(false);
		expect(res.isError).toBe(true);
		expect(res.content[0].text.startsWith(WARMING_MESSAGE)).toBe(true);
		expect(res.content[0].text).toMatch(/still loading after [\d.]+ s/);
		load.resolve();
		await w.done;
		expect(w.state).toBe('ready');
		expect((await w.gate(handler)({ x: 3 }, {})).content[0].text).toBe('ran 3');
	});

	it('sends progress notifications to a caller that sent a progressToken', async () => {
		const load = deferred();
		const w = createWarmup({ waitMs: 1000, progressMs: 10 });
		w.start(() => load.promise);
		const sent = [];
		const extra = {
			_meta: { progressToken: 'tok' },
			sendNotification: async (n) => {
				sent.push(n);
			}
		};
		const call = w.gate(handler)({ x: 4 }, extra);
		setTimeout(() => load.resolve(), 60);
		expect((await call).content[0].text).toBe('ran 4');
		expect(sent.length).toBeGreaterThan(0);
		expect(sent[0]).toMatchObject({
			method: 'notifications/progress',
			params: { progressToken: 'tok', message: WARMING_MESSAGE }
		});
		const n = sent.length;
		await new Promise((ok) => setTimeout(ok, 40));
		expect(sent.length, 'no progress after the call returns').toBe(n);
	});

	it('sends no progress without a progressToken', async () => {
		const load = deferred();
		const w = createWarmup({ waitMs: 1000, progressMs: 5 });
		w.start(() => load.promise);
		const sent = [];
		const call = w.gate(handler)({ x: 5 }, { sendNotification: async (n) => sent.push(n) });
		setTimeout(() => load.resolve(), 40);
		await call;
		expect(sent).toEqual([]);
	});

	it('reports a failed load in every call instead of the warming message', async () => {
		const w = createWarmup({ waitMs: 1000 });
		await expect(
			w.start(async () => {
				throw new Error('registry glob broke');
			})
		).rejects.toThrow('registry glob broke');
		expect(w.state).toBe('failed');
		const res = await w.gate(handler)({ x: 6 }, {});
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain('failed to load');
		expect(res.content[0].text).toContain('registry glob broke');
	});

	it('a call waiting when the load fails gets the failure', async () => {
		const load = deferred();
		const w = createWarmup({ waitMs: 1000 });
		w.start(() => load.promise).catch(() => {});
		const call = w.gate(handler)({}, {});
		setTimeout(() => load.reject(new Error('boom')), 20);
		expect((await call).content[0].text).toContain('boom');
	});

	it('starts only once', () => {
		const w = createWarmup();
		w.start(async () => {});
		expect(() => w.start(async () => {})).toThrow('already started');
	});
});

describe('cold-start stamp', () => {
	it('is cold without a stamp, with another version, or with an unreadable stamp', () => {
		expect(isColdStart(null, '82.65+0.0.3')).toBe(true);
		expect(isColdStart(JSON.stringify({ version: '82.64+0.0.3' }), '82.65+0.0.3')).toBe(true);
		expect(isColdStart('{not json', '82.65+0.0.3')).toBe(true);
	});
	it('is warm with a stamp of this version', () => {
		expect(
			isColdStart(JSON.stringify({ version: '82.65+0.0.3', readyMs: 5000 }), '82.65+0.0.3')
		).toBe(false);
	});
});
