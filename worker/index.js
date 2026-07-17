// NL → AnCiR session, as a Cloudflare Worker (ADR 2026-07-15-static-session-emission, Phase 3).
//
// This is the whole product surface with NO engine: the model emits one JSON draft, the pure
// normalizer turns it into a session, and the AnCiR SPA computes the analyses in the user's
// browser when it loads it. That's why this fits a Worker — no vite-node, no ~1 GB compile, no
// VM. Deploy it beside AnCiR (same free Cloudflare account).
//
// Routes
//   POST /build        {prompt, llm:{baseUrl,apiKey,model}, options?} → {url, sessionId, …}
//   GET  /sessions/:id → the session JSON (CORS *, so AnCiR can fetch it cross-origin)
//   GET  /health       → {ok:true}
//
// Bring-your-own model: the caller's apiKey is used for one upstream call and never stored or
// logged. The Worker also exists to (a) proxy the LLM (providers don't send CORS headers, so a
// browser can't call them directly) and (b) enforce the SSRF/validation guards.
//
// Bindings: SESSIONS (KV). Vars: ANCIR_BASE_URL, optional OPENAI_* defaults, SESSION_TTL_S,
// BUILD_RATE_MAX, ALLOW_LOCAL_LLM.

import { normalizeSession } from '../src/emit/normalizer.js';
import { buildDraftPrompt } from './draftPrompt.js';
import { validateBuild } from '../app/validation.js';
import { chatCompletion } from '../app/llmClient.js';

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type'
};
const json = (data, status = 200, extra = {}) =>
	new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json', ...CORS, ...extra }
	});

/** The public origin of THIS worker, derived from the request — no config needed. */
const selfBase = (request) => new URL(request.url).origin;

/**
 * Pull the JSON object out of a model reply. Models wrap JSON in prose or a ```json fence
 * even when told not to, so be forgiving: try the whole string, then the outermost {...}.
 */
export function extractDraft(text) {
	if (typeof text !== 'string' || !text.trim()) throw new Error('model returned an empty reply');
	const stripped = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
	const candidates = [stripped];
	const first = stripped.indexOf('{');
	const last = stripped.lastIndexOf('}');
	if (first !== -1 && last > first) candidates.push(stripped.slice(first, last + 1));
	for (const c of candidates) {
		try {
			const v = JSON.parse(c);
			if (v && typeof v === 'object' && !Array.isArray(v)) return v;
		} catch {
			/* try the next candidate */
		}
	}
	throw new Error('model did not return a JSON object');
}

/**
 * Structured log of one /build, for reviewing what people ask for (Workers Logs; see
 * worker/README.md for how to read them).
 *
 * Deliberately recorded: the prompt (that's the point), which model answered, the outcome and
 * how long it took, and a session id to tie a log line to a built session.
 * Deliberately NOT recorded: any apiKey (a caller's key is theirs, and ours is a secret), and
 * the session body/data. `llmKeySource` says whose key was used without revealing it.
 * There is no IP here — add one only if you actually need it, since it makes these logs
 * personal data.
 */
function logBuild(fields) {
	console.log(JSON.stringify({ event: 'build', ts: new Date().toISOString(), ...fields }));
}

/** Best-effort per-IP throttle. Cloudflare's native rate limiting is the real defence. */
async function rateLimited(env, request) {
	const max = Number(env.BUILD_RATE_MAX ?? 0);
	if (!max || !env.SESSIONS) return false;
	const ip = request.headers.get('CF-Connecting-IP') ?? 'anon';
	const key = `rl:${ip}:${Math.floor(Date.now() / 60000)}`; // per-minute bucket
	const n = Number((await env.SESSIONS.get(key)) ?? 0) + 1;
	await env.SESSIONS.put(key, String(n), { expirationTtl: 120 });
	return n > max;
}

