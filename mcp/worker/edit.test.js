// node --test worker/edit.test.js
//
// POST /edit proposes changes to a session that lives in someone's BROWSER. This Worker never
// sees it and never stores anything — it returns a spec the client compiles and validates. So
// what matters here is the contract at the edges: what it accepts, what it refuses, and that
// the prompt actually tells the model what's on screen.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';
import { buildEditPrompt, renderSummary } from './editPrompt.js';

const ENV = () => ({ ANCIR_BASE_URL: 'https://ancir.pages.dev' });
const LLM = { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini' };

const SESSION = {
	columns: [
		{ id: 0, name: 'time', type: 'time' },
		{ id: 1, name: 'activity', type: 'number' }
	],
	analyses: [{ id: 3, name: 'Cosinor', args: { xIN: 0, yIN: [1] } }],
	plots: []
};

const post = (body) =>
	new Request('https://nl.example.com/edit', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});

let realFetch;
let lastRequest;
function stubLLM(content, { status = 200 } = {}) {
	globalThis.fetch = async (_url, init) => {
		lastRequest = JSON.parse(init.body);
		return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	};
}
beforeEach(() => {
	realFetch = globalThis.fetch;
	lastRequest = null;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

test('the edit prompt shows the model what is actually on screen', () => {
	const p = buildEditPrompt(SESSION);
	assert.match(p, /COLUMNS[\s\S]*time {2}\(time\)/);
	assert.match(p, /activity {2}\(number\)/);
	assert.match(p, /#3 Cosinor/);
	// It must carry the same registry catalogue the build path uses — that's the whole reason
	// the model is any good at this vocabulary.
	assert.match(p, /fitted curve: x=cosinorx, y=cosinory_/);
	// And the rules that keep an edit an edit.
	assert.match(p, /cannot delete/i);
	assert.match(p, /<prefix><the Y column's NAME>/);
});

test('renderSummary says "(none)" rather than nothing for an empty session', () => {
	const s = renderSummary({});
	assert.match(s, /COLUMNS[\s\S]*\(none\)/);
	assert.match(s, /ANALYSES[\s\S]*\(none\)/);
});

test('POST /edit returns the spec — no session is built or stored', async () => {
	stubLLM(
		JSON.stringify({
			analyses: [{ name: 'Periodogram', args: { xIN: 'time', yIN: ['activity'] } }],
			plots: [{ type: 'periodogram', series: [{ time: 'pgx', values: 'pgy' }] }]
		})
	);
	const res = await worker.fetch(post({ prompt: 'add a periodogram', llm: LLM, session: SESSION }), ENV());
	assert.equal(res.status, 200);
	const out = await res.json();
	assert.equal(out.analyses[0].name, 'Periodogram');
	assert.equal(out.plots[0].type, 'periodogram');
	assert.deepEqual(out.changes, []);
	// No link, no session id: this route mutates nothing.
	assert.equal('url' in out, false);
	assert.equal('sessionId' in out, false);

	// The session summary reached the model.
	assert.match(lastRequest.messages[0].content, /activity/);
	assert.equal(lastRequest.messages[1].content, 'add a periodogram');
});

test('a parameter change round-trips', async () => {
	stubLLM(JSON.stringify({ changes: [{ analysis: 3, set: { fixedPeriod: 12 } }] }));
	const res = await worker.fetch(post({ prompt: 'use a 12h period', llm: LLM, session: SESSION }), ENV());
	assert.equal(res.status, 200);
	assert.deepEqual((await res.json()).changes, [{ analysis: 3, set: { fixedPeriod: 12 } }]);
});

test('the prompt teaches shading, and only for the plots that support it', () => {
	const p = buildEditPrompt(SESSION);
	assert.match(p, /"bands":\s+\[ \{ "plot": 2, "fromHour": 18, "toHour": 6/);
	assert.match(p, /CLOCK HOURS/);
	// Registry-derived, so a plot that gains bands is advertised without editing a list.
	assert.match(p, /PLOTS THAT SUPPORT "bands" \(shading\): scatterplot/);
	// The model must not be invited to give an absolute time — on a time axis the stored field
	// is an epoch-ms, and 18 would put the band 18 ms after 1970. The client converts.
	assert.match(p, /Do not try to give a date, a timestamp, or a duration/);
});

test('a shading request round-trips', async () => {
	stubLLM(JSON.stringify({ bands: [{ plot: 2, fromHour: 18, toHour: 6, label: 'Night' }] }));
	const res = await worker.fetch(
		post({ prompt: 'shade 6pm to 6am on the scatterplot', llm: LLM, session: SESSION }),
		ENV()
	);
	assert.equal(res.status, 200);
	const out = await res.json();
	assert.deepEqual(out.bands, [{ plot: 2, fromHour: 18, toHour: 6, label: 'Night' }]);
	// A bands-only reply is a real edit, not an empty one.
	assert.deepEqual(out.analyses, []);
});

test('an empty proposal is reported, not returned as a silent no-op', async () => {
	// What a model correctly returns when asked to delete something.
	stubLLM('{}');
	const res = await worker.fetch(post({ prompt: 'delete the cosinor', llm: LLM, session: SESSION }), ENV());
	assert.equal(res.status, 422);
	const out = await res.json();
	assert.match(out.error, /can't delete/i);
});

test('junk from the model is rejected rather than passed to the client', async () => {
	stubLLM('I think you should add a periodogram!');
	const res = await worker.fetch(post({ prompt: 'add one', llm: LLM, session: SESSION }), ENV());
	assert.equal(res.status, 502);
	assert.match((await res.json()).error, /could not parse/);
});

test('a non-array analyses field cannot crash the route', async () => {
	stubLLM(JSON.stringify({ analyses: 'Cosinor', plots: { type: 'nope' } }));
	const res = await worker.fetch(post({ prompt: 'x', llm: LLM, session: SESSION }), ENV());
	// Nothing usable ⇒ the empty-edit path, not a 500.
	assert.equal(res.status, 422);
});

test('the session summary is validated: structure only, and capped', async () => {
	stubLLM(JSON.stringify({ analyses: [] }));
	// rawData has no business here — a strict schema rejects it rather than forwarding it.
	const withData = await worker.fetch(
		post({ prompt: 'x', llm: LLM, session: { ...SESSION, rawData: { 0: [1, 2, 3] } } }),
		ENV()
	);
	assert.equal(withData.status, 400);

	const tooMany = await worker.fetch(
		post({
			prompt: 'x',
			llm: LLM,
			session: { columns: Array.from({ length: 501 }, (_, i) => ({ id: i, name: `c${i}` })) }
		}),
		ENV()
	);
	assert.equal(tooMany.status, 400);
});

test('/edit rejects a bad body and a non-https endpoint, like /build', async () => {
	stubLLM('{}');
	const noPrompt = await worker.fetch(post({ llm: LLM, session: SESSION }), ENV());
	assert.equal(noPrompt.status, 400);

	const ssrf = await worker.fetch(
		post({ prompt: 'x', llm: { ...LLM, baseUrl: 'http://169.254.169.254/v1' }, session: SESSION }),
		ENV()
	);
	assert.equal(ssrf.status, 400);
});

test('/edit honours the rate limiter', async () => {
	stubLLM(JSON.stringify({ analyses: [{ name: 'Cosinor' }] }));
	const env = { ...ENV(), RATE_LIMITER: { limit: async () => ({ success: false }) } };
	const res = await worker.fetch(post({ prompt: 'x', llm: LLM, session: SESSION }), env);
	assert.equal(res.status, 429);
	assert.equal(res.headers.get('Retry-After'), '60');
});

test('logs the edit prompt and the shape of what was edited, never the key', async () => {
	const lines = [];
	const realLog = console.log;
	console.log = (o) => lines.push(o);
	try {
		stubLLM(JSON.stringify({ analyses: [{ name: 'Cosinor', args: {} }] }));
		await worker.fetch(post({ prompt: 'fit a cosinor', llm: LLM, session: SESSION }), ENV());
	} finally {
		console.log = realLog;
	}
	const entry = lines.find((l) => l?.event === 'edit');
	assert.ok(entry, 'an edit event was logged');
	assert.equal(entry.prompt, 'fit a cosinor');
	assert.equal(entry.outcome, 'ok');
	assert.equal(entry.llmKeySource, 'caller');
	// The shape of the session, not its contents.
	assert.deepEqual(entry.sessionSize, { columns: 2, analyses: 1, plots: 0 });
	assert.equal(JSON.stringify(entry).includes(LLM.apiKey), false, 'never the api key');
});
