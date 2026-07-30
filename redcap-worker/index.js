/**
 * REDCap import proxy.
 *
 * A browser cannot call REDCap's API directly: it is a server-to-server POST endpoint that
 * does not send `Access-Control-Allow-Origin`, so the request goes out but the response cannot
 * be read. (`mode: 'no-cors'` does not help — it silences the error and yields an opaque
 * response.) This Worker is the server side of that call.
 *
 * DELIBERATELY SEPARATE from the ancir-nl Worker, so a REDCap incident cannot take the AI
 * button down, and so the two can carry different CORS rules and rate limits. A
 * credential-accepting route wants a tighter posture than a prompt-accepting one.
 *
 * WHAT THIS WORKER NEVER DOES
 *   - never stores a token (no KV, no D1, no cache: the token exists for the life of one request)
 *   - never logs a token, a request body, or a URL containing a token
 *   - never echoes an upstream error body, which can quote the request back
 *   - never fetches a host outside REDCAP_ALLOWED_HOSTS, and never over plain HTTP
 *
 * The last one is the load-bearing control. The CALLER supplies the endpoint URL, so without an
 * allow-list this would POST arbitrary bodies to arbitrary hosts on request: an SSRF relay
 * usable to reach internal addresses from Cloudflare's egress, with our domain as the
 * laundering hop. CORS restriction is secondary — it reduces incidental browser exposure, but a
 * non-browser client ignores CORS entirely, so the allow-list and the rate limit are the real
 * defences.
 */

/** Bytes of CSV we are willing to relay. REDCap record exports can be tens of MB. */
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function corsHeaders(request, env) {
	// Restricted to the app's own origins, unlike the ancir-nl Worker's '*'. Nothing secret
	// flows FROM the client to that one; here a token does.
	const allowed = String(env?.ALLOWED_ORIGINS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const origin = request.headers.get('Origin') ?? '';
	const ok = allowed.includes(origin);
	return {
		// No wildcard fallback: an unrecognised origin gets no ACAO header at all, so the
		// browser refuses the response rather than us quietly permitting everyone.
		...(ok ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type'
	};
}

function reply(body, status, request, env) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...JSON_HEADERS, ...corsHeaders(request, env) }
	});
}

/**
 * Is `hostname` covered by the allow-list?
 *
 * Matches on a DOT BOUNDARY, not a bare suffix. `endsWith('auckland.ac.nz')` would also accept
 * `evil-auckland.ac.nz` and `aucklandXac.nz`-style lookalikes, which is exactly the hole an
 * allow-list is supposed to close.
 */
