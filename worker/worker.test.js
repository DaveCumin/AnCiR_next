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

/** Capture the Worker's structured console.log lines (what lands in Workers Logs). */
function captureLogs() {
	const lines = [];
	const real = console.log;
	console.log = (s) => {
		try {
			lines.push(JSON.parse(s));
		} catch {
			/* not ours */
		}
	};
	return { lines, restore: () => (console.log = real) };
}

test('logs the prompt + outcome, and NEVER the api key', async () => {
	stubLLM(JSON.stringify({ analyses: [{ name: 'SimulatedData', args: {} }] }));
	const cap = captureLogs();
	try {
		await worker.fetch(post({ prompt: 'simulate a 24h rhythm', llm: LLM }), ENV());
	} finally {
		cap.restore();
	}
	const b = cap.lines.find((l) => l.event === 'build');
	assert.ok(b, 'a build line was logged');
	assert.equal(b.prompt, 'simulate a 24h rhythm', 'the prompt is the point of the log');
	assert.equal(b.outcome, 'ok');
	assert.equal(b.model, 'gpt-4o-mini');
	assert.equal(b.llmKeySource, 'caller', "whose key, not the key");
	assert.deepEqual(b.nodes, ['SimulatedData']);
	assert.ok(typeof b.ms === 'number' && b.ts);
	// the one thing that must never appear
	assert.ok(!JSON.stringify(b).includes('sk-test'), 'must not log the key');
});

test('logs failures too — a rejected prompt is the interesting case', async () => {
	stubLLM('this is not json at all');
	const cap = captureLogs();
	try {
		await worker.fetch(post({ prompt: 'do something impossible', llm: LLM }), ENV());
	} finally {
		cap.restore();
	}
	const b = cap.lines.find((l) => l.event === 'build');
	assert.equal(b.outcome, 'unparseable_draft');
	assert.equal(b.prompt, 'do something impossible');
});

test('a request with no llm{} uses the worker default and says so', async () => {
	stubLLM(JSON.stringify({ analyses: [{ name: 'SimulatedData', args: {} }] }));
	const env = { ...ENV(), OPENAI_BASE_URL: 'https://api.groq.com/openai/v1', OPENAI_API_KEY: 'gsk_secret', OPENAI_MODEL: 'openai/gpt-oss-120b' };
	const cap = captureLogs();
	let res;
	try {
		res = await worker.fetch(post({ prompt: 'hello' }), env); // no llm{} — the AI button
	} finally {
		cap.restore();
	}
	assert.equal(res.status, 200);
	const b = cap.lines.find((l) => l.event === 'build');
	assert.equal(b.llmKeySource, 'worker-default');
	assert.equal(b.model, 'openai/gpt-oss-120b');
	assert.ok(!JSON.stringify(b).includes('gsk_secret'), 'must not log the worker secret either');
});

test('model rate/usage limit → 429 with the provider detail, not a blanket 502', async () => {
	// What Groq actually returns when the free-tier limit is hit.
	globalThis.fetch = async () =>
		new Response(
			JSON.stringify({
				error: {
					message: 'Rate limit reached for model `openai/gpt-oss-120b`: Limit 14400, Used 14400. Please try again in 2m30s.',
					code: 'rate_limit_exceeded'
				}
			}),
			{ status: 429, headers: { 'Content-Type': 'application/json' } }
		);
	const cap = captureLogs();
	let res;
	try {
		// retries:0 so the client doesn't sit there backing off through the test
		res = await worker.fetch(post({ prompt: 'hi', llm: LLM, options: { retries: 0 } }), ENV());
	} finally {
		cap.restore();
	}
	assert.equal(res.status, 429, 'passed through as 429, not 502');
	assert.equal(res.headers.get('Retry-After'), '60');
	const out = await res.json();
	assert.match(out.error, /rate or usage limit/i);
	assert.match(out.error, /your own API key under Advanced/i, 'offers the way out');
	assert.match(out.detail, /Limit 14400, Used 14400/, "keeps the provider's specifics");
	assert.equal(cap.lines.find((l) => l.event === 'build')?.outcome, 'llm_rate_limited');
});