async function handleBuild(request, env) {
	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'body must be JSON' }, 400);
	}

	// Deployed = public ⇒ SSRF guard on. A hosted Worker can't reach a user's local Ollama
	// anyway, so only relax it for local `wrangler dev`.
	const isPublic = env.ALLOW_LOCAL_LLM !== '1';
	const v = validateBuild(body, { isPublic });
	if (!v.ok) return json({ error: v.error }, 400);

	if (await rateLimited(env, request)) return json({ error: 'rate limit exceeded' }, 429);

	const llm = {
		baseUrl: v.value.llm?.baseUrl ?? env.OPENAI_BASE_URL,
		apiKey: v.value.llm?.apiKey ?? env.OPENAI_API_KEY,
		model: v.value.llm?.model ?? env.OPENAI_MODEL
	};
	if (!llm.baseUrl || !llm.apiKey || !llm.model) {
		return json({ error: 'no model configured: supply llm.{baseUrl,apiKey,model}' }, 400);
	}

	// Everything logged for this request. `prompt` is the point of the exercise; the key never
	// appears — only whose it was.
	const started = Date.now();
	const log = {
		prompt: v.value.prompt,
		model: llm.model,
		baseUrl: llm.baseUrl,
		llmKeySource: v.value.llm?.apiKey ? 'caller' : 'worker-default'
	};
	const done = (outcome, extra = {}) =>
		logBuild({ ...log, outcome, ms: Date.now() - started, ...extra });

	const o = v.value.options ?? {};
	let reply;
	try {
		reply = await chatCompletion(
			llm,
			{
				messages: [
					{ role: 'system', content: buildDraftPrompt() },
					{ role: 'user', content: v.value.prompt }
				],
				temperature: o.temperature ?? 0,
				...(o.maxTokens ? { max_tokens: o.maxTokens } : {}),
				// Ask for JSON where supported; extractDraft copes when it's ignored.
				response_format: { type: 'json_object' }
			},
			{ retries: o.retries ?? 2, timeoutMs: o.timeoutMs ?? 60000 }
		);
	} catch (e) {
		done('llm_unreachable', { error: String(e?.message ?? e) });
		return json({ error: `LLM request failed: ${e?.message ?? e}` }, 502);
	}
	if (!reply.ok) {
		// Surface the provider's own error (bad key, unknown model, …) without the key.
		done('llm_error', { status: reply.status });
		return json({ error: `LLM error ${reply.status}`, detail: reply.json ?? reply.body }, 502);
	}

	let draft;
	try {
		draft = extractDraft(reply.message?.content);
	} catch (e) {
		done('unparseable_draft', { error: e.message });
		return json({ error: `could not parse a session draft: ${e.message}` }, 502);
	}

	const { session, warnings, errors } = normalizeSession(draft);
	// A draft that produced nothing usable is a failure, not an empty session.
	if (!session.tableProcesses.length && !session.data.length) {
		done('empty_session', { errors, warnings });
		return json({ error: 'the draft produced an empty session', errors, warnings }, 422);
	}

	const sessionId = crypto.randomUUID();
	if (!env.SESSIONS) return json({ error: 'SESSIONS KV binding is not configured' }, 500);
	await env.SESSIONS.put(`s:${sessionId}`, JSON.stringify(session), {
		expirationTtl: Number(env.SESSION_TTL_S ?? 86400)
	});

	// Success. `errors`/`warnings` can be non-empty even here (a node was dropped or its
	// dynamic outputs weren't pre-allocated) — exactly what's worth reviewing later.
	done('ok', {
		sessionId,
		nodes: session.tableProcesses.map((t) => t.name),
		plots: session.plots.map((p) => p.type),
		errors,
		warnings
	});

	const sessionUrl = `${selfBase(request)}/sessions/${sessionId}`;
	const ancir = (env.ANCIR_BASE_URL ?? 'https://ancir.pages.dev').replace(/\/+$/, '');
	return json({
		sessionId,
		sessionUrl,
		// Open this in a browser: AnCiR fetches the session and computes it client-side.
		url: `${ancir}/?loadFromURL=${encodeURIComponent(sessionUrl)}`,
		warnings,
		errors
	});
}

async function handleSession(id, env) {
	if (!env.SESSIONS) return json({ error: 'SESSIONS KV binding is not configured' }, 500);
	const s = await env.SESSIONS.get(`s:${id}`);
	if (!s) return json({ error: 'session not found or expired' }, 404);
	// AnCiR fetches this cross-origin, so CORS must be open.
	return new Response(s, { headers: { 'Content-Type': 'application/json', ...CORS } });
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
		if (url.pathname === '/health') return json({ ok: true });
		if (url.pathname === '/build' && request.method === 'POST') return handleBuild(request, env);
		const m = url.pathname.match(/^\/sessions\/([\w-]+)$/);
		if (m && request.method === 'GET') return handleSession(m[1], env);
		return json({ error: 'not found' }, 404);
	}
};
