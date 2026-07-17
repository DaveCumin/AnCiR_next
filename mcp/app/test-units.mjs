// Unit + endpoint tests for the NL→session backend. Run with:  node --test app/test-units.mjs
// No real LLM (mocked fetch) and no MCP spawn (mocked `call` / build-free endpoints);
// the full build round-trip is covered by app/test-roundtrip.mjs.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLlm, resolveOptions, runScripted } from './agent.mjs';
import { chatCompletion } from './llmClient.js';
import { validateBuild, checkBaseUrl } from './validation.js';
import { buildSystemPrompt } from './promptBuilder.js';

describe('resolveLlm — BYO precedence', () => {
	it('per-request llm wins; baseUrl w/o key ⇒ dummy local key', () => {
		const r = resolveLlm({ baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' });
		assert.equal(r.baseUrl, 'http://localhost:11434/v1');
		assert.equal(r.model, 'llama3.1');
		assert.equal(r.apiKey, 'local');
	});
	it('no config ⇒ empty apiKey ⇒ scripted', () => {
		assert.equal(resolveLlm({}).apiKey, '');
	});
});

describe('resolveOptions — clamping', () => {
	it('clamps out-of-range and drops absent', () => {
		const o = resolveOptions({ maxTurns: 999, temperature: 5, timeoutMs: 1 });
		assert.equal(o.maxTurns, 24);
		assert.equal(o.temperature, 2);
		assert.equal(o.timeoutMs, 5000);
		assert.equal(o.topP, undefined);
		assert.equal(o.parallelToolCalls, undefined);
	});
});

describe('runScripted — deterministic planner', () => {
	it('cosinor path: import → Cosinor(fixed period) → scatterplot', async () => {
		const calls = [];
		await runScripted({ prompt: 'fit a cosinor with period 24', call: async (n, a) => (calls.push([n, a]), '{}'), trace: [] });
		assert.deepEqual(calls.map((c) => c[0]), ['import_data', 'run_table_process', 'add_plot']);
		const tp = calls.find((c) => c[0] === 'run_table_process')[1];
		assert.equal(tp.name, 'Cosinor');
		assert.equal(tp.args.useFixedPeriod, true);
		assert.equal(tp.args.fixedPeriod, 24);
	});
	it('periodogram branch → RhythmicityAnalysis', async () => {
		const calls = [];
		await runScripted({ prompt: 'show a periodogram', call: async (n, a) => (calls.push([n, a]), '{}'), trace: [] });
		assert.equal(calls.find((c) => c[0] === 'run_table_process')[1].name, 'RhythmicityAnalysis');
	});
});

describe('chatCompletion — retry/backoff', () => {
	const cfg = { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' };
	const orig = global.fetch;
	after(() => (global.fetch = orig));

	it('retries a 429 then succeeds', async () => {
		let n = 0;
		global.fetch = async () => {
			n++;
			if (n === 1) return new Response('{"error":{}}', { status: 429, headers: { 'retry-after': '0' } });
			return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 });
		};
		const r = await chatCompletion(cfg, { messages: [] }, { retries: 3, baseDelayMs: 1 });
		assert.equal(n, 2);
		assert.equal(r.ok, true);
		assert.equal(r.message.content, 'hi');
	});
	it('returns (no throw) on a non-retryable 400, preserving tool_use_failed', async () => {
		global.fetch = async () => new Response(JSON.stringify({ error: { code: 'tool_use_failed', message: 'bad' } }), { status: 400 });
		const r = await chatCompletion(cfg, { messages: [] }, { retries: 2, baseDelayMs: 1 });
		assert.equal(r.ok, false);
		assert.equal(r.status, 400);
		assert.equal(r.json.error.code, 'tool_use_failed');
	});
	it('throws after exhausting retries on network errors', async () => {
		global.fetch = async () => {
			throw new Error('boom');
		};
		await assert.rejects(chatCompletion(cfg, { messages: [] }, { retries: 1, baseDelayMs: 1 }), /after 2 attempts/);
	});
});

describe('validation + SSRF guard', () => {
	it('rejects empty / unknown fields; accepts a plain prompt', () => {
		assert.equal(validateBuild({}, { isPublic: true }).ok, false);
		assert.equal(validateBuild({ prompt: 'hi', bogus: 1 }, { isPublic: true }).ok, false);
		assert.equal(validateBuild({ prompt: 'hi' }, { isPublic: true }).ok, true);
	});
	it('SSRF: public blocks private/non-allowlisted; local allows anything', () => {
		assert.equal(checkBaseUrl('https://api.openai.com/v1', { isPublic: true }).ok, true);
		assert.equal(checkBaseUrl('http://169.254.169.254/', { isPublic: true }).ok, false);
		assert.equal(checkBaseUrl('https://evil.example.com/v1', { isPublic: true }).ok, false);
		assert.equal(checkBaseUrl('http://localhost:11434/v1', { isPublic: false }).ok, true);
	});
});

describe('promptBuilder', () => {
	it('injects the catalogue and forces useFixedPeriod:true', () => {
		const caps = { analyses: [{ id: 'Cosinor', inputs: { scalar: ['xIN'], array: ['yIN'] }, params: { useFixedPeriod: false } }], plots: [] };
		const p = buildSystemPrompt(caps);
		assert.ok(p.includes('Cosinor: args='));
		assert.ok(p.includes('"useFixedPeriod":true'));
	});
});

describe('HTTP endpoints (no build spawn)', () => {
	let server, base;
	before(async () => {
		process.env.BUILD_RATE_MAX = '1';
		const { createApp } = await import('./server.mjs');
		server = createApp().listen(0);
		await new Promise((r) => server.once('listening', r));
		base = `http://127.0.0.1:${server.address().port}`;
	});
	after(() => server?.close());

	it('GET /health and /config', async () => {
		assert.equal((await (await fetch(`${base}/health`)).json()).ok, true);
		assert.ok((await (await fetch(`${base}/config`)).json()).ancirBase);
	});
	it('GET / serves the static chat page', async () => {
		assert.ok((await (await fetch(`${base}/`)).text()).includes('Model settings'));
	});
	it('POST /build validates (400) then rate-limits (429)', async () => {
		const post = (b) => fetch(`${base}/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
		assert.equal((await post({})).status, 400); // empty prompt (counts against limit 1)
		assert.equal((await post({ prompt: 'hi' })).status, 429); // 2nd in window
	});
	it('GET /sessions/:id → 404 for unknown id', async () => {
		assert.equal((await fetch(`${base}/sessions/nope`)).status, 404);
	});
});
