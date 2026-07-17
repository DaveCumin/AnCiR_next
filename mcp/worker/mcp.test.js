// node --test worker/mcp.test.js
//
// Drives POST /mcp through the Worker's fetch handler the way a real MCP client does, with a
// fake KV. No LLM is stubbed anywhere here — and that's the point: the /mcp path must never
// call a model (the calling agent IS the model), so any upstream fetch would be a bug.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';

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

/** POST one JSON-RPC message (or batch) to /mcp and return {status, body}. */
async function rpc(msg, env = ENV()) {
	const res = await worker.fetch(
		new Request('https://nl.example.com/mcp', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify(msg)
		}),
		env
	);
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null, res };
}

const call = (name, args, env) =>
	rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, env);

// Any outbound fetch from the /mcp path is a bug — make it loud rather than silent.
let realFetch;
beforeEach(() => {
	realFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		throw new Error('the /mcp path must not make network calls');
	};
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

test('initialize → protocol version echoed, tools capability advertised', async () => {
	const { status, body } = await rpc({
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } }
	});
	assert.equal(status, 200);
	assert.equal(body.jsonrpc, '2.0');
	assert.equal(body.id, 1);
	assert.equal(body.result.protocolVersion, '2025-06-18'); // echoed, since we support it
	assert.ok(body.result.capabilities.tools);
	assert.equal(body.result.serverInfo.name, 'ancir');
});

test('initialize with an unknown protocol version → we offer one we do support', async () => {
	const { body } = await rpc({
		jsonrpc: '2.0',
		id: 1,
		method: 'initialize',
		params: { protocolVersion: '1999-01-01' }
	});
	assert.equal(body.result.protocolVersion, '2025-03-26');
});

test('notifications get no body (202), not a null-id response', async () => {
	const { status, body } = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
	assert.equal(status, 202);
	assert.equal(body, null);
});

test('tools/list → every tool, each with an inputSchema', async () => {
	const { body } = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
	const names = body.result.tools.map((t) => t.name).sort();
	assert.deepEqual(names, ['build_session', 'check_draft', 'describe_session', 'list_capabilities']);
	for (const t of body.result.tools) assert.equal(t.inputSchema.type, 'object');
});

test('unknown method → JSON-RPC "method not found", not a crash', async () => {
	const { status, body } = await rpc({ jsonrpc: '2.0', id: 3, method: 'resources/list' });
	assert.equal(status, 200); // transport succeeded; the ERROR is in the envelope
	assert.equal(body.error.code, -32601);
});

test('malformed body → parse error', async () => {
	const res = await worker.fetch(
		new Request('https://nl.example.com/mcp', { method: 'POST', body: 'not json' }),
		ENV()
	);
	assert.equal(res.status, 400);
	assert.equal((await res.json()).error.code, -32700);
});

test('GET /mcp → 405 (we are stateless; there is no SSE stream to open)', async () => {
	const res = await worker.fetch(new Request('https://nl.example.com/mcp'), ENV());
	assert.equal(res.status, 405);
});

