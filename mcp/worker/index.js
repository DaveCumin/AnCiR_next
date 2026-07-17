// NL → AnCiR session, as a Cloudflare Worker (ADR 2026-07-15-static-session-emission, Phase 3).
//
// This is the whole product surface with NO engine: the model emits one JSON draft, the pure
// normalizer turns it into a session, and the AnCiR SPA computes the analyses in the user's
// browser when it loads it. That's why this fits a Worker — no vite-node, no ~1 GB compile, no
// VM. Deploy it beside AnCiR (same free Cloudflare account).
//
// Routes
//   POST /build        {prompt, llm:{baseUrl,apiKey,model}, options?} → {url, sessionId, …}
//   POST /edit         {prompt, session, llm?} → {analyses, plots, changes} (a spec, not a session)
//   POST /mcp          remote MCP server (JSON-RPC) — an agent builds sessions with no clone
//   POST /report       a crash the app caught, for the logs
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
import { scoreIntent, repairIsBetter, buildManifest } from '../src/emit/intent.js';
import { checkFitness } from '../src/emit/fitness.js';
import { buildDraftPrompt } from './draftPrompt.js';
import { buildEditPrompt } from './editPrompt.js';
import { validateBuild, validateEdit } from '../app/validation.js';
import { chatCompletion } from '../app/llmClient.js';
import { handleMcp } from './mcp.js';
import { fingerprint } from './fingerprint.js';

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	// Mcp-* headers are sent by MCP clients; browser-based ones are blocked without these.
	'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id',
	'Access-Control-Expose-Headers': 'Mcp-Session-Id'
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
function logEvent(event, fields) {
	// Log the OBJECT, not a JSON string. Workers Logs indexes an object's fields, so the
	// dashboard can filter on them (outcome = "llm_rate_limited", search `prompt`, …). A
	// JSON.stringify'd string arrives as one opaque message you can only text-search.
	console.log({ event, ts: new Date().toISOString(), ...fields });
}

/**
 * Per-IP throttle for /build. Matters because the default model runs on OUR key, so an
 * unthrottled endpoint is an open, funded proxy.
 *
 * Prefers Cloudflare's own rate limiter ([[ratelimits]] binding) — enforced at the edge and
 * accurate. Falls back to a KV counter when the binding isn't present (tests, or a stripped
 * config), which is only best-effort: KV is eventually consistent, so a burst can slip past.
 */
async function rateLimited(env, request) {
	const ip = request.headers.get('CF-Connecting-IP') ?? 'anon';

	if (env.RATE_LIMITER?.limit) {
		const { success } = await env.RATE_LIMITER.limit({ key: ip });
		return !success;
	}

	const max = Number(env.BUILD_RATE_MAX ?? 0);
	if (!max || !env.SESSIONS) return false;
	const key = `rl:${ip}:${Math.floor(Date.now() / 60000)}`; // per-minute bucket
	const n = Number((await env.SESSIONS.get(key)) ?? 0) + 1;
	await env.SESSIONS.put(key, String(n), { expirationTtl: 120 });
	return n > max;
}

/**
 * Ask the model for one JSON object, and turn every way that can fail into the response the
 * user should see. Shared by /build and /edit — the failure modes are identical, and the
 * mapping below is the part worth getting right once (a raw "502" tells a user nothing they
 * can act on).
 *
 * @returns {Promise<{draft: object} | {response: Response}>}
 */
