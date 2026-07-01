// End-to-end smoke test: spawn the AnCiR MCP server over stdio and drive it
// through the real MCP client protocol. Run from the mcp/ dir:  node test/smoke-client.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
	command: 'npx',
	args: ['vite-node', 'src/server.js'],
	cwd: process.cwd(),
	stderr: 'inherit'
});

const client = new Client({ name: 'smoke', version: '0.0.1' });
await client.connect(transport);

const tools = (await client.listTools()).tools.map((t) => t.name);
console.log('TOOLS:', tools.join(', '));

const call = async (name, args = {}) => {
	const res = await client.callTool({ name, arguments: args });
	return res.content?.[0]?.text;
};

await call('create_session', { id: 'smoke' });

// 72h of a clean 24h cosine: MESOR 10, amplitude 5.
const t = [];
const y = [];
for (let i = 0; i < 72; i++) {
	t.push(i);
	y.push(10 + 5 * Math.cos((2 * Math.PI * i) / 24));
}
const imported = JSON.parse(
	await call('import_data', {
		columns: [
			{ name: 'time_h', type: 'number', values: t },
			{ name: 'signal', type: 'number', values: y }
		]
	})
);
console.log('IMPORTED:', JSON.stringify(imported.added));

const fit = JSON.parse(await call('run_cosinor', { x: 0, y: 1, fixedPeriod: 24, nHarmonics: 1 }));
console.log('COSINOR:', JSON.stringify(fit.results[0]));

// Capabilities are now derived live from the engine registry.
const caps = JSON.parse(await call('list_capabilities'));
console.log('ANALYSES:', caps.analyses.length, '— e.g.', caps.analyses.slice(0, 4).map((a) => a.id).join(', '));

// Generic registry-driven analysis: run a TrendFit through the same path the GUI uses.
const trend = JSON.parse(await call('run_table_process', { name: 'TrendFit', args: { xIN: 0, yIN: [1], model: 'linear' } }));
console.log('TRENDFIT:', JSON.stringify({ valid: trend.valid, outputs: trend.outputs.map((o) => o.key) }));

const exported = JSON.parse(await call('export_session', { path: '/tmp/ancir-smoke-session.json' }));
console.log('EXPORTED:', JSON.stringify(exported));

await client.close();

// Basic assertions
const r = fit.results[0];
if (!(r.rSquared > 0.99)) throw new Error('cosinor R² too low: ' + r.rSquared);
if (Math.abs(r.mesor - 10) > 0.5) throw new Error('MESOR off: ' + r.mesor);
if (Math.abs(r.harmonics[0].amplitude - 5) > 0.5) throw new Error('amplitude off');
if (!(caps.analyses.length > 10)) throw new Error('too few analyses surfaced: ' + caps.analyses.length);
if (!trend.valid || trend.outputs.length === 0) throw new Error('TrendFit produced no valid output');
console.log('SMOKE OK ✅');
