// node --test worker/worker.test.js
//
// Drives the Worker's fetch handler directly with a fake KV + a stubbed upstream LLM, so the
// whole NL→session path is covered without deploying or calling a real model.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { extractDraft } from './index.js';
import { buildDraftPrompt } from './draftPrompt.js';
import generated from '../src/emit/session-schema.generated.json' with { type: 'json' };

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

/**
 * Stub a CONVERSATION: one canned reply per call, so a repair round can answer differently from
 * the first attempt. Returns the captured request bodies — the repair message is itself worth
 * asserting on, since it's what carries the errors back to the model.
 */
function stubLLMSequence(...contents) {
	const sent = [];
	let i = 0;
	globalThis.fetch = async (_url, init) => {
		sent.push(JSON.parse(init.body));
		const content = contents[Math.min(i++, contents.length - 1)];
		return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	};
	return sent;
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
	// Plot series fields are registry-derived AND spelled out per type. A one-line `type[a,b]`
	// list sat next to an x/y worked example was too easy to skim: models emitted {x,y} for
	// actogram (fields time/values), and the normalizer dropped the plot with nothing to show
	// for it. Only 3 of the 11 plot types take x/y.
	assert.match(p, /scatterplot: series=\[\{"x":"<col>","y":"<col>"\}\]/);
	assert.match(p, /actogram: series=\[\{"time":"<col>","values":"<col>"\}\]/);
	assert.match(p, /histogram: series=\[\{"column":"<col>"\}\]/);
	assert.match(p, /tableplot: inputs=/, 'input-less plots take a column list, not series');
	assert.match(p, /KEYS ARE NOT ALWAYS x\/y/, 'and the rule says so in prose too');
});

// The catalogue is the model's only source of column names, so a wrong line there isn't a
// cosmetic bug — it's an instruction to reference a column that will never exist. This one told
// every model that RhythmicityAnalysis had a `rhythmicityx` / `rhythmicityy_<Y>` fitted curve.
// It has neither: its outputs are per-Y `<Y>_period` / `<Y>_power`. Asking for "a periodogram"
// therefore produced a plot wired to nothing, every time.
test('the catalogue only claims outputs a node can actually produce', () => {
	const p = buildDraftPrompt();

	// The lie, and its cause: yOutKeyPrefix is a COLLECTED-mode prefix for this node.
	assert.doesNotMatch(p, /rhythmicityx/, 'RhythmicityAnalysis has no such X grid');
	assert.doesNotMatch(p, /rhythmicityy_/, 'nor such a per-Y curve');

	// What it really makes, for the args the catalogue shows.
	assert.match(
		p,
		/RhythmicityAnalysis:.*produces per Y column: <your Y column>_period, <your Y column>_power/,
		'says what the node actually produces'
	);
	// And that those names depend on the discriminating params, so a model changing `analysis`
	// doesn't keep using the periodogram names.
	assert.match(p, /for analysis=periodogram, pgMethod=Lomb-Scargle; other values give other columns/);

	// The genuine fitted curves are untouched — this must not over-correct.
	assert.match(p, /Cosinor:.*fitted curve: x=cosinorx, y=cosinory_<your Y column>/);

	// The general rule, checked against the schema rather than a list of names: a node may only
	// advertise a fitted curve when its per-Y keys really are `${prefix}${yid}`.
	for (const [name, n] of Object.entries(generated.nodes)) {
		if (n.fitOut) assert.equal(n.dynamicKind, 'prefix', `${name} claims a fit it cannot make`);
	}
});

