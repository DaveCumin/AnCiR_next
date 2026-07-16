// node --test worker/worker.test.js
//
// Drives the Worker's fetch handler directly with a fake KV + a stubbed upstream LLM, so the
// whole NL→session path is covered without deploying or calling a real model.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { extractDraft } from './index.js';
import { buildDraftPrompt } from './draftPrompt.js';

/** Minimal KV stand-in (get/put with the bits the worker uses). */
const fakeKV = () => {
	const m = new Map();
	return {
		_m: m,
		async get(k) {
			return m.has(k) ? m.get(k) : null;
		},
		async put(k, v) {
			m.set(k, v);
		}
	};
};

const ENV = () => ({ SESSIONS: fakeKV(), ANCIR_BASE_URL: 'https://ancir.pages.dev' });

const post = (body) =>
	new Request('https://nl.example.com/build', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});

const LLM = { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini' };

/** Stub the upstream chat/completions call with a canned assistant reply. */
let realFetch;
function stubLLM(content, { status = 200 } = {}) {
	globalThis.fetch = async () =>
		new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});
}
beforeEach(() => {
	realFetch = globalThis.fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

// ---- extractDraft ----

test('extractDraft handles bare JSON, a ```json fence, and surrounding prose', () => {
	const want = { analyses: [{ name: 'SimulatedData', args: {} }] };
	assert.deepEqual(extractDraft(JSON.stringify(want)), want);
	assert.deepEqual(extractDraft('```json\n' + JSON.stringify(want) + '\n```'), want);
	assert.deepEqual(extractDraft(`Sure! Here you go:\n${JSON.stringify(want)}\nHope that helps.`), want);
});

test('extractDraft rejects empty / non-object replies', () => {
	assert.throws(() => extractDraft(''), /empty/);
	assert.throws(() => extractDraft('no json here'), /did not return a JSON object/);
	assert.throws(() => extractDraft('[1,2,3]'), /did not return a JSON object/);
});

// ---- prompt ----

test('draft prompt is registry-derived and states the contract', () => {
	const p = buildDraftPrompt();
	assert.match(p, /ONLY the JSON object/);
	assert.match(p, /Cosinor: args=/, 'catalogue comes from the generated schema');
	assert.match(p, /produces: cosinorx/, 'lists output names so the model can wire plots');
	assert.match(p, /scatterplot\[x,y\]/, 'plot inputs are registry-derived');
});

// ---- routes ----

test('GET /health', async () => {
	const res = await worker.fetch(new Request('https://nl.example.com/health'), ENV());
	assert.equal(res.status, 200);
	assert.deepEqual(await res.json(), { ok: true });
});

test('POST /build rejects an invalid body', async () => {
	// missing key → zod's own "Required"; present-but-blank → our min() message
	const missing = await worker.fetch(post({}), ENV());
	assert.equal(missing.status, 400);
	assert.match((await missing.json()).error, /prompt: Required/);

	const blank = await worker.fetch(post({ prompt: '   ' }), ENV());
	assert.equal(blank.status, 400);
	assert.match((await blank.json()).error, /prompt is required/);

	// the schema is strict: typos are rejected rather than silently ignored
	const typo = await worker.fetch(post({ prompt: 'hi', modle: 'x' }), ENV());
	assert.equal(typo.status, 400);
	assert.match((await typo.json()).error, /Unrecognized key/);
});

test('POST /build rejects a non-JSON body', async () => {
	const res = await worker.fetch(
		new Request('https://nl.example.com/build', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: 'not json'
		}),
		ENV()
	);
	assert.equal(res.status, 400);
	assert.match((await res.json()).error, /body must be JSON/);
});

test('POST /build rejects a non-https LLM endpoint when public (SSRF guard)', async () => {
	const res = await worker.fetch(
		post({ prompt: 'hi', llm: { ...LLM, baseUrl: 'http://localhost:11434/v1' } }),
		ENV()
	);
	assert.equal(res.status, 400);
	assert.match((await res.json()).error, /https|not allowed|private/i);
});

test('POST /build with no model configured', async () => {
	const res = await worker.fetch(post({ prompt: 'hi' }), ENV());
	assert.equal(res.status, 400);
	assert.match((await res.json()).error, /no model configured/);
});

test('POST /build: draft → session → loadFromURL link, and the session is fetchable', async () => {
	stubLLM(
		JSON.stringify({
			analyses: [
				{ name: 'SimulatedData', args: { seed: 1, samplingPeriod_hours: 1 } },
				{ name: 'Cosinor', args: { xIN: 'time', yIN: ['values'], fixedPeriod: 24 } }
			],
			plots: [{ type: 'scatterplot', name: 'Rhythm', inputs: { x: 'time', y: 'values' } }]
		})
	);
	const env = ENV();
	const res = await worker.fetch(post({ prompt: 'simulate a 24h rhythm and fit a cosinor', llm: LLM }), env);
	assert.equal(res.status, 200);
	const out = await res.json();

	// the link opens AnCiR pointed back at this worker's session URL
	assert.equal(out.sessionUrl, `https://nl.example.com/sessions/${out.sessionId}`);
	assert.equal(
		out.url,
		`https://ancir.pages.dev/?loadFromURL=${encodeURIComponent(out.sessionUrl)}`
	);
	assert.deepEqual(out.errors, []);

	// the stored session is a real one: generator baked, analysis pre-allocated, plot wired
	const got = await worker.fetch(new Request(out.sessionUrl), env);
	assert.equal(got.status, 200);
	assert.equal(got.headers.get('Access-Control-Allow-Origin'), '*', 'AnCiR fetches cross-origin');
	const session = await got.json();
	const sim = session.tableProcesses.find((t) => t.name === 'SimulatedData');
	const cos = session.tableProcesses.find((t) => t.name === 'Cosinor');
	assert.ok(session.rawData[sim.args.out.values].length > 0, 'generator output is baked');
	assert.ok('cosinorx' in cos.args.out, 'analysis out is pre-allocated');
	assert.ok(session.plots[0].plot.data[0].line.colour, 'plot series carries its style slot');
});

test('POST /build surfaces an upstream LLM error without leaking the key', async () => {
	globalThis.fetch = async () =>
		new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 });
	const res = await worker.fetch(post({ prompt: 'hi', llm: LLM }), ENV());
	assert.equal(res.status, 502);
	const out = await res.json();
	assert.match(out.error, /LLM error 401/);
	assert.ok(!JSON.stringify(out).includes('sk-test'), 'must never echo the key');
});

test('POST /build reports an unusable draft rather than storing an empty session', async () => {
	stubLLM(JSON.stringify({ analyses: [{ name: 'NoSuchNode', args: {} }] }));
	const res = await worker.fetch(post({ prompt: 'nonsense', llm: LLM }), ENV());
	assert.equal(res.status, 422);
	assert.match((await res.json()).errors.join(' '), /Unknown analysis/);
});

test('GET /sessions/:id → 404 for unknown id; OPTIONS preflight is allowed', async () => {
	const env = ENV();
	const missing = await worker.fetch(new Request('https://nl.example.com/sessions/nope'), env);
	assert.equal(missing.status, 404);

	const pre = await worker.fetch(new Request('https://nl.example.com/build', { method: 'OPTIONS' }), env);
	assert.equal(pre.status, 204);
	assert.equal(pre.headers.get('Access-Control-Allow-Origin'), '*');
});
