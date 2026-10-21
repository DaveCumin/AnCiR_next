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
		params: {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'x', version: '1' }
		}
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
	assert.deepEqual(names, [
		'build_session',
		'check_draft',
		'describe_session',
		'list_capabilities'
	]);
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
				{
					name: 'Cosinor',
					args: { xIN: 'time', yIN: ['values'], useFixedPeriod: true, fixedPeriod: 24 }
				}
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
	const { body } = await call(
		'build_session',
		{ analyses: [{ name: 'SimulatedData', args: {} }] },
		env
	);
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
			args: {
				seed: 1,
				samplingPeriod_hours: 1,
				sections: [{ duration_hours: 240, rhythmPeriod_hours: 24 }]
			}
		},
		{
			name: 'Cosinor',
			args: { xIN: 'time', yIN: ['values'], useFixedPeriod: true, fixedPeriod: 24 }
		}
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
			{
				name: 'SimulatedData',
				args: { seed: 1, samplingPeriod_hours: 1, sections: [{ duration_hours: 96 }] }
			},
			{
				name: 'Cosinor',
				args: { xIN: 'nope', yIN: ['values'], useFixedPeriod: true, fixedPeriod: 24 }
			}
		]
	};
	const dry = await call('check_draft', bad);
	const real = await call('build_session', bad, ENV());
	assert.deepEqual(
		dry.body.result.structuredContent.errors,
		real.body.result.structuredContent.errors
	);
	assert.equal(dry.body.result.structuredContent.ok, false);
	assert.match(dry.body.result.content[0].text, /would be dropped|would build/i);
});