test('list_capabilities names real registry nodes, args and output columns', async () => {
	const { body } = await call('list_capabilities', {});
	const text = body.result.content[0].text;
	assert.match(text, /SimulatedData/);
	assert.match(text, /Cosinor/);
	// The cosinorx class of bug: the fitted-curve pairing must be stated, not inferred.
	assert.match(text, /fitted curve: x=cosinorx, y=cosinory_/);
	assert.match(text, /scatterplot: series=/);
	// Plot fields must be the plot's OWN — actogram is time/values, not x/y.
	assert.match(text, /actogram: series=\[\{"time":/);
});

test('build_session → stores a session and returns a loadFromURL link that resolves', async () => {
	const env = ENV();
	const { body } = await call(
		'build_session',
		{
			analyses: [
				{ name: 'SimulatedData', args: { period: 24, days: 4 } },
				{ name: 'Cosinor', args: { xIN: 'time', yIN: ['values'], useFixedPeriod: true, fixedPeriod: 24 } }
			],
			plots: [
				{
					type: 'scatterplot',
					name: 'Cosinor: data + fit',
					series: [
						{ x: 'time', y: 'values', kind: 'points' },
						{ x: 'cosinorx', y: 'cosinory_values', kind: 'line' }
					]
				}
			]
		},
		env
	);

	assert.notEqual(body.result.isError, true);
	const { url, sessionUrl, sessionId } = body.result.structuredContent;
	assert.ok(url.startsWith('https://ancir.pages.dev/?loadFromURL='));
	assert.equal(url, `https://ancir.pages.dev/?loadFromURL=${encodeURIComponent(sessionUrl)}`);
	// The link must lead somewhere: fetch the session back off the Worker's own route.
	const got = await worker.fetch(new Request(sessionUrl), env);
	assert.equal(got.status, 200);
	const session = await got.json();
	assert.deepEqual(
		session.tableProcesses.map((t) => t.name),
		['SimulatedData', 'Cosinor']
	);
	assert.equal(session.plots.length, 1);
	assert.ok(env.SESSIONS._m.has(`s:${sessionId}`));

	// The fingerprint is what makes a session someone sends back traceable, so the id in it must
	// be the SAME one it's stored under — a mismatch would silently break the join to the logs.
	assert.equal(session.generatedBy.sessionId, sessionId);
	assert.equal(session.generatedBy.route, 'mcp');
	assert.equal(session.generatedBy.source, 'ancir-nl');
	assert.ok(!Number.isNaN(Date.parse(session.generatedBy.generatedAt)));
	// No model on this route: the calling agent is the model and never says which. Guessing
	// would be worse than the honest omission.
	assert.equal('model' in session.generatedBy, false);

	// The text content leads with the link — it's what the agent hands to the user.
	assert.match(body.result.content[0].text, /Open it in AnCiR:\nhttps:\/\/ancir\.pages\.dev/);
});

test('build_session reports an unusable draft instead of storing an empty session', async () => {
	const env = ENV();
	const { body } = await call('build_session', { analyses: [{ name: 'NoSuchAnalysis' }] }, env);
	assert.equal(body.result.isError, true);
	assert.match(body.result.content[0].text, /empty session/i);
	assert.equal(env.SESSIONS._m.size, 0);
});

test('build_session honours the rate limiter, and does not write when limited', async () => {
	const env = { ...ENV(), RATE_LIMITER: { limit: async () => ({ success: false }) } };
	const { body } = await call('build_session', { analyses: [{ name: 'SimulatedData', args: {} }] }, env);
	assert.equal(body.result.isError, true);
	assert.match(body.result.content[0].text, /rate limited/i);
	assert.equal(env.SESSIONS._m.size, 0);
});

test('a throwing tool is reported to the model, not as a transport error', async () => {
	const { status, body } = await call('no_such_tool', {});
	assert.equal(status, 200);
	assert.equal(body.result.isError, true);
	assert.match(body.result.content[0].text, /Unknown tool/);
});

test('batch: responses come back for requests, notifications are dropped', async () => {
	const { status, body } = await rpc([
		{ jsonrpc: '2.0', id: 1, method: 'ping' },
		{ jsonrpc: '2.0', method: 'notifications/initialized' },
		{ jsonrpc: '2.0', id: 2, method: 'tools/list' }
	]);
	assert.equal(status, 200);
	assert.equal(body.length, 2);
	assert.deepEqual(
		body.map((r) => r.id),
		[1, 2]
	);
});

// ---- check_draft: look before you leap -------------------------------------------------

const COSINOR_DRAFT = {
	analyses: [
		{
			name: 'SimulatedData',
			args: { seed: 1, samplingPeriod_hours: 1, sections: [{ duration_hours: 240, rhythmPeriod_hours: 24 }] }
		},
		{ name: 'Cosinor', args: { xIN: 'time', yIN: ['values'], useFixedPeriod: true, fixedPeriod: 24 } }
	]
};

test('check_draft stores NOTHING and mints no link', async () => {
	const env = ENV();
	const { body } = await call('check_draft', COSINOR_DRAFT, env);
	assert.equal(body.result.isError, undefined);
	assert.equal(env.SESSIONS._m.size, 0, 'a dry run that writes to KV is not a dry run');
	assert.ok(!/loadFromURL/.test(body.result.content[0].text), 'no link: nothing was built');
	assert.equal(body.result.structuredContent.ok, true);
});

test('check_draft names the output columns an analysis will create', async () => {
	// The thing an agent cannot predict and keeps getting wrong. Learning it costs a dry run
	// rather than a built session with a dropped plot.
	const { body } = await call('check_draft', COSINOR_DRAFT);
	const text = body.result.content[0].text;
	assert.match(text, /Cosinor -> creates: .*cosinorx/);
	assert.match(text, /cosinory_values/);
});

test('check_draft reports what WOULD be dropped, and agrees with build_session', async () => {
	// A dry run that disagrees with the real thing is worse than none: it teaches the agent to
	// trust a fiction. Same normalizer, so the same verdict — asserted, not assumed.
	const bad = {
		analyses: [
			{ name: 'SimulatedData', args: { seed: 1, samplingPeriod_hours: 1, sections: [{ duration_hours: 96 }] } },
			{ name: 'Cosinor', args: { xIN: 'nope', yIN: ['values'], useFixedPeriod: true, fixedPeriod: 24 } }
		]
	};
	const dry = await call('check_draft', bad);
	const real = await call('build_session', bad, ENV());
	assert.deepEqual(dry.body.result.structuredContent.errors, real.body.result.structuredContent.errors);
	assert.equal(dry.body.result.structuredContent.ok, false);
	assert.match(dry.body.result.content[0].text, /would be dropped|would build/i);
});

test('check_draft passes on scientific fitness, so the agent can fix it before building', async () => {
	const { body } = await call('check_draft', {
		analyses: [
			{
				name: 'SimulatedData',
				args: { seed: 1, samplingPeriod_hours: 1, sections: [{ duration_hours: 36, rhythmPeriod_hours: 24 }] }
			},
			{ name: 'Cosinor', args: { xIN: 'time', yIN: ['values'], useFixedPeriod: true, fixedPeriod: 24 } }
		]
	});
	assert.match(body.result.content[0].text, /1\.5 cycles/);
	assert.equal(body.result.structuredContent.fitness[0].severity, 'high');
	// Advice, not a verdict: the draft is still valid.
	assert.equal(body.result.structuredContent.ok, true);
});

// ---- describe_session ------------------------------------------------------------------

test('describe_session reads back a session built through this server', async () => {
	const env = ENV();
	const built = await call('build_session', COSINOR_DRAFT, env);
	const { sessionId, url } = built.body.result.structuredContent;

	// Accepts the id, the sessions URL, or the full AnCiR link the agent was handed.
	for (const ref of [sessionId, `https://nl.example.com/sessions/${sessionId}`, url]) {
		const { body } = await call('describe_session', { session: ref }, env);
		assert.equal(body.result.isError, undefined, `failed for ${ref}`);
		const sc = body.result.structuredContent;
		assert.equal(sc.sessionId, sessionId);
		assert.deepEqual(sc.analyses.map((a) => a.name), ['SimulatedData', 'Cosinor']);
		assert.equal(sc.generatedBy.route, 'mcp');
	}
});

test('describe_session says which columns actually hold data', async () => {
	// The distinction an agent must not get wrong: a generator's output is baked, an analysis's
	// is empty until a browser opens the link. Reasoning over the latter means reasoning over [].
	const env = ENV();
	const built = await call('build_session', COSINOR_DRAFT, env);
	const { body } = await call('describe_session', { session: built.body.result.structuredContent.sessionId }, env);

	const cols = Object.fromEntries(body.result.structuredContent.columns.map((c) => [c.name, c.hasData]));
	assert.equal(cols.time, true, 'baked generator output');
	assert.equal(cols.cosinorx, false, 'computed in the browser, empty here');
	assert.match(body.result.content[0].text, /computed on open/);
});

test('describe_session PARSES a url — it never fetches one (SSRF)', async () => {
	// "Describe the session at this URL" reads as an invitation to go and get it, which would
	// hand any caller a fetch primitive inside our Worker. We only ever read our own KV, so a
	// non-uuid is simply not a session id, and an internal URL is a 400-shaped refusal.
	// NB the suite-wide beforeEach already makes ANY outbound fetch throw, so a Worker that
	// tried would surface as a tool error rather than a silent pass. This records the attempt
	// on top of that, so the failure names the cause instead of just going red.
	const guarded = globalThis.fetch;
	let fetched = null;
	globalThis.fetch = (u) => {
		fetched = String(u);
		throw new Error('the Worker must not fetch a caller-supplied URL');
	};
	try {
		for (const ref of [
			'http://169.254.169.254/latest/meta-data/',
			'https://nl.example.com/?loadFromURL=http://internal/admin',
			'file:///etc/passwd'
		]) {
			const { body } = await call('describe_session', { session: ref });
			assert.equal(body.result.isError, true, `should refuse ${ref}`);
			assert.match(body.result.content[0].text, /session id/i);
		}
	} finally {
		globalThis.fetch = guarded; // hand back to afterEach, which restores the real one
	}
	assert.equal(fetched, null, 'nothing was fetched');
});

test('describe_session on an expired id explains WHY, so the agent stops retrying', async () => {
	const { body } = await call('describe_session', { session: '11111111-2222-3333-4444-555555555555' });
	assert.equal(body.result.isError, true);
	assert.match(body.result.content[0].text, /transient|expire/i);
});