// A node whose outputs can't be listed statically still has to say SOMETHING, or everything
// downstream of it is unreachable by prompt: asked to "split the data and plot each part", a
// model invented `values_0` and every analysis after the Split was dropped.
test('every node tells the model how to name its outputs', () => {
	const p = buildDraftPrompt();

	// Split's rule, in the vocabulary the model writes in.
	assert.match(p, /Split:.*produces per Y column, one per segment: <your Y column>_1/);
	// MovingAnalysis keeps its fixed output AND gains the per-stat rule.
	assert.match(p, /MovingAnalysis:.*produces: movex -> produces per Y column, one per statistic/);

	// The rule, not a list of names: a runtime node advertises nothing unless it has a note or a
	// fixed output, and "nothing" is what made Split unpromptable.
	for (const [name, n] of Object.entries(generated.nodes)) {
		if (n.dynamicKind !== 'runtime') continue;
		assert.ok(
			n.outputNote || n.fixedOut.length,
			`${name} computes its outputs but tells the model nothing about their names`
		);
	}
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

	// Traceability: the id inside the session must be the one it's stored under and logged with,
	// or a session a user sends back can't be joined to the request that built it.
	assert.equal(session.generatedBy.sessionId, out.sessionId);
	assert.equal(session.generatedBy.route, 'build');
	assert.equal(session.generatedBy.model, LLM.model);
});

// The real failure, verbatim: asked to split a recording and analyse each half, the model
// referenced `time_1` — a per-segment x column that doesn't exist, because Split's segments are
// full-length and null-padded and keep using the ORIGINAL x. Everything downstream was dropped
// and the user got a wall of errors they could do nothing with.
//
// The catalogue now says so, but no prompt can anticipate every wrong guess. The normalizer
// already knows precisely what's wrong AND what was available — so give the model its own
// mistake back, once. That fixes this class of error whether or not anyone predicted it.
const SPLIT_DRAFT = (xForAnalysis) => ({
	analyses: [
		{ name: 'SimulatedData', args: { seed: 1, samplingPeriod_hours: 1 } },
		{ name: 'Split', args: { xIN: 'time', yIN: ['values'], splitTimes: [100] } },
		{
			name: 'RhythmicityAnalysis',
			args: { xIN: xForAnalysis, yIN: ['values_1'], analysis: 'periodogram', pgMethod: 'Lomb-Scargle' }
		}
	]
});

test('a model that invents a column is told, once, and fixes it', async () => {
	const sent = stubLLMSequence(
		JSON.stringify(SPLIT_DRAFT('time_1')), // the mistake that actually happened
		JSON.stringify(SPLIT_DRAFT('time')) // what it produces once told
	);
	const env = ENV();
	const res = await worker.fetch(post({ prompt: 'split it and analyse each half', llm: LLM }), env);
	assert.equal(res.status, 200);
	const out = await res.json();

	// The repair landed: no errors, and the analysis that was dropped is in the session.
	assert.deepEqual(out.errors, []);
	const session = await (await worker.fetch(new Request(out.sessionUrl), env)).json();
	assert.ok(
		session.tableProcesses.some((t) => t.name === 'RhythmicityAnalysis'),
		'the analysis survived, rather than being dropped'
	);

	// Exactly two calls — a repair round, not a loop.
	assert.equal(sent.length, 2);

	// The follow-up carries the model's own answer and the normalizer's diagnosis, which names
	// both the bad reference and what actually existed. That pairing is the whole mechanism.
	const followUp = sent[1].messages[1].content;
	assert.match(followUp, /no column named "time_1"/);
	assert.match(followUp, /Available: .*values_1/);
	assert.match(followUp, /WHOLE corrected JSON object/);
});

test('a repair that does not help is discarded, and never retried again', async () => {
	// Same broken answer twice: the second attempt is no better, so the first stands and the
	// user still gets the errors — better than a loop that burns an 8K/min budget.
	const sent = stubLLMSequence(JSON.stringify(SPLIT_DRAFT('time_1')));
	const res = await worker.fetch(post({ prompt: 'split it', llm: LLM }), ENV());
	assert.equal(res.status, 200);
	const out = await res.json();

	assert.equal(sent.length, 2, 'tried once more, then stopped');
	assert.ok(out.errors.length, 'the errors are still reported honestly');
	assert.match(out.errors[0], /time_1/);
});

test('a clean draft is never repaired — no wasted call', async () => {
	const sent = stubLLMSequence(JSON.stringify(SPLIT_DRAFT('time')));
	const res = await worker.fetch(post({ prompt: 'split it', llm: LLM }), ENV());
	assert.equal(res.status, 200);
	assert.deepEqual((await res.json()).errors, []);
	assert.equal(sent.length, 1, 'one call when the first answer is good');
});