async function askModel({ llm, system, user, options: o, callerKey, done }) {
	let reply;
	try {
		reply = await chatCompletion(
			llm,
			{
				messages: [
					{ role: 'system', content: system },
					{ role: 'user', content: user }
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
		return { response: json({ error: `LLM request failed: ${e?.message ?? e}` }, 502) };
	}

	if (!reply.ok) {
		// The provider's own message is the informative part ("Limit 14400, Used 14400, please
		// try again in 2m"). It never contains the key.
		const providerMsg =
			reply.json?.error?.message ??
			(typeof reply.body === 'string' ? reply.body.slice(0, 300) : undefined);

		// Rate / usage limits are the EXPECTED failure when everyone shares the default key, so
		// name it plainly and pass the 429 through rather than a blanket 502 — the UI can then
		// tell the user to wait or bring their own. chatCompletion already retried with backoff
		// (honouring Retry-After), so getting here means it's still limited.
		if (reply.status === 429) {
			done('llm_rate_limited', { status: 429, detail: providerMsg });
			return {
				response: json(
					{
						error:
							'The AI model has reached its rate or usage limit. Wait a little and try again, or use your own API key under Advanced.',
						detail: providerMsg
					},
					429,
					{ 'Retry-After': '60' }
				)
			};
		}

		// A rejected key isn't something the user can fix by retrying. Whose key it was decides
		// whose problem it is.
		if (reply.status === 401 || reply.status === 403) {
			done('llm_key_rejected', { status: reply.status });
			return {
				response: json(
					{
						error: callerKey
							? 'That API key was rejected by the provider. Check the key, model and endpoint under Advanced.'
							: 'The AI service is misconfigured — its API key was rejected. Please report this.',
						detail: providerMsg
					},
					502
				)
			};
		}

		done('llm_error', { status: reply.status });
		return {
			response: json({ error: `LLM error ${reply.status}`, detail: providerMsg ?? reply.body }, 502)
		};
	}

	try {
		return { draft: extractDraft(reply.message?.content) };
	} catch (e) {
		done('unparseable_draft', { error: e.message });
		return { response: json({ error: `could not parse a session draft: ${e.message}` }, 502) };
	}
}

/**
 * The follow-up message for a repair round: the model's own answer, and precisely what was
 * unusable about it.
 *
 * Quotes the errors verbatim because they're already the most useful thing in the system — they
 * name the bad reference AND list what was actually available, which is exactly what the model
 * needed and didn't have. Insists on the WHOLE object back: a patch would have to be applied,
 * and applying a model's patch to a model's JSON is a second thing to get wrong.
 */
export function repairPrompt(userPrompt, draft, errors) {
	return [
		userPrompt,
		'',
		'You already answered this, and most of it was fine. This was your answer:',
		JSON.stringify(draft),
		'',
		'These parts could NOT be used and were dropped:',
		...errors.map((e) => `- ${e}`),
		'',
		'Each message above names what was wrong and lists the columns that actually exist.',
		'Reply with the WHOLE corrected JSON object — same shape, same rules. Fix only those',
		'problems and keep everything that worked. If a column you wanted does not exist, use',
		'one that does, or drop that part rather than inventing a name.',
		'',
		// The draft above carries its own `intent`, so the model is reading its own checklist
		// back. Saying it's binding costs one line and closes the cheapest way out of a repair:
		// delete the hard part, delete the promise, declare success.
		'Your "intent" is the checklist you are held to. Keep it as it is — do not drop a',
		'deliverable to make an error go away. Every deliverable must still be built.'
	].join('\n');
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

	if (await rateLimited(env, request)) {
		// A human hitting this is rare, so say something they can act on rather than "429".
		return json(
			{ error: 'Too many requests. Please wait a minute and try again.', retryAfterS: 60 },
			429,
			{ 'Retry-After': '60' }
		);
	}

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
		logEvent('build', { ...log, outcome, ms: Date.now() - started, ...extra });

	const draftOrError = await askModel({
		llm,
		system: buildDraftPrompt(),
		user: v.value.prompt,
		options: v.value.options ?? {},
		callerKey: !!v.value.llm?.apiKey,
		done
	});
	if (draftOrError.response) return draftOrError.response;
	const draft = draftOrError.draft;

	// The id is minted BEFORE normalising so it can be stamped into the session itself — the
	// session and the log line have to agree on it for the join to work.
	const sessionId = crypto.randomUUID();
	const provenance = fingerprint('build', sessionId, { model: llm.model });

	let { session, warnings, errors } = normalizeSession(draft, { provenance });
	let repaired = false;

	// What the model SAID it was building, checked against what it did build. The draft states
	// it in the same reply, so this costs no extra call — see src/emit/intent.js for why a
	// self-reported contract is still worth having.
	let score = scoreIntent(draft.intent, session);

	// Give the model its own mistakes back, ONCE.
	//
	// The normalizer already knows exactly what went wrong and says so — "no column named
	// time_1. Available: time, values, values_1, values_2" — and we were showing that to the
	// USER, who can't do anything with it but reword and hope. The model can: it's a precise,
	// mechanical correction, and it's the same class of error every time (a plausible column
	// name that doesn't exist).
	//
	// This is the durable half of the fix. No prompt can anticipate every wrong guess a model
	// will make; a repair round fixes any of them the normalizer can diagnose, including the
	// ones nobody has thought of yet.
	//
	// Strictly once, and only if it actually helps: a second failure is a real dead end, and
	// looping would burn the token budget an 8K/min free tier doesn't have.
	if (errors.length) {
		const retry = await askModel({
			llm,
			system: buildDraftPrompt(),
			user: repairPrompt(v.value.prompt, draft, errors),
			options: v.value.options ?? {},
			callerKey: !!v.value.llm?.apiKey,
			done: (outcome, extra) => done(`repair_${outcome}`, extra)
		});
		if (retry.draft) {
			const second = normalizeSession(retry.draft, { provenance });
			// Keep it only if it's genuinely better. A repair that trades one broken plot for
			// another, or that quietly drops what DID work, is worse than the first answer.
			//
			// Scored against the FIRST draft's intent, deliberately — never the repair's own.
			// The contract is whatever the model understood the USER to want, and that reading
			// is at its most honest before it hits any trouble. Let the repair restate its
			// intent and it can simply promise less, which is the one escape route that makes
			// a checklist worthless.
			const secondScore = scoreIntent(draft.intent, second.session);
			const better = repairIsBetter(
				{ errors, session, score },
				{ errors: second.errors, session: second.session, score: secondScore }
			);
			if (better) {
				({ session, warnings, errors } = second);
				score = secondScore;
				repaired = true;
			}
		}
	}
	// A draft that produced nothing usable is a failure, not an empty session.
	if (!session.tableProcesses.length && !session.data.length) {
		done('empty_session', { errors, warnings });
		return json({ error: 'the draft produced an empty session', errors, warnings }, 422);
	}

	if (!env.SESSIONS) return json({ error: 'SESSIONS KV binding is not configured' }, 500);
	await env.SESSIONS.put(`s:${sessionId}`, JSON.stringify(session), {
		expirationTtl: Number(env.SESSION_TTL_S ?? 86400)
	});

	// Success. `errors`/`warnings` can be non-empty even here (a node was dropped or its
	// dynamic outputs weren't pre-allocated) — exactly what's worth reviewing later.
	//
	// `repaired` is the number to watch: it says how often the model gets it wrong first time,
	// and a rise in it points at a catalogue that's misleading models rather than at one bad
	// prompt. Repairs that were still not good enough show up as `ok` with a non-empty `errors`.
	const manifest = buildManifest(score, session);

	// Is this analysis a sensible thing to do to this data? Deliberately AFTER any repair (it
	// judges what the user will actually open) and deliberately not part of one: every finding
	// here is a judgement call on a spectrum, so it advises and never blocks. See fitness.js.
	const fitness = checkFitness(session);

	done('ok', {
		sessionId,
		nodes: session.tableProcesses.map((t) => t.name),
		plots: session.plots.map((p) => p.type),
		repaired,
		// The count worth alerting on: a high finding means we built something error-free that
		// will mislead a scientist — 1.5 cycles, or a period under Nyquist.
		fitnessHigh: fitness.filter((f) => f.severity === 'high').length,
		// Intent coverage: the metric that says whether we built what was ASKED FOR, as opposed
		// to something that merely wires up. A session can be error-free and still be 3/5.
		// Watch `intentMissing` — it names the deliverables we keep failing to build.
		intentMet: score ? `${score.met}/${score.verifiable}` : null,
		intentMissing: manifest?.missing ?? [],
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
		// What was built, what was assumed, what's missing — auditable without reading the graph.
		// null when the model stated no intent; we never synthesise one by describing the graph
		// back at the user, which would only ever say "I built what I built".
		manifest,
		// Advice, not errors: the session is valid and will open. These say whether the numbers
		// it produces are worth believing.
		fitness,
		warnings,
		errors
	});
}

/**
 * POST /edit — propose changes to the session the user already has open.
 *
 * Returns a SPEC ({analyses, plots, changes}), not a session: the session lives in the browser
 * and this Worker has never seen it. The client compiles the spec into ops against the real
 * session and validates every reference before applying (src/lib/utils/aiEdit.js) — nothing
 * here is trusted, which is also why we don't bother storing anything.
 */
async function handleEdit(request, env) {
	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'body must be JSON' }, 400);
	}

	const isPublic = env.ALLOW_LOCAL_LLM !== '1';
	const v = validateEdit(body, { isPublic });
	if (!v.ok) return json({ error: v.error }, 400);

	if (await rateLimited(env, request)) {
		return json(
			{ error: 'Too many requests. Please wait a minute and try again.', retryAfterS: 60 },
			429,
			{ 'Retry-After': '60' }
		);
	}

	const llm = {
		baseUrl: v.value.llm?.baseUrl ?? env.OPENAI_BASE_URL,
		apiKey: v.value.llm?.apiKey ?? env.OPENAI_API_KEY,
		model: v.value.llm?.model ?? env.OPENAI_MODEL
	};
	if (!llm.baseUrl || !llm.apiKey || !llm.model) {
		return json({ error: 'no model configured: supply llm.{baseUrl,apiKey,model}' }, 400);
	}

	const summary = v.value.session ?? {};
	const started = Date.now();
	const log = {
		prompt: v.value.prompt,
		model: llm.model,
		baseUrl: llm.baseUrl,
		llmKeySource: v.value.llm?.apiKey ? 'caller' : 'worker-default',
		// The shape of what they were editing, not its contents — enough to read a log line and
		// understand what the model was looking at.
		sessionSize: {
			columns: summary.columns?.length ?? 0,
			analyses: summary.analyses?.length ?? 0,
			plots: summary.plots?.length ?? 0
		}
	};
	const done = (outcome, extra = {}) =>
		logEvent('edit', { ...log, outcome, ms: Date.now() - started, ...extra });

	const specOrError = await askModel({
		llm,
		system: buildEditPrompt(summary),
		user: v.value.prompt,
		options: v.value.options ?? {},
		callerKey: !!v.value.llm?.apiKey,
		done
	});
	if (specOrError.response) return specOrError.response;
	const spec = specOrError.draft;

	const analyses = Array.isArray(spec.analyses) ? spec.analyses : [];
	const plots = Array.isArray(spec.plots) ? spec.plots : [];
	const changes = Array.isArray(spec.changes) ? spec.changes : [];
	const bands = Array.isArray(spec.bands) ? spec.bands : [];
	if (!analyses.length && !plots.length && !changes.length && !bands.length) {
		// A model that understood the request but can't express it (a deletion, say) correctly
		// returns {}. Saying so beats the client rendering an empty preview.
		//
		// The message says what the vocabulary IS rather than "no changes", because a rejection
		// here usually means the user asked for something real that we have no verb for — and
		// "the AI didn't propose any changes" sends them to reword a prompt that was fine.
		//
		// Keep this list honest against the verbs buildEditPrompt actually offers. It once
		// disclaimed restyling months after restyling shipped, which is the worst way to be
		// wrong: it talks users out of a feature they have. If you add a verb, add it here.
		done('empty_edit');
		return json(
			{
				error:
					"The AI didn't propose any changes it could make. It can add analyses and plots, change an analysis's parameters, restyle a plot, and shade a time-of-day window on one — but it can't delete or rearrange things. Try asking for something to be added or changed.",
				analyses: [],
				plots: [],
				changes: [],
				bands: []
			},
			422
		);
	}

	done('ok', {
		nodes: analyses.map((a) => a?.name),
		plots: plots.map((p) => p?.type),
		changes: changes.length,
		bands: bands.length
	});
	return json({ analyses, plots, changes, bands });
}

