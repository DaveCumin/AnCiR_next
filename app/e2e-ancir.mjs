// Full end-to-end proof: NL prompt → backend builds a session → open the REAL AnCiR
// GUI via ?loadFromURL= → the session appears. Requires the AnCiR dev server running
// (npm run dev on :5173). Run from mcp/:  node app/e2e-ancir.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const APP_PORT = Number(process.env.APP_PORT) || 5275;
const ANCIR_BASE = process.env.ANCIR_BASE_URL || 'http://localhost:5173';
const SERVER = fileURLToPath(new URL('./server.mjs', import.meta.url));
const MCP_DIR = fileURLToPath(new URL('..', import.meta.url));
const SHOT = '/tmp/ancir-nl-e2e.png';

const child = spawn(process.execPath, [SERVER], {
	cwd: MCP_DIR,
	env: { ...process.env, APP_PORT: String(APP_PORT), APP_HOST: '127.0.0.1', ANCIR_BASE_URL: ANCIR_BASE },
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
});

const base = `http://127.0.0.1:${APP_PORT}`;
const build = await (
	await fetch(`${base}/build`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ prompt: 'a 24-hour cosine over two days, fit a cosinor and plot time vs signal' })
	})
).json();
console.log('ancirUrl:', build.ancirUrl);

const browser = await chromium.launch();
try {
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	const errors = [];
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	await page.goto(build.ancirUrl, { waitUntil: 'networkidle', timeout: 45000 });

	// The session loaded if the imported column / analysis node names show up.
	await page.getByText('signal', { exact: false }).first().waitFor({ timeout: 30000 });
	const cosinorVisible = await page
		.getByText('Cosinor', { exact: false })
		.first()
		.isVisible()
		.catch(() => false);

	await page.screenshot({ path: SHOT, fullPage: false });
	console.log(`E2E OK ✅  session appeared in AnCiR (Cosinor node visible: ${cosinorVisible}) → ${SHOT}`);
	if (errors.length) console.log('page console errors:', errors.slice(0, 3));
} finally {
	await browser.close();
	child.kill('SIGINT');
}
process.exit(0);