test('logs whether a repair was needed — the number that says the catalogue is misleading', async () => {
	const lines = [];
	const realLog = console.log;
	console.log = (o) => lines.push(o);
	try {
		stubLLMSequence(JSON.stringify(SPLIT_DRAFT('time_1')), JSON.stringify(SPLIT_DRAFT('time')));
		await worker.fetch(post({ prompt: 'split it', llm: LLM }), ENV());
	} finally {
		console.log = realLog;
	}
	const ok = lines.find((l) => l?.event === 'build' && l.outcome === 'ok');
	assert.equal(ok.repaired, true);
});

const INTENT = {
	goal: 'split the recording and check each half for rhythmicity',
	deliverables: [
		{ kind: 'analysis', what: 'Split' },
		{ kind: 'analysis', what: 'RhythmicityAnalysis' }
	],
	assumptions: ['no sampling rate given; assumed hourly']
};

test('the reply carries a manifest: the goal, the guesses, and what is missing', async () => {
	// Only the Split is built — the RhythmicityAnalysis the user asked for is absent, and the
	// session is error-free regardless. Without the manifest nothing in the reply says so.
	stubLLM(
		JSON.stringify({
			intent: INTENT,
			analyses: [
				{ name: 'SimulatedData', args: { seed: 1, samplingPeriod_hours: 1 } },
				{ name: 'Split', args: { xIN: 'time', yIN: ['values'], splitTimes: [100] } }
			]
		})
	);
	const res = await worker.fetch(post({ prompt: 'split it and analyse each half', llm: LLM }), ENV());
	const { manifest, errors } = await res.json();

	assert.deepEqual(errors, [], 'a perfectly-wired session that is still not what was asked for');
	assert.equal(manifest.complete, false);
	assert.deepEqual(manifest.missing, ['analysis: RhythmicityAnalysis']);
	assert.match(manifest.goal, /rhythmicity/);
	// The assumptions are how a user learns what was decided for them.
	assert.deepEqual(manifest.assumptions, ['no sampling rate given; assumed hourly']);
});

test('a repair cannot declare itself complete by restating its own intent', async () => {
	// The escape route a self-reported contract has to close. The model can't wire the
	// RhythmicityAnalysis, so on the retry it drops the analysis AND quietly deletes it from
	// its own deliverables. That reply is error-free and claims 100%.
	//
	// Dropping it is allowed here (the repair prompt itself offers "drop that part rather than
	// inventing a name", and an error-free session beats a broken one). Hiding it is not. The
	// manifest is scored against the FIRST draft's intent — the reading closest to what the
	// user actually asked for, made before the model hit any trouble — so the deliverable is
	// still reported missing no matter what the repair says about itself.
	const sent = stubLLMSequence(
		JSON.stringify({ intent: INTENT, ...SPLIT_DRAFT('time_1') }),
		JSON.stringify({
			intent: { ...INTENT, deliverables: [{ kind: 'analysis', what: 'Split' }] },
			analyses: [
				{ name: 'SimulatedData', args: { seed: 1, samplingPeriod_hours: 1 } },
				{ name: 'Split', args: { xIN: 'time', yIN: ['values'], splitTimes: [100] } }
			]
		})
	);
	const res = await worker.fetch(post({ prompt: 'split it and analyse each half', llm: LLM }), ENV());
	const out = await res.json();

	assert.equal(sent.length, 2);
	assert.deepEqual(out.errors, [], 'the repair was taken: it is error-free');
	// ...but the user is still told what it quietly gave up on.
	assert.equal(out.manifest.complete, false, 'the model claimed complete; we do not take its word');
	assert.deepEqual(out.manifest.missing, ['analysis: RhythmicityAnalysis']);
});

test('the repair prompt tells the model its intent is binding', async () => {
	const sent = stubLLMSequence(JSON.stringify({ intent: INTENT, ...SPLIT_DRAFT('time_1') }));
	await worker.fetch(post({ prompt: 'split it', llm: LLM }), ENV());
	assert.match(sent[1].messages[1].content, /do not drop a[\s\S]*deliverable/i);
});

