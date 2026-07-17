// Backend for the "natural language → AnCiR session" app.
//
//   POST /build {prompt, llm?, options?} → agent builds a session via the AnCiR MCP,
//                 exports the JSON, stores it, returns { sessionUrl, ancirUrl, trace }.
//   GET  /sessions/:id → serves that session JSON (CORS-open) for AnCiR ?loadFromURL=.
//   GET  /config       → { ancirBase } for the static UI.
//   GET  /             → the static chat page (app/public/index.html).
//
// Bring-your-own-model: the caller supplies their own endpoint/key/model per request
// (never logged/stored). Per-request isolation: a fresh MCP server per build.
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { buildSession } from './agent.mjs';
import { validateBuild } from './validation.js';
import { log } from './log.js';

// PORT is what most hosts inject (Render/Railway/Fly/…); APP_PORT is the local name.
const PORT = Number(process.env.PORT || process.env.APP_PORT) || 5273;
const HOST = process.env.APP_HOST || '127.0.0.1'; // set APP_HOST=0.0.0.0 to bind publicly
const isPublicBind = HOST === '0.0.0.0' || HOST === '::';
const ANCIR_BASE = (process.env.ANCIR_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
const TTL_MS = Number(process.env.SESSION_TTL_MS) || 60 * 60 * 1000;
const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url));

/** @type {Map<string,{json:string, ts:number}>} */
const store = new Map();
const prune = () => {
	const now = Date.now();
	for (const [id, e] of store) if (now - e.ts > TTL_MS) store.delete(id);
};

// Public base for session URLs — APP_BASE_URL, else derived from the request (so an
// ephemeral Cloudflare quick-tunnel URL works with zero config).
function selfBase(req) {
	if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/+$/, '');
	const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
	const host = req.headers['x-forwarded-host'] || req.headers.host || `${HOST}:${PORT}`;
	return `${proto}://${host}`;
}
const ancirUrlFor = (sessionUrl) => `${ANCIR_BASE}/?loadFromURL=${encodeURIComponent(sessionUrl)}`;

/** Build the Express app (no listen) — importable for tests. */
export function createApp() {
	const app = express();
	// One proxy hop in front (Cloudflare tunnel / reverse proxy) so req.ip = the real
	// client for rate limiting. Configurable; a number avoids express-rate-limit's
	// permissive-trust-proxy warning.
	app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
	app.use(express.json({ limit: '1mb' }));

	// Lightweight request log (skip health/static noise); secrets are never in the path.
	app.use((req, res, next) => {
		const start = Date.now();
		res.on('finish', () => {
			if (req.path === '/health' || req.method === 'GET') return;
			log.info({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start }, 'req');
		});
		next();
	});

	app.get('/health', (_req, res) => res.json({ ok: true, sessions: store.size }));
	app.get('/config', (_req, res) => res.json({ ancirBase: ANCIR_BASE }));

	const buildLimiter = rateLimit({
		windowMs: Number(process.env.BUILD_RATE_WINDOW_MS) || 60_000,
		limit: Number(process.env.BUILD_RATE_MAX) || 10,
		standardHeaders: true,
		legacyHeaders: false,
		message: { error: 'Too many builds — please wait a moment and try again.' }
	});

	app.post('/build', buildLimiter, async (req, res) => {
		const reqId = randomUUID().slice(0, 8);
		// Validate + SSRF-guard (never logs the body / key).
		const v = validateBuild(req.body, { isPublic: isPublicBind });
		if (!v.ok) return res.status(400).json({ error: v.error });
		const { prompt, llm, options } = v.value;
		try {
			prune();
			const t0 = Date.now();
			const { json, trace, planner, model, promptVersion } = await buildSession({
				prompt,
				sessionId: 'app-' + reqId,
				llm,
				options
			});
			const id = randomUUID();
			store.set(id, { json, ts: Date.now() });
			const sessionUrl = `${selfBase(req)}/sessions/${id}`;
			const note =
				planner === 'scripted'
					? 'SCRIPTED planner (no model configured) — ignores your prompt and always builds a cosine demo. Add your own model in Model settings for real natural-language following.'
					: undefined;
			log.info({ reqId, planner, model, promptVersion, turns: trace.length, ms: Date.now() - t0, bytes: json.length }, 'build');
			res.json({ id, planner, model, note, trace, sessionUrl, ancirUrl: ancirUrlFor(sessionUrl) });
		} catch (err) {
			log.error({ reqId, err: err?.message || String(err) }, 'build failed'); // never the body
			res.status(500).json({ error: err?.message || String(err) });
		}
	});

	app.get('/sessions/:id', (req, res) => {
		const e = store.get(req.params.id);
		if (!e) return res.status(404).json({ error: 'not found or expired' });
		// CORS-open so the AnCiR GUI (a different origin) can fetch the session.
		res.set('Access-Control-Allow-Origin', '*');
		res.type('application/json').send(e.json);
	});

	// Static chat UI (decoupled from server code; the page reads /config at runtime).
	app.use(express.static(PUBLIC_DIR));
	return app;
}

// --- startup ---------------------------------------------------------------------

function validateEnv() {
	const r = z
		.object({
			ANCIR_BASE_URL: z.string().url().optional(),
			APP_BASE_URL: z.string().url().optional(),
			PORT: z.coerce.number().int().positive().optional(),
			APP_PORT: z.coerce.number().int().positive().optional()
		})
		.safeParse(process.env);
	if (!r.success) for (const i of r.error.issues) log.warn({ var: i.path.join('.'), issue: i.message }, 'env');
	// Mixed-content trap: an https AnCiR can't fetch an http session URL.
	if (isPublicBind && !ANCIR_BASE.startsWith('https://')) {
		log.warn(`ANCIR_BASE_URL is not https (${ANCIR_BASE}); an HTTPS AnCiR app will block loading the session (mixed content).`);
	}
}

async function checkAncir() {
	try {
		const r = await fetch(`${ANCIR_BASE}/`, { signal: AbortSignal.timeout(2500) });
		if (r.ok) log.info(`AnCiR reachable at ${ANCIR_BASE}`);
		else log.warn(`AnCiR at ${ANCIR_BASE} returned HTTP ${r.status}`);
	} catch {
		log.warn(`AnCiR NOT reachable at ${ANCIR_BASE} — start it (npm run dev) or set ANCIR_BASE_URL.`);
	}
}

export function startServer() {
	validateEnv();
	const app = createApp();
	app.listen(PORT, HOST, () => {
		log.info(`AnCiR NL-app backend on http://${HOST}:${PORT}  (AnCiR base: ${ANCIR_BASE})`);
		log.info(
			process.env.OPENAI_API_KEY
				? `Model: server default ${process.env.MODEL || 'gpt-4o-mini'} @ ${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'} (users can override via Model settings)`
				: 'Model: bring-your-own — users enter their endpoint/key/model in "Model settings"; requests without one use the scripted demo.'
		);
		checkAncir();
	});
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
