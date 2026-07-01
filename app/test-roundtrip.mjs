// MVP round-trip smoke: start the backend, POST a natural-language prompt, fetch the
// returned session URL exactly as the AnCiR GUI would, and assert it's a valid,
// GUI-loadable session. Verifies the NL → session → ?loadFromURL= loop end to end.
// Run from mcp/:  node app/test-roundtrip.mjs   (no LLM key → scripted planner)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.APP_PORT) || 5274;
const SERVER = fileURLToPath(new URL('./server.mjs', import.meta.url));
const MCP_DIR = fileURLToPath(new URL('..', import.meta.url));

const child = spawn(process.execPath, [SERVER], {
	cwd: MCP_DIR,
	env: { ...process.env, APP_PORT: String(PORT), APP_HOST: '127.0.0.1' },
	stdio: ['ignore', 'inherit', 'pipe']
});

await new Promise((resolve, reject) => {
	const to = setTimeout(() => reject(new Error('backend did not start')), 20000);
	child.stderr.on('data', (b) => {
		process.stderr.write(b);
		if (b.toString().includes('NL-app backend on')) {
			clearTimeout(to);
			resolve();
		}
	});
	child.on('exit', (c) => reject(new Error('backend exited early: ' + c)));
});

const base = `http://127.0.0.1:${PORT}`;
const build = await (
	await fetch(`${base}/build`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ prompt: '48 hours of a 24-hour cosine, fit a cosinor and plot time vs signal' })
	})
).json();
console.log('BUILD:', JSON.stringify({ planner: build.planner, trace: build.trace, ancirUrl: build.ancirUrl }, null, 2));

// Fetch the session JSON exactly as AnCiR's loadFromURL would.
const sessionRes = await fetch(build.sessionUrl);
const session = await sessionRes.json();
console.log('SESSION:', JSON.stringify({
	cors: sessionRes.headers.get('access-control-allow-origin'),
	columns: (session.data ?? []).length,
	tableProcesses: (session.tableProcesses ?? []).map((t) => t.name),
	plots: (session.plots ?? []).map((p) => p.type),
	version: session.version
}));

child.kill('SIGINT');

// Assertions
if (build.planner !== 'scripted') throw new Error('expected scripted planner without a key');
if (!build.ancirUrl.includes('loadFromURL=')) throw new Error('ancirUrl missing loadFromURL');
if (sessionRes.headers.get('access-control-allow-origin') !== '*') throw new Error('session not CORS-open');
if ((session.data ?? []).length < 2) throw new Error('session has too few columns');
if (!(session.tableProcesses ?? []).some((t) => t.name === 'Cosinor')) throw new Error('no Cosinor in session');
if ((session.plots ?? []).length < 1) throw new Error('no plot in session');
console.log('\nROUNDTRIP OK ✅  NL → session → ?loadFromURL= (open the ancirUrl above in AnCiR)');
process.exit(0);