/**
 * POST /report — a crash AnCiR caught, so it lands beside the prompt that may have caused it.
 *
 * Everything here is untrusted and unauthenticated: anyone can POST anything. So it stores
 * nothing, echoes nothing, and hard-caps every field before it reaches the logs. The worst a
 * caller can do is write a bounded, rate-limited line.
 *
 * Deliberately NOT taken: the session itself. It's the bulk of a crash report and the part most
 * likely to hold someone's unpublished data — the app keeps its own local copy instead, which
 * the user can send if they choose. What lands here is enough to find the bug: the message, a
 * stack, where it happened, and the app version.
 */
async function handleReport(request, env) {
	let body;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'body must be JSON' }, 400);
	}

	if (await rateLimited(env, request)) {
		// A crash LOOP would otherwise report forever. Drop quietly: the client is already
		// telling the user, and a 429 here helps nobody.
		return json({ ok: true, throttled: true });
	}

	const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
	logEvent('client_error', {
		ts: new Date().toISOString(),
		message: str(body?.message, 500) ?? '(no message)',
		stack: str(body?.stack, 4000),
		// Where in the app it blew up: 'render' (a boundary caught it), 'window', 'promise'.
		source: str(body?.source, 50),
		// What the user was doing, when the app knows (e.g. 'ai-edit').
		context: str(body?.context, 200),
		version: str(body?.version, 50),
		url: str(body?.url, 300),
		userAgent: str(request.headers.get('User-Agent'), 300),
		// The session's SHAPE, not its contents — enough to see "the actogram plot did this".
		sessionShape: {
			columns: Number(body?.sessionShape?.columns) || 0,
			analyses: Number(body?.sessionShape?.analyses) || 0,
			plots: Number(body?.sessionShape?.plots) || 0
		},
		generatedBy: body?.generatedBy?.sessionId
			? { sessionId: str(body.generatedBy.sessionId, 100), route: str(body.generatedBy.route, 20) }
			: undefined
	});

	return json({ ok: true });
}

