// MVP backend for the "natural language → AnCiR session" app.
//
// Round-trip:
//   POST /build {prompt}  → LLM/scripted agent builds a session via the AnCiR MCP,
//                           exports session JSON, stores it, returns { sessionUrl,
//                           ancirUrl, trace }.
//   GET  /sessions/:id    → serves that session JSON (CORS-open) so the AnCiR GUI can
//                           fetch it via ?loadFromURL=.
//   GET  /                → a minimal chat page that POSTs /build and opens ancirUrl.
//
// This is a prototype (kept inside mcp/app/ for now); it would graduate to its own
// repo for the monetised product. Per-request isolation comes from spawning a fresh
// MCP server per build (one process = one session).
import { randomUUID } from 'node:crypto';
import express from 'express';
import { buildSession } from './agent.mjs';

const PORT = Number(process.env.APP_PORT) || 5273;
const HOST = process.env.APP_HOST || '127.0.0.1';
// Strip any trailing slash so we never produce `…5173//?loadFromURL=`.
const ANCIR_BASE = (process.env.ANCIR_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
const SELF_BASE = (process.env.APP_BASE_URL || `http://${HOST}:${PORT}`).replace(/\/+$/, '');
const TTL_MS = Number(process.env.SESSION_TTL_MS) || 60 * 60 * 1000;

/** @type {Map<string,{json:string, ts:number}>} */
const store = new Map();
const prune = () => {
	const now = Date.now();
	for (const [id, e] of store) if (now - e.ts > TTL_MS) store.delete(id);
};

const ancirUrlFor = (sessionUrl) =>
	`${ANCIR_BASE}/?loadFromURL=${encodeURIComponent(sessionUrl)}`;

const app = express();
app.use(express.json({ limit: '4mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, sessions: store.size }));

app.post('/build', async (req, res) => {
	const prompt = (req.body?.prompt ?? '').toString().trim();
	if (!prompt) return res.status(400).json({ error: 'prompt is required' });
	try {
		prune();
		const { json, trace, planner } = await buildSession({ prompt, sessionId: 'app-' + randomUUID().slice(0, 8) });
		const id = randomUUID();
		store.set(id, { json, ts: Date.now() });
		const sessionUrl = `${SELF_BASE}/sessions/${id}`;
		const note =
			planner === 'scripted'
				? 'SCRIPTED planner — ignores your prompt details and always builds a cosine demo. Set OPENAI_API_KEY (see app/.env.example) for real natural-language following.'
				: undefined;
		res.json({ id, planner, note, trace, sessionUrl, ancirUrl: ancirUrlFor(sessionUrl) });
	} catch (err) {
		console.error('build failed:', err);
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

app.get('/', (_req, res) => {
	res.type('html').send(`<!doctype html><meta charset=utf8>
<title>AnCiR — describe an analysis</title>
<style>body{font:16px system-ui;max-width:680px;margin:3rem auto;padding:0 1rem}
textarea{width:100%;height:6rem;font:inherit;padding:.6rem}button{font:inherit;padding:.6rem 1.2rem;margin-top:.6rem;cursor:pointer}
pre{background:#f4f4f5;padding:.8rem;border-radius:6px;white-space:pre-wrap}small{color:#666}</style>
<h1>Describe an analysis → open it in AnCiR</h1>
<textarea id=p placeholder="e.g. 48 hours of a 24-hour cosine, fit a cosinor and plot it"></textarea>
<div><button id=go>Build &amp; open in AnCiR</button> <small id=s></small></div>
<p><small>Requires the AnCiR GUI running at <code>${ANCIR_BASE}</code> (<code>npm run dev</code> in the repo root).</small></p>
<pre id=out hidden></pre>
<p id=link></p>
<script>
const $=s=>document.querySelector(s);
$('#go').onclick=async()=>{
  const prompt=$('#p').value.trim(); if(!prompt)return;
  $('#s').textContent='building…'; $('#out').hidden=true; $('#link').textContent='';
  try{
    const r=await fetch('/build',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt})});
    const d=await r.json(); if(!r.ok)throw new Error(d.error||r.status);
    $('#out').hidden=false; $('#out').textContent='planner: '+d.planner+(d.note?'\\n⚠ '+d.note:'')+'\\n\\n'+d.trace.join('\\n');
    // Show a clickable link (so a stopped AnCiR isn't a dead end) AND open it.
    $('#link').innerHTML='<a href="'+d.ancirUrl+'" target="_blank" rel="noopener">Open in AnCiR ↗</a> '
      +'<small>(if this fails with ERR_CONNECTION_REFUSED, the AnCiR app isn\\'t running at '+${JSON.stringify(ANCIR_BASE)}+')</small>';
    $('#s').textContent='built ✓'; window.open(d.ancirUrl,'_blank');
  }catch(e){$('#s').textContent='error: '+e.message;}
};
</script>`);
});

// Probe the AnCiR GUI so a missing dev server is reported up-front (the #1 gotcha:
// the ancirUrl points at ANCIR_BASE, which must be running for ?loadFromURL= to open).
async function checkAncir() {
	try {
		const r = await fetch(`${ANCIR_BASE}/`, { signal: AbortSignal.timeout(2500) });
		console.error(r.ok ? `✓ AnCiR reachable at ${ANCIR_BASE}` : `⚠ AnCiR at ${ANCIR_BASE} returned HTTP ${r.status}`);
	} catch {
		console.error(`⚠ AnCiR is NOT reachable at ${ANCIR_BASE}.`);
		console.error(`  Start it first (in the AnCiR repo root, not mcp/):  npm run dev`);
		console.error(`  …or point this backend elsewhere:  ANCIR_BASE_URL=<url> npm run app`);
	}
}

app.listen(PORT, HOST, () => {
	console.error(`AnCiR NL-app backend on http://${HOST}:${PORT}  (AnCiR base: ${ANCIR_BASE})`);
	console.error(
		process.env.OPENAI_API_KEY
			? `Planner: LLM (${process.env.MODEL || 'gpt-4o-mini'} @ ${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'})`
			: `Planner: SCRIPTED (no OPENAI_API_KEY) — builds a fixed cosine demo, ignores prompt details. Set OPENAI_API_KEY for natural-language following.`
	);
	console.error(`Open http://${HOST}:${PORT}/ to build a session from a prompt.`);
	checkAncir();
});
