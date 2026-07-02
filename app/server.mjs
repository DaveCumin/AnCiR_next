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
	// Bring-your-own-model: the caller may supply their own endpoint/key/model. It is
	// used only for this request and is NEVER logged or stored server-side.
	const llm = req.body?.llm && typeof req.body.llm === 'object' ? req.body.llm : undefined;
	try {
		prune();
		const { json, trace, planner, model } = await buildSession({
			prompt,
			sessionId: 'app-' + randomUUID().slice(0, 8),
			llm
		});
		const id = randomUUID();
		store.set(id, { json, ts: Date.now() });
		const sessionUrl = `${SELF_BASE}/sessions/${id}`;
		const note =
			planner === 'scripted'
				? 'SCRIPTED planner (no model configured) — ignores your prompt and always builds a cosine demo. Add your own model in Model settings for real natural-language following.'
				: undefined;
		res.json({ id, planner, model, note, trace, sessionUrl, ancirUrl: ancirUrlFor(sessionUrl) });
	} catch (err) {
		// Never include the request body (it may carry the user's key) in logs.
		console.error('build failed:', err?.message || err);
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
input,select{font:inherit;padding:.35rem;width:100%;box-sizing:border-box}label{display:block;margin:.5rem 0}
details{margin:.8rem 0;border:1px solid #ddd;border-radius:6px;padding:.4rem .8rem}summary{cursor:pointer;font-weight:600}
pre{background:#f4f4f5;padding:.8rem;border-radius:6px;white-space:pre-wrap}small{color:#666}</style>
<h1>Describe an analysis → open it in AnCiR</h1>
<textarea id=p placeholder="e.g. 48 hours of a 24-hour cosine, fit a cosinor and plot it"></textarea>
<details id=cfg>
  <summary>Model settings (bring your own)</summary>
  <p><small>Your own model does the work. The key is sent to this server only to call your
  model for this request — it is <b>never stored</b>. Local options (Ollama / LM Studio)
  keep everything on your machine.</small></p>
  <label>Preset
    <select id=preset>
      <option value="">— choose a provider —</option>
      <option value="openai">OpenAI</option>
      <option value="groq">Groq</option>
      <option value="nvidia">NVIDIA</option>
      <option value="ollama">Ollama (local)</option>
      <option value="lmstudio">LM Studio (local)</option>
    </select>
  </label>
  <label>Base URL <input id=base placeholder="https://api.openai.com/v1"></label>
  <label>API key <input id=key type=password autocomplete=off placeholder="sk-… (leave blank for local)"></label>
  <label>Model <input id=model placeholder="gpt-4o-mini"></label>
</details>
<div><button id=go>Build &amp; open in AnCiR</button> <small id=s></small></div>
<p><small>Opens the built session in the AnCiR app at <code>${ANCIR_BASE}</code>.</small></p>
<pre id=out hidden></pre>
<p id=link></p>
<script>
const $=s=>document.querySelector(s);
const LS={base:'ancir.base',key:'ancir.key',model:'ancir.model'};
const PRESETS={
  openai:['https://api.openai.com/v1','gpt-4o-mini'],
  groq:['https://api.groq.com/openai/v1','llama-3.3-70b-versatile'],
  nvidia:['https://integrate.api.nvidia.com/v1','meta/llama-3.3-70b-instruct'],
  ollama:['http://localhost:11434/v1','llama3.1'],
  lmstudio:['http://localhost:1234/v1','']
};
$('#base').value=localStorage.getItem(LS.base)||'';
$('#key').value=localStorage.getItem(LS.key)||'';
$('#model').value=localStorage.getItem(LS.model)||'';
if($('#base').value||$('#key').value)$('#cfg').open=true;
$('#preset').onchange=()=>{const pr=PRESETS[$('#preset').value];if(pr){$('#base').value=pr[0];if(pr[1])$('#model').value=pr[1];}};
$('#go').onclick=async()=>{
  const prompt=$('#p').value.trim(); if(!prompt)return;
  const baseUrl=$('#base').value.trim(),apiKey=$('#key').value.trim(),model=$('#model').value.trim();
  localStorage.setItem(LS.base,baseUrl);localStorage.setItem(LS.key,apiKey);localStorage.setItem(LS.model,model);
  const llm={}; if(baseUrl)llm.baseUrl=baseUrl; if(apiKey)llm.apiKey=apiKey; if(model)llm.model=model;
  $('#s').textContent='building…'; $('#out').hidden=true; $('#link').textContent='';
  try{
    const r=await fetch('/build',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt,llm})});
    const d=await r.json(); if(!r.ok)throw new Error(d.error||r.status);
    $('#out').hidden=false; $('#out').textContent='planner: '+d.planner+(d.model?' ('+d.model+')':'')+(d.note?'\\n⚠ '+d.note:'')+'\\n\\n'+d.trace.join('\\n');
    $('#link').innerHTML='<a href="'+d.ancirUrl+'" target="_blank" rel="noopener">Open in AnCiR ↗</a> '
      +'<small>(if this fails to open, the AnCiR app isn\\'t reachable at '+${JSON.stringify(ANCIR_BASE)}+')</small>';
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
			? `Model: server default ${process.env.MODEL || 'gpt-4o-mini'} @ ${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'} (users can override via Model settings)`
			: `Model: bring-your-own — users enter their endpoint/key/model in the page's "Model settings"; no server key set, so requests without one fall back to the scripted demo.`
	);
	console.error(`Open http://${HOST}:${PORT}/ to build a session from a prompt.`);
	checkAncir();
});