async function handleSession(id, env) {
	if (!env.SESSIONS) return json({ error: 'SESSIONS KV binding is not configured' }, 500);
	const s = await env.SESSIONS.get(`s:${id}`);
	if (!s) return json({ error: 'session not found or expired' }, 404);
	// AnCiR fetches this cross-origin, so CORS must be open.
	return new Response(s, { headers: { 'Content-Type': 'application/json', ...CORS } });
}

/**
 * POST /mcp — the remote MCP server (see mcp.js).
 *
 * Unlike /build there's no LLM call here (the calling agent IS the model), so this costs us no
 * inference and needs no key. The only cost is a KV write, so the throttle is applied per
 * build_session rather than per request — an MCP client spends 2 requests on handshake before
 * it does anything, and those shouldn't eat the budget.
 */
async function handleMcpRoute(request, env) {
	const { status, body } = await handleMcp(request, env, {
		log: (fields) => console.log(fields),
		rateLimited: () => rateLimited(env, request)
	});
	if (!body) return new Response(null, { status, headers: CORS });
	return json(body, status);
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
		if (url.pathname === '/health') return json({ ok: true });
		if (url.pathname === '/build' && request.method === 'POST') return handleBuild(request, env);
		if (url.pathname === '/edit' && request.method === 'POST') return handleEdit(request, env);
		if (url.pathname === '/report' && request.method === 'POST') return handleReport(request, env);
		if (url.pathname === '/mcp') {
			if (request.method === 'POST') return handleMcpRoute(request, env);
			// The Streamable HTTP spec has GET open a server→client SSE stream. We're stateless
			// and never push, and 405 is the spec's own way to say so — clients then just POST.
			return json({ error: 'method not allowed' }, 405);
		}
		const m = url.pathname.match(/^\/sessions\/([\w-]+)$/);
		if (m && request.method === 'GET') return handleSession(m[1], env);
		return json({ error: 'not found' }, 404);
	}
};
