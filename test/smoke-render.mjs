// End-to-end smoke test for render_plot: drive the MCP server over stdio, build a
// session, and rasterise a plot to PNG/SVG via the real headless-browser pipeline.
// Run from mcp/:  node test/smoke-render.mjs
import { statSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
	command: 'npx',
	args: ['vite-node', 'src/server.js'],
	cwd: process.cwd(),
	stderr: 'inherit'
});
const client = new Client({ name: 'smoke-render', version: '0.0.1' });
await client.connect(transport);

const call = async (name, args = {}) =>
	(await client.callTool({ name, arguments: args })).content?.[0]?.text;

await call('create_session', { id: 'render-smoke' });
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

const out = JSON.parse(
	await call('render_plot', {
		type: 'scatterplot',
		inputs: { x: 0, y: 1 },
		path: '/tmp/ancir-render-smoke'
	})
);
console.log('RENDER:', JSON.stringify(out));

await client.close();

const png = statSync(out.png);
const svg = statSync(out.svg);
console.log(`PNG ${png.size} bytes, SVG ${svg.size} bytes`);
if (png.size < 2000) throw new Error('PNG too small — likely blank render');
if (svg.size < 500) throw new Error('SVG too small — likely empty');
if (svg.size !== out.svgBytes) throw new Error('svgBytes mismatch');
console.log('RENDER SMOKE OK ✅ (via AnCiR convertToImage export path)');
process.exit(0);