test('logs intent coverage — the metric that says we built the wrong thing correctly', async () => {
	const lines = [];
	const realLog = console.log;
	console.log = (o) => lines.push(o);
	try {
		stubLLM(
			JSON.stringify({
				intent: INTENT,
				analyses: [
					{ name: 'SimulatedData', args: { seed: 1, samplingPeriod_hours: 1 } },
					{ name: 'Split', args: { xIN: 'time', yIN: ['values'], splitTimes: [100] } }
				]
			})
		);
		await worker.fetch(post({ prompt: 'split it', llm: LLM }), ENV());
	} finally {
		console.log = realLog;
	}
	const ok = lines.find((l) => l?.event === 'build' && l.outcome === 'ok');
	assert.equal(ok.intentMet, '1/2');
	assert.deepEqual(ok.intentMissing, ['analysis: RhythmicityAnalysis']);
});

test('/build warns when a valid session will produce a misleading number', async () => {
	// 36 h of data, fitting a 24 h period. Wires perfectly, zero errors, and returns a
	// confident amplitude built from 1.5 cycles. errors/warnings/manifest are all silent on
	// this — being wired right and being right are different questions.
	const lines = [];
	const realLog = console.log;
	console.log = (o) => lines.push(o);
	let out;
	try {
		stubLLM(
			JSON.stringify({
				analyses: [
					{
						name: 'SimulatedData',
						args: { seed: 1, samplingPeriod_hours: 1, sections: [{ duration_hours: 36, rhythmPeriod_hours: 24 }] }
					},
					{ name: 'Cosinor', args: { xIN: 'time', yIN: ['values'], useFixedPeriod: true, fixedPeriod: 24 } }
				]
			})
		);
		const res = await worker.fetch(post({ prompt: 'fit a daily rhythm to a day and a half', llm: LLM }), ENV());
		assert.equal(res.status, 200, 'advice, never a blocker');
		out = await res.json();
	} finally {
		console.log = realLog;
	}

	assert.deepEqual(out.errors, [], 'nothing is WRONG with it, which is the point');
	const f = out.fitness.find((x) => x.severity === 'high');
	assert.ok(f, `expected a fitness warning, got: ${JSON.stringify(out.fitness)}`);
	assert.equal(f.node, 'Cosinor');
	assert.match(f.message, /1\.5 cycles/);

	assert.equal(lines.find((l) => l?.event === 'build' && l.outcome === 'ok').fitnessHigh, 1);
});

test('a draft with no intent still builds — the field is new, sessions are not', async () => {
	stubLLM(JSON.stringify({ analyses: [{ name: 'SimulatedData', args: { seed: 1 } }] }));
	const res = await worker.fetch(post({ prompt: 'simulate something', llm: LLM }), ENV());
	assert.equal(res.status, 200);
	const out = await res.json();
	// null, not a manifest we invented by describing the graph back at the user.
	assert.equal(out.manifest, null);
});

test('the fingerprint never carries the api key or the prompt — the session travels', async () => {
	stubLLM(JSON.stringify({ analyses: [{ name: 'SimulatedData', args: { seed: 1 } }] }));
	const env = ENV();
	const res = await worker.fetch(post({ prompt: 'secret-prompt-text', llm: LLM }), env);
	const { sessionUrl } = await res.json();
	const session = await (await worker.fetch(new Request(sessionUrl), env)).json();

	// The prompt and key stay in OUR logs; the session is handed to a user and may be shared on.
	const blob = JSON.stringify(session.generatedBy);
	assert.equal(blob.includes(LLM.apiKey), false, 'no api key in the session');
	assert.equal(blob.includes('secret-prompt-text'), false, 'no prompt in the session');
});

/**
 * Capture the Worker's structured console.log lines (what lands in Workers Logs).
 * We log OBJECTS (so Cloudflare indexes their fields and the dashboard can filter on them),
 * so capture objects — a string would mean the structured logging had regressed.
 */
function captureLogs() {
	const lines = [];
	const real = console.log;
	console.log = (o) => {
		if (o && typeof o === 'object') lines.push(o);
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
	// An OBJECT, not a string: Workers Logs only indexes/queries object fields.
	assert.equal(typeof b, 'object');
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
