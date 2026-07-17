// End-to-end smoke test for the Streamable HTTP transport: spawn the server with
// --http, connect over HTTP via the MCP client, and drive the same flow as the
// stdio smoke test. Run from mcp/:  node test/smoke-http.mjs
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const PORT = Number(process.env.MCP_HTTP_PORT) || 3019;
const endpoint = `http://127.0.0.1:${PORT}/mcp`;

// Spawn the server in HTTP mode and wait until it logs that it is listening.
const child = spawn('npx', ['vite-node', 'src/server.js', `--http=${PORT}`], {
	cwd: process.cwd(),
	stdio: ['ignore', 'inherit', 'pipe']
});

await new Promise((resolveReady, rejectReady) => {
	const timeout = setTimeout(() => rejectReady(new Error('server did not start in time')), 60000);
	child.stderr.on('data', (buf) => {
		process.stderr.write(buf);
		if (buf.toString().includes('running on http')) {
			clearTimeout(timeout);
			resolveReady();
		}
	});
	child.on('exit', (code) => rejectReady(new Error('server exited early: ' + code)));
});

const client = new Client({ name: 'smoke-http', version: '0.0.1' });
await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));

const tools = (await client.listTools()).tools.map((t) => t.name);
console.log('HTTP TOOLS:', tools.join(', '));

const call = async (name, args = {}) =>
	(await client.callTool({ name, arguments: args })).content?.[0]?.text;

await call('create_session', { id: 'http-smoke' });
const t = [];
const y = [];
for (let i = 0; i < 48; i++) {
	t.push(i);
	y.push(10 + 5 * Math.cos((2 * Math.PI * i) / 24));
}
await call('import_data', {
	columns: [
		{ name: 'time_h', values: t },
		{ name: 'signal', values: y }
	]
});
const caps = JSON.parse(await call('list_capabilities'));
const fit = JSON.parse(await call('run_table_process', { name: 'Cosinor', args: { xIN: 0, yIN: [1], useFixedPeriod: true, fixedPeriod: 24 } }));
const tx = JSON.parse(await call('add_column_process', { columnId: 1, name: 'normalize', args: {} }));
const plot = JSON.parse(await call('add_plot', { type: 'scatterplot', inputs: { x: 0, y: 1 } }));

console.log('ANALYSES:', caps.analyses.length, 'TRANSFORMS:', caps.transforms.length, 'PLOTS:', caps.plots.length);
console.log('COSINOR valid:', fit.valid, '| normalize len:', tx.length, '| plot:', plot.type);

await client.close();
child.kill('SIGINT');

if (tools.length < 9) throw new Error('missing tools over HTTP');
if (!fit.valid) throw new Error('cosinor failed over HTTP');
if (tx.length !== 48) throw new Error('transform failed over HTTP');
if (plot.type !== 'scatterplot') throw new Error('plot failed over HTTP');
console.log('HTTP SMOKE OK ✅');
process.exit(0);
