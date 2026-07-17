// node --test worker/report.test.js
//
// POST /report takes crash reports from the app. It is unauthenticated and anyone can POST
// anything, so the tests are about the caps and about what it refuses to carry.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';

const ENV = () => ({ ANCIR_BASE_URL: 'https://ancir.pages.dev' });

const post = (body, headers = {}) =>
	new Request('https://nl.example.com/report', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body)
	});

let lines;
let realLog;
beforeEach(() => {
	lines = [];
	realLog = console.log;
	console.log = (o) => lines.push(o);
});
afterEach(() => {
	console.log = realLog;
});
const entry = () => lines.find((l) => l?.event === 'client_error');

test('logs a crash report as a queryable event', async () => {
	const res = await worker.fetch(
		post({
			message: "Cannot read properties of undefined (reading '0')",
			stack: 'at get scale (Periodogram.svelte:1104)',
			source: 'render',
			context: 'rendering the periodogram plot',
			version: 'β.58.0',
			url: 'https://ancir.pages.dev/?loadFromURL=x',
			sessionShape: { columns: 12, analyses: 2, plots: 1 },
			generatedBy: { sessionId: 'abc-123', route: 'build' }
		}),
		ENV()
	);
	assert.equal(res.status, 200);
	assert.equal((await res.json()).ok, true);

	const e = entry();
	assert.ok(e, 'a client_error event was logged');
	assert.match(e.message, /Cannot read properties/);
	assert.equal(e.source, 'render');
	assert.equal(e.context, 'rendering the periodogram plot');
	assert.deepEqual(e.sessionShape, { columns: 12, analyses: 2, plots: 1 });
	// The join back to the prompt that built the session that crashed.
	assert.equal(e.generatedBy.sessionId, 'abc-123');
});

test('caps every field — this is unauthenticated input going into the logs', async () => {
	await worker.fetch(
		post({
			message: 'x'.repeat(5000),
			stack: 'y'.repeat(50_000),
			context: 'z'.repeat(5000),
			source: 's'.repeat(500)
		}),
		ENV()
	);
	const e = entry();
	assert.equal(e.message.length, 500);
	assert.equal(e.stack.length, 4000);
	assert.equal(e.context.length, 200);
	assert.equal(e.source.length, 50);
});

test('never carries the session itself, however hard the caller tries', async () => {
	await worker.fetch(
		post({
			message: 'boom',
			session: { rawData: { 0: [1, 2, 3] }, data: [{ name: 'secret-patient-id' }] },
			sessionShape: { columns: 1, analyses: 0, plots: 0 }
		}),
		ENV()
	);
	const blob = JSON.stringify(entry());
	assert.equal(blob.includes('secret-patient-id'), false);
	assert.equal(blob.includes('rawData'), false);
	assert.equal('session' in entry(), false);
});

test('a junk body is logged rather than crashing the route', async () => {
	const res = await worker.fetch(post({}), ENV());
	assert.equal(res.status, 200);
	assert.equal(entry().message, '(no message)');
	// Non-string / non-numeric junk degrades instead of propagating.
	await worker.fetch(post({ message: 42, sessionShape: 'nope', source: {} }), ENV());
	const e = lines.filter((l) => l?.event === 'client_error').pop();
	assert.equal(e.message, '(no message)');
	assert.deepEqual(e.sessionShape, { columns: 0, analyses: 0, plots: 0 });
});

test('non-JSON is rejected', async () => {
	const res = await worker.fetch(
		new Request('https://nl.example.com/report', { method: 'POST', body: 'not json' }),
		ENV()
	);
	assert.equal(res.status, 400);
});

test('a crash LOOP is throttled quietly — the client already told the user', async () => {
	const env = { ...ENV(), RATE_LIMITER: { limit: async () => ({ success: false }) } };
	const res = await worker.fetch(post({ message: 'looping' }), env);
	// 200, not 429: a failing report helps nobody, and the app must not retry.
	assert.equal(res.status, 200);
	assert.equal((await res.json()).throttled, true);
	assert.equal(entry(), undefined, 'nothing logged when throttled');
});
