// node --test redcap-worker/redcap.test.js
//
// Drives the Worker's fetch handler directly with a stubbed upstream, so the whole path is
// covered without deploying or touching a real REDCap server.
//
// Most of these are SECURITY tests rather than behaviour tests. The token-never-logged and
// host-allow-list properties are the reason this Worker exists, and a comment asserting them is
// worth nothing — a later refactor that starts logging the request body would pass a
// behaviour-only suite while leaking a credential on every call.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { hostAllowed, validateEndpoint, buildRedcapBody, logLine } from './index.js';

const TOKEN = 'A1B2C3D4E5F60718293A4B5C6D7E8F90';
const ORIGIN = 'https://ancir.pages.dev';

const ENV = {
	REDCAP_ALLOWED_HOSTS: 'auckland.ac.nz',
	ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`,
	REDCAP_MAX_BYTES: String(1024 * 1024)
};

/** Capture console.log so a test can assert what was, and was not, recorded. */
let logged;
const realLog = console.log;
beforeEach(() => {
	logged = [];
	console.log = (...a) => logged.push(a.join(' '));
});
afterEach(() => {
	console.log = realLog;
	globalThis.fetch = realFetch;
});

const realFetch = globalThis.fetch;

/** Stub the upstream REDCap call. Records what it was sent. */
function stubUpstream({ status = 200, body = 'record_id,value\n1,5\n' } = {}) {
	const calls = [];
	globalThis.fetch = async (url, init) => {
		calls.push({ url: String(url), body: init?.body ? String(init.body) : '' });
		return new Response(body, { status, headers: { 'Content-Type': 'text/csv' } });
	};
	return calls;
}

const post = (payload, env = ENV, origin = ORIGIN) =>
	worker.fetch(
		new Request('https://redcap.example/redcap', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Origin: origin },
			body: JSON.stringify(payload)
		}),
		env
	);

const good = (over = {}) => ({
	endpoint: 'https://redcap.auckland.ac.nz/api/',
	token: TOKEN,
	content: 'record',
	...over
});

// --- the allow-list ---------------------------------------------------------------------

test('hostAllowed matches on a dot boundary, not a bare suffix', () => {
	assert.equal(hostAllowed('redcap.auckland.ac.nz', 'auckland.ac.nz'), true);
	assert.equal(hostAllowed('auckland.ac.nz', 'auckland.ac.nz'), true);
	// The whole point of the boundary check: a lookalike domain must NOT pass.
	assert.equal(hostAllowed('evil-auckland.ac.nz', 'auckland.ac.nz'), false);
	assert.equal(hostAllowed('aucklandXac.nz', 'auckland.ac.nz'), false);
	assert.equal(hostAllowed('auckland.ac.nz.attacker.com', 'auckland.ac.nz'), false);
});

test('hostAllowed supports several institutions', () => {
	assert.equal(hostAllowed('redcap.otago.ac.nz', 'auckland.ac.nz, otago.ac.nz'), true);
	assert.equal(hostAllowed('redcap.example.com', 'auckland.ac.nz, otago.ac.nz'), false);
});

test('a blocked host is rejected and NO upstream fetch happens', async () => {
	const calls = stubUpstream();
	const res = await post(good({ endpoint: 'https://redcap.example.com/api/' }));
	assert.equal(res.status, 403);
	assert.equal(calls.length, 0, 'must not contact a non-allow-listed host at all');
});

test('plain http is rejected rather than silently upgraded', async () => {
	const calls = stubUpstream();
	const res = await post(good({ endpoint: 'http://redcap.auckland.ac.nz/api/' }));
	assert.equal(res.status, 400);
	assert.equal(calls.length, 0);
	// Upgrading would hide a real misconfiguration: the token travels in the body.
	assert.match((await res.json()).error, /https/);
});

test('the rejection message does not enumerate the allow-list', async () => {
	stubUpstream();
	const res = await post(good({ endpoint: 'https://redcap.example.com/api/' }));
	const { error } = await res.json();
	assert.match(error, /not permitted/);
	assert.equal(/auckland/.test(error), false, 'listing permitted hosts is free reconnaissance');
});

// --- the token ---------------------------------------------------------------------------

test('the token is never written to a log line', async () => {
	stubUpstream();
	await post(good());
	assert.ok(logged.length > 0, 'something should have been logged');
	for (const line of logged) {
		assert.equal(line.includes(TOKEN), false, `token leaked into a log line: ${line}`);
	}
});

test('the token is not logged on any failure path either', async () => {
	for (const [payload, env] of [
		[good({ endpoint: 'https://nope.example.com/api/' }), ENV],
		[good({ content: 'report' }), ENV], // missing reportId
		[good({ token: 'x' }), ENV]
	]) {
		logged = [];
		stubUpstream();
		await post(payload, env);
		for (const line of logged) assert.equal(line.includes(TOKEN), false, line);
	}
});

test('logLine records only the permitted fields', () => {
	logLine({
		event: 'redcap',
		outcome: 'ok',
		host: 'h',
		content: 'record',
		ms: 1,
		bytes: 2,
		token: TOKEN,
		secret: 'x'
	});
	const rec = JSON.parse(logged.at(-1));
	assert.deepEqual(Object.keys(rec).sort(), ['bytes', 'content', 'event', 'host', 'ms', 'outcome']);
	// EVERY line, not just the last: an added log statement anywhere in logLine would otherwise
	// slip past an `at(-1)` check while emitting the token. Found by mutating logLine to dump
	// its whole argument — the original assertion did not notice.
	for (const line of logged) {
		assert.equal(line.includes(TOKEN), false, `token leaked into a log line: ${line}`);
		assert.equal(line.includes('secret'), false, `unpermitted field leaked: ${line}`);
	}
});

test('the request body is never logged, however handleRedcap logs', async () => {
	// The real risk this guards is someone adding a debug log of the incoming payload. Asserted
	// over every line so an EXTRA statement cannot hide behind the permitted one.
	stubUpstream();
	await post(good());
	for (const line of logged) {
		assert.equal(line.includes(TOKEN), false, `token leaked: ${line}`);
		assert.equal(/endpoint/.test(line), false, `request body leaked: ${line}`);
	}
});

test('an upstream error body is NOT forwarded to the client', async () => {
	// REDCap error text can quote the request back, which would put the token in our response
	// and in the browser console.
	stubUpstream({ status: 403, body: `{"error":"bad token: ${TOKEN}"}` });
	const res = await post(good());
	const text = await res.text();
	assert.equal(res.status, 502);
	assert.equal(text.includes(TOKEN), false, 'upstream body leaked the token to the client');
	assert.match(text, /rejected the token/);
});

// --- record vs report --------------------------------------------------------------------

test('content=record exports the project', async () => {
	const calls = stubUpstream();
	await post(good({ content: 'record' }));
	const body = new URLSearchParams(calls[0].body);
	assert.equal(body.get('content'), 'record');
	assert.equal(body.get('type'), 'flat');
	assert.equal(body.get('format'), 'csv');
	assert.equal(body.get('token'), TOKEN);
});

test('content=report runs a saved report', async () => {
	const calls = stubUpstream();
	await post(good({ content: 'report', reportId: 42 }));
	const body = new URLSearchParams(calls[0].body);
	assert.equal(body.get('content'), 'report');
	assert.equal(body.get('report_id'), '42');
});

test('report without a numeric reportId is refused, not silently downgraded', async () => {
	const calls = stubUpstream();
	for (const reportId of [undefined, '', 'abc', '4x']) {
		const res = await post(good({ content: 'report', reportId }));
		assert.equal(res.status, 400, `reportId ${JSON.stringify(reportId)} should be refused`);
	}
	// Falling back to a full record export would turn a careful choice into a broad one.
	assert.equal(calls.length, 0);
});

test('an unknown content value is refused', async () => {
	const res = await post(good({ content: 'everything' }));
	assert.equal(res.status, 400);
});

test('buildRedcapBody asks for JSON error format so errors are parseable', () => {
	const body = buildRedcapBody({ token: TOKEN, content: 'record' });
	assert.equal(body.get('returnFormat'), 'json');
});

// --- limits and plumbing ------------------------------------------------------------------

test('an oversized response is refused with a useful message', async () => {
	stubUpstream({ body: 'x'.repeat(2 * 1024 * 1024) });
	const res = await post(good());
	assert.equal(res.status, 413);
	const { error } = await res.json();
	assert.match(error, /saved report|narrow/, 'should say what to do about it');
});

test('a successful pull returns CSV', async () => {
	stubUpstream({ body: 'record_id,value\n1,5\n' });
	const res = await post(good());
	assert.equal(res.status, 200);
	assert.match(res.headers.get('Content-Type'), /text\/csv/);
	assert.equal(await res.text(), 'record_id,value\n1,5\n');
});

test('an unreachable upstream is a 502, not a crash', async () => {
	globalThis.fetch = async () => {
		throw new Error('network');
	};
	const res = await post(good());
	assert.equal(res.status, 502);
});

test('rate limiting is applied per IP', async () => {
	stubUpstream();
	const env = { ...ENV, RATE_LIMITER: { limit: async () => ({ success: false }) } };
	const res = await post(good(), env);
	assert.equal(res.status, 429);
});

test('a missing token is refused before anything else happens', async () => {
	const calls = stubUpstream();
	const res = await post({ endpoint: 'https://redcap.auckland.ac.nz/api/' });
	assert.equal(res.status, 400);
	assert.equal(calls.length, 0);
});

// --- CORS ---------------------------------------------------------------------------------

test('an allowed origin gets an ACAO header', async () => {
	stubUpstream();
	const res = await post(good(), ENV, ORIGIN);
	assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('an unknown origin gets NO ACAO header, rather than a wildcard', async () => {
	stubUpstream();
	const res = await post(good(), ENV, 'https://evil.example');
	assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
});

test('preflight is answered', async () => {
	const res = await worker.fetch(
		new Request('https://redcap.example/redcap', {
			method: 'OPTIONS',
			headers: { Origin: ORIGIN }
		}),
		ENV
	);
	assert.equal(res.status, 204);
	assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('health reports the allow-list, and is not a data route', async () => {
	const res = await worker.fetch(new Request('https://redcap.example/health'), ENV);
	const body = await res.json();
	assert.equal(body.ok, true);
	assert.equal(body.allowedHosts, 'auckland.ac.nz');
});

test('an unknown path is a 404', async () => {
	const res = await worker.fetch(new Request('https://redcap.example/nope'), ENV);
	assert.equal(res.status, 404);
});

test('validateEndpoint rejects nonsense without throwing', () => {
	for (const bad of [undefined, '', 'not a url', 'ftp://redcap.auckland.ac.nz/']) {
		const r = validateEndpoint(bad, ENV);
		assert.ok(r.error, `${JSON.stringify(bad)} should be rejected`);
	}
});