test('check_draft passes on scientific fitness, so the agent can fix it before building', async () => {
	const { body } = await call('check_draft', {
		analyses: [
			{
				name: 'SimulatedData',
				args: {
					seed: 1,
					samplingPeriod_hours: 1,
					sections: [{ duration_hours: 36, rhythmPeriod_hours: 24 }]
				}
			},
			{
				name: 'Cosinor',
				args: { xIN: 'time', yIN: ['values'], useFixedPeriod: true, fixedPeriod: 24 }
			}
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
		assert.deepEqual(
			sc.analyses.map((a) => a.name),
			['SimulatedData', 'Cosinor']
		);
		assert.equal(sc.generatedBy.route, 'mcp');
	}
});

test("describe_session names an actogram's marker rules and their output keys", async () => {
	const env = ENV();
	const id = crypto.randomUUID();
	const session = {
		version: '77.0',
		data: [],
		rawData: {},
		tableProcesses: [],
		plots: [
			{
				id: 0,
				type: 'actogram',
				name: 'Activity',
				plot: { data: [], markerRules: [{ id: 'r2', name: 'Onsets', type: 'onset' }] }
			},
			{ id: 1, type: 'scatterplot', name: 'S', plot: { data: [] } }
		]
	};
	await env.SESSIONS.put(`s:${id}`, JSON.stringify(session));
	const { body } = await call('describe_session', { session: id }, env);
	assert.equal(body.result.isError, undefined);
	assert.match(
		body.result.content[0].text,
		/actogram "Activity"; marker rules: "Onsets" \(onset\) -> r2_tau, r2_phi, r2_r2, r2_rmse, r2_n/
	);
	assert.deepEqual(body.result.structuredContent.plots, [
		{
			type: 'actogram',
			name: 'Activity',
			markerRules: [
				{
					id: 'r2',
					name: 'Onsets',
					type: 'onset',
					outputs: ['r2_tau', 'r2_phi', 'r2_r2', 'r2_rmse', 'r2_n']
				}
			]
		},
		{ type: 'scatterplot', name: 'S' }
	]);
});

test('describe_session says which columns actually hold data', async () => {
	// The distinction an agent must not get wrong: a generator's output is baked, an analysis's
	// is empty until a browser opens the link. Reasoning over the latter means reasoning over [].
	const env = ENV();
	const built = await call('build_session', COSINOR_DRAFT, env);
	const { body } = await call(
		'describe_session',
		{ session: built.body.result.structuredContent.sessionId },
		env
	);

	const cols = Object.fromEntries(
		body.result.structuredContent.columns.map((c) => [c.name, c.hasData])
	);
	assert.equal(cols.time, true, 'baked generator output');
	assert.equal(cols.cosinorx, false, 'computed in the browser, empty here');
	assert.match(body.result.content[0].text, /computed on open/);
});

test('Colour by / Size by: list_capabilities teaches them; describe_session and check_draft report them', async () => {
	const caps = await call('list_capabilities', {});
	assert.match(
		caps.body.result.content[0].text,
		/COLOUR BY \/ SIZE BY .*plots: circularphase, meansem, qqplot, scatterplot/
	);

	const env = ENV();
	const draft = {
		analyses: [
			{
				name: 'SimulatedData',
				args: {
					startTime: '2024-01-15T00:00:00.000Z',
					samplingPeriod_hours: 1,
					sections: [{ duration_hours: 48, rhythmPeriod_hours: 24, rhythmAmplitude: 3 }]
				}
			}
		],
		plots: [
			{
				type: 'scatterplot',
				name: 'Loop',
				series: [
					{
						x: 'time',
						y: 'values',
						label: 'Activity',
						colourBy: { column: 'time', mode: 'hourOfDay', colourLine: true },
						sizeBy: { column: 'values', minRadius: 1.5, maxRadius: 6 }
					}
				]
			}
		]
	};
	const dry = await call('check_draft', draft, env);
	assert.deepEqual(dry.body.result.structuredContent.errors, []);
	assert.match(
		dry.body.result.content[0].text,
		/scatterplot "Loop"; series "Activity" colour by "time" \(hourOfDay, line too\); series "Activity" size by "values" \(auto, 1\.5 to 6 px\)/
	);

	const built = await call('build_session', draft, env);
	const { body } = await call(
		'describe_session',
		{ session: built.body.result.structuredContent.sessionId },
		env
	);
	assert.match(
		body.result.content[0].text,
		/series "Activity" colour by "time" \(hourOfDay, line too\)/
	);
	assert.deepEqual(body.result.structuredContent.plots[0].encodings, [
		{
			series: 'Activity',
			channel: 'colour',
			column: 'time',
			mode: 'hourOfDay',
			colormap: 'auto',
			colourLine: true
		},
		{
			series: 'Activity',
			channel: 'size',
			column: 'values',
			mode: 'auto',
			minRadius: 1.5,
			maxRadius: 6
		}
	]);

	// A refused encoding is reported, and the plot is still built.
	const bad = await call(
		'check_draft',
		{
			...draft,
			plots: [
				{
					...draft.plots[0],
					series: [{ x: 'time', y: 'values', sizeBy: { column: 'time', mode: 'hourOfDay' } }]
				}
			]
		},
		env
	);
	assert.match(bad.body.result.structuredContent.errors.join('\n'), /size cannot read "hourOfDay"/);
	assert.deepEqual(bad.body.result.structuredContent.plots, ['scatterplot']);
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
	const { body } = await call('describe_session', {
		session: '11111111-2222-3333-4444-555555555555'
	});
	assert.equal(body.result.isError, true);
	assert.match(body.result.content[0].text, /transient|expire/i);
});

// ---- per-column time zone (plan 2026-10-20 per-column time zone, section 5e) -------------

const NZ = 'Pacific/Auckland';
const hourly = (n) =>
	Array.from({ length: n }, (_, i) => `2024-04-01T${String(i % 24).padStart(2, '0')}:00:00`);
const ZONE_DRAFT = {
	columns: [
		{ name: 'hive_t', type: 'time', values: hourly(24), time_zone: NZ },
		{ name: 'hive', values: hourly(24).map((_, i) => 30 + (i % 5)) },
		{ name: 'air_t', type: 'time', values: hourly(24) },
		{ name: 'air', values: hourly(24).map((_, i) => 10 + i) }
	],
	analyses: [
		{
			name: 'JoinData',
			args: { aTimeIN: 'hive_t', bTimeIN: 'air_t', aValuesIN: ['hive'], bValuesIN: ['air'] }
		}
	],
	plots: [
		{
			type: 'actogram',
			name: 'Both',
			series: [
				{ time: 'hive_t', values: 'hive' },
				{ time: 'air_t', values: 'air' }
			]
		}
	]
};

test('tools/list: a draft column takes time_zone (build_session and check_draft)', async () => {
	const { body } = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
	for (const name of ['build_session', 'check_draft']) {
		const tool = body.result.tools.find((t) => t.name === name);
		const col = tool.inputSchema.properties.columns.items.properties;
		assert.equal(col.time_zone.type, 'string', name);
		assert.match(col.time_zone.description, /Pacific\/Auckland/);
	}
});

test("check_draft warns when one Join Data or one plot mixes zones, in the app's words", async () => {
	const { body } = await call('check_draft', ZONE_DRAFT);
	const sc = body.result.structuredContent;
	assert.deepEqual(sc.errors, []);
	assert.deepEqual(sc.warnings, [
		"Join Data: B's times have no zone, so they are read as UTC. If they were recorded in Pacific/Auckland time, set B's zone (in its column's Properties) and the two line up.",
		'Plot "Both": The series\' times are in different zones; the rows follow Pacific/Auckland, the first series\' zone.'
	]);
	assert.match(body.result.content[0].text, /WARNINGS:[\s\S]*different zones/);
});

test('check_draft: a shift between two zoned columns is the double-correction warning', async () => {
	const draft = structuredClone(ZONE_DRAFT);
	draft.columns[2].time_zone = '+05:30';
	draft.analyses[0].args.shiftB = 7;
	draft.plots = [];
	const { body } = await call('check_draft', draft);
	assert.deepEqual(body.result.structuredContent.warnings, [
		"Join Data: A's times are in Pacific/Auckland and B's in UTC+05:30 (fixed); each is read in its own zone, so they already line up and the zones account for the difference: check the 7 h shift."
	]);
});

test('check_draft: one zone everywhere warns of nothing', async () => {
	const draft = structuredClone(ZONE_DRAFT);
	draft.columns[2].time_zone = NZ;
	const { body } = await call('check_draft', draft);
	assert.deepEqual(body.result.structuredContent.warnings, []);
	assert.equal(body.result.structuredContent.ok, true);
});

test('check_draft refuses an unknown zone, naming what to write instead', async () => {
	const draft = structuredClone(ZONE_DRAFT);
	draft.columns[0].time_zone = 'Auckland';
	const { body } = await call('check_draft', draft);
	const sc = body.result.structuredContent;
	assert.equal(sc.ok, false);
	assert.equal(
		sc.errors[0],
		'Column "hive_t": time_zone "Auckland" is not a time zone. Use an IANA name such as "Pacific/Auckland" (follows daylight saving), a fixed offset such as "+12:00" (never changes), or "utc". Skipped.'
	);
	assert.ok(!sc.columns.includes('hive_t'));
});

test("describe_session reports each time column's zone and how its times read", async () => {
	const env = ENV();
	const draft = structuredClone(ZONE_DRAFT);
	draft.columns.push({
		name: 'epoch_t',
		type: 'time',
		values: [Date.UTC(2024, 3, 1), Date.UTC(2024, 3, 1, 1)],
		time_zone: '+1200'
	});
	const built = await call('build_session', draft, env);
	const { sessionId } = built.body.result.structuredContent;
	const { body } = await call('describe_session', { session: sessionId }, env);
	const cols = Object.fromEntries(body.result.structuredContent.columns.map((c) => [c.name, c]));
	assert.deepEqual(cols.hive_t, {
		name: 'hive_t',
		type: 'time',
		hasData: true,
		timeZone: NZ,
		times: 'wall clock'
	});
	assert.deepEqual(
		{ timeZone: cols.air_t.timeZone, times: cols.air_t.times },
		{ timeZone: 'utc', times: 'as written' }
	);
	assert.deepEqual(
		{ timeZone: cols.epoch_t.timeZone, times: cols.epoch_t.times },
		{ timeZone: '+12:00', times: 'instants' }
	);
	assert.equal(cols.hive.timeZone, undefined);
	const text = body.result.content[0].text;
	assert.match(
		text,
		/hive_t \(time, 24 values, Pacific\/Auckland: written times read in that zone\)/
	);
	assert.match(text, /air_t \(time, 24 values, as written \(no zone, read as UTC\)\)/);
	assert.match(text, /epoch_t \(time, 2 values, UTC\+12:00 \(fixed\): instants\)/);
});