test('rejected key → says whose key it was', async () => {
	globalThis.fetch = async () =>
		new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 });

	// caller's key ⇒ tell them to fix it
	const theirs = await worker.fetch(post({ prompt: 'hi', llm: LLM, options: { retries: 0 } }), ENV());
	assert.equal(theirs.status, 502);
	assert.match((await theirs.json()).error, /That API key was rejected/i);

	// our default key ⇒ our misconfiguration, not theirs
	const ours = await worker.fetch(post({ prompt: 'hi', options: { retries: 0 } }), {
		...ENV(),
		OPENAI_BASE_URL: 'https://api.groq.com/openai/v1',
		OPENAI_API_KEY: 'gsk_bad',
		OPENAI_MODEL: 'openai/gpt-oss-120b'
	});
	assert.equal(ours.status, 502);
	const body = await ours.json();
	assert.match(body.error, /service is misconfigured/i);
	assert.ok(!JSON.stringify(body).includes('gsk_bad'), 'never echoes the key');
});

test('an unmapped upstream error still surfaces, without leaking the key', async () => {
	// 401/403/429 have their own messages (tested above); anything else falls through to the
	// generic path, which must still say something and never echo the key.
	globalThis.fetch = async () =>
		new Response(JSON.stringify({ error: { message: 'model is overloaded' } }), { status: 503 });
	const res = await worker.fetch(post({ prompt: 'hi', llm: LLM, options: { retries: 0 } }), ENV());
	assert.equal(res.status, 502);
	const out = await res.json();
	assert.match(out.error, /LLM error 503/);
	assert.match(out.detail, /model is overloaded/, "keeps the provider's message");
	assert.ok(!JSON.stringify(out).includes('sk-test'), 'must never echo the key');
});

test('POST /build reports an unusable draft rather than storing an empty session', async () => {
	stubLLM(JSON.stringify({ analyses: [{ name: 'NoSuchNode', args: {} }] }));
	const res = await worker.fetch(post({ prompt: 'nonsense', llm: LLM }), ENV());
	assert.equal(res.status, 422);
	assert.match((await res.json()).errors.join(' '), /Unknown analysis/);
});

test('rate limiting: uses the Cloudflare limiter binding and returns an actionable 429', async () => {
	stubLLM(JSON.stringify({ analyses: [{ name: 'SimulatedData', args: {} }] }));
	const seen = [];
	const env = {
		...ENV(),
		// Cloudflare's [[ratelimits]] binding shape.
		RATE_LIMITER: {
			async limit({ key }) {
				seen.push(key);
				return { success: false }; // pretend the limit is blown
			}
		}
	};
	const req = new Request('https://nl.example.com/build', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
		body: JSON.stringify({ prompt: 'hi', llm: LLM })
	});
	const res = await worker.fetch(req, env);
	assert.equal(res.status, 429);
	assert.equal(res.headers.get('Retry-After'), '60');
	const out = await res.json();
	assert.match(out.error, /Too many requests.*wait a minute/i, 'a human-readable message');
	assert.deepEqual(seen, ['203.0.113.7'], 'limits per client IP');
});

test('rate limiting: the binding wins over the KV fallback', async () => {
	stubLLM(JSON.stringify({ analyses: [{ name: 'SimulatedData', args: {} }] }));
	const env = {
		...ENV(),
		BUILD_RATE_MAX: '1',
		RATE_LIMITER: { async limit() { return { success: true }; } } // allowed
	};
	// Several requests would trip the KV counter (max 1); the binding says fine, so they pass.
	for (let i = 0; i < 3; i++) {
		const res = await worker.fetch(post({ prompt: `p${i}`, llm: LLM }), env);
		assert.equal(res.status, 200, `request ${i} allowed by the binding`);
	}
});

test('GET /sessions/:id → 404 for unknown id; OPTIONS preflight is allowed', async () => {
	const env = ENV();
	const missing = await worker.fetch(new Request('https://nl.example.com/sessions/nope'), env);
	assert.equal(missing.status, 404);

	const pre = await worker.fetch(new Request('https://nl.example.com/build', { method: 'OPTIONS' }), env);
	assert.equal(pre.status, 204);
	assert.equal(pre.headers.get('Access-Control-Allow-Origin'), '*');
});