export function hostAllowed(hostname, allowedCsv) {
	const host = String(hostname ?? '').toLowerCase();
	if (!host) return false;
	return String(allowedCsv ?? '')
		.split(',')
		.map((s) => s.trim().toLowerCase().replace(/^\.+/, ''))
		.filter(Boolean)
		.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * Validate the caller's endpoint. Returns `{ url }` or `{ error, status }`.
 *
 * HTTPS is required rather than upgraded: silently rewriting http:// would hide a
 * misconfiguration that matters, because the token travels in the body.
 */
export function validateEndpoint(endpoint, env) {
	let url;
	try {
		url = new URL(String(endpoint ?? ''));
	} catch {
		return { error: 'endpoint is not a valid URL', status: 400 };
	}
	if (url.protocol !== 'https:') {
		return { error: 'endpoint must use https', status: 400 };
	}
	if (!hostAllowed(url.hostname, env?.REDCAP_ALLOWED_HOSTS)) {
		// The message names the host but not the allow-list: enumerating permitted internal
		// hosts to an unauthenticated caller is free reconnaissance.
		return { error: `endpoint host is not permitted: ${url.hostname}`, status: 403 };
	}
	return { url };
}

/**
 * Build the form body REDCap expects.
 *
 * `record` exports the whole project the token can reach. `report` runs a saved report, which
 * is the safer default: a report can exclude identifiers, so the credential cannot pull them
 * even if it is misused. Hence report_id being required when content=report — silently falling
 * back to a full record export would turn a careful choice into a broad one.
 */
export function buildRedcapBody({ token, content, reportId }) {
	const body = new URLSearchParams();
	body.set('token', token);
	body.set('format', 'csv');
	body.set('returnFormat', 'json'); // errors come back as JSON, data as CSV
	if (content === 'report') {
		body.set('content', 'report');
		body.set('report_id', String(reportId));
		body.set('csvDelimiter', '');
		body.set('rawOrLabel', 'label');
		body.set('rawOrLabelHeaders', 'raw');
		body.set('exportCheckboxLabel', 'false');
	} else {
		body.set('content', 'record');
		body.set('type', 'flat');
	}
	return body;
}

/**
 * Emit one log line. Deliberately a fixed field set: `event`, `outcome`, `host`, `content`,
 * `ms`, `bytes`, and nothing else.
 *
 * The ancir-nl Worker's D1 schema says the log must "NEVER store the API key or an IP", and
 * observability there runs at head_sampling_rate 1 — every invocation is captured. The same
 * applies here, so this function takes only the fields it is allowed to record rather than an
 * arbitrary object that a later caller could over-fill. redcap.test.js asserts the token never
 * appears in what this emits.
 */
export function logLine(fields) {
	const { event, outcome, host, content, ms, bytes } = fields ?? {};
	console.log(JSON.stringify({ event, outcome, host, content, ms, bytes }));
}

async function handleRedcap(request, env) {
	const started = Date.now();
	let payload;
	try {
		payload = await request.json();
	} catch {
		logLine({ event: 'redcap', outcome: 'bad_json' });
		return reply({ error: 'body must be JSON' }, 400, request, env);
	}

	const { endpoint, token, content = 'record', reportId } = payload ?? {};
	if (typeof token !== 'string' || token.length < 8) {
		logLine({ event: 'redcap', outcome: 'no_token' });
		return reply({ error: 'token is required' }, 400, request, env);
	}
	if (content !== 'record' && content !== 'report') {
		logLine({ event: 'redcap', outcome: 'bad_content' });
		return reply({ error: "content must be 'record' or 'report'" }, 400, request, env);
	}
	if (content === 'report' && !String(reportId ?? '').match(/^\d+$/)) {
		logLine({ event: 'redcap', outcome: 'bad_report_id' });
		return reply(
			{ error: 'reportId (numeric) is required when content is "report"' },
			400,
			request,
			env
		);
	}

	const checked = validateEndpoint(endpoint, env);
	if (checked.error) {
		// Logged with the host so a blocked attempt is visible, and NO fetch is performed.
		logLine({ event: 'redcap', outcome: 'host_blocked', host: safeHost(endpoint), content });
		return reply({ error: checked.error }, checked.status, request, env);
	}
	const host = checked.url.hostname;

	if (env?.RATE_LIMITER?.limit) {
		const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
		const { success } = await env.RATE_LIMITER.limit({ key: ip });
		if (!success) {
			logLine({ event: 'redcap', outcome: 'rate_limited', host, content });
			return reply({ error: 'rate limited, try again shortly' }, 429, request, env);
		}
	}

	let upstream;
	try {
		upstream = await fetch(checked.url.toString(), {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: buildRedcapBody({ token, content, reportId })
		});
	} catch {
		logLine({
			event: 'redcap',
			outcome: 'upstream_unreachable',
			host,
			content,
			ms: Date.now() - started
		});
		return reply({ error: 'could not reach the REDCap server' }, 502, request, env);
	}

	if (!upstream.ok) {
		// The upstream body is NOT forwarded: REDCap's error text can quote the request back,
		// which would put the token in our response and in the browser console.
		logLine({
			event: 'redcap',
			outcome: `upstream_${upstream.status}`,
			host,
			content,
			ms: Date.now() - started
		});
		const hint =
			upstream.status === 403
				? 'REDCap rejected the token (403). Check the token and that it has export rights.'
				: `REDCap returned ${upstream.status}.`;
		return reply({ error: hint }, 502, request, env);
	}

	const maxBytes = Number(env?.REDCAP_MAX_BYTES ?? DEFAULT_MAX_BYTES);
	const csv = await upstream.text();
	const bytes = new TextEncoder().encode(csv).length;
	if (bytes > maxBytes) {
		logLine({
			event: 'redcap',
			outcome: 'too_large',
			host,
			content,
			ms: Date.now() - started,
			bytes
		});
		return reply(
			{
				error: `response is ${(bytes / 1048576).toFixed(1)} MB, over the ${(maxBytes / 1048576).toFixed(0)} MB limit. Use a saved report, or narrow the fields.`
			},
			413,
			request,
			env
		);
	}

	logLine({ event: 'redcap', outcome: 'ok', host, content, ms: Date.now() - started, bytes });
	return new Response(csv, {
		status: 200,
		headers: { 'Content-Type': 'text/csv; charset=utf-8', ...corsHeaders(request, env) }
	});
}

/** Hostname of a possibly-invalid URL, for logging a blocked attempt without throwing. */
function safeHost(endpoint) {
	try {
		return new URL(String(endpoint)).hostname;
	} catch {
		return 'invalid';
	}
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: corsHeaders(request, env) });
		}
		if (url.pathname === '/health') {
			return reply(
				{ ok: true, allowedHosts: String(env?.REDCAP_ALLOWED_HOSTS ?? '') },
				200,
				request,
				env
			);
		}
		if (url.pathname === '/redcap' && request.method === 'POST') {
			return handleRedcap(request, env);
		}
		return reply({ error: 'not found' }, 404, request, env);
	}
};
