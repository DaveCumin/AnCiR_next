// End-to-end check that bring-your-own model config actually routes to the CALLER's
// endpoint (not a server key), and that validation/SSRF + graceful failure hold.
// Run from mcp/:  node app/test-byo.mjs   (no server key ⇒ no-config ⇒ scripted)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = 5288;
const SERVER = fileURLToPath(new URL('./server.mjs', import.meta.url));
const MCP = fileURLToPath(new URL('..', import.meta.url));

const child = spawn(process.execPath, [SERVER], {
	cwd: MCP,
	// APP_HOST 127.0.0.1 ⇒ local mode ⇒ SSRF guard permissive (localhost allowed).
	env: { ...process.env, APP_PORT: String(PORT), APP_HOST: '127.0.0.1', OPENAI_API_KEY: '', OPENAI_BASE_URL: '' },
	stdio: ['ignore', 'inherit', 'pipe']
});
await new Promise((ok, bad) => {
	const to = setTimeout(() => bad(new Error('server did not start')), 20000);
	child.stderr.on('data', (b) => {
		process.stderr.write(b);
		if (b.toString().includes('NL-app backend on')) {
			clearTimeout(to);
			ok();
		}
	});
});

const base = `http://127.0.0.1:${PORT}`;
const post = (body) =>
	fetch(`${base}/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) =>
		r.json().then((j) => ({ status: r.status, j }))
	);

// 1) No llm, no server key → scripted.
const a = await post({ prompt: 'make a 24h rhythm and fit a cosinor' });
console.log('no-llm →', a.j.planner);

// 2) BYO llm at a dead endpoint (retries:0 → fail fast) → attempted the caller's endpoint.
const b = await post({
	prompt: 'make a 24h rhythm and fit a cosinor',
	llm: { baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'byo-key', model: 'user-model' },
	options: { retries: 0, timeoutMs: 5000 }
});
console.log('byo-llm → status', b.status, '| tried caller endpoint:', /127\.0\.0\.1:9|fetch failed|ECONNREFUSED|LLM request failed|LLM HTTP/i.test(JSON.stringify(b.j)));

child.kill('SIGINT');
if (a.j.planner !== 'scripted') throw new Error('expected scripted without llm');
if (b.status === 200) throw new Error('BYO to a dead endpoint should not 200');
console.log('BYO OK ✅ (server used the caller-supplied endpoint, not a server key)');
process.exit(0);
