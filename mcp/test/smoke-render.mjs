// End-to-end smoke test for render_plot: drive the MCP server over stdio, build a
// session, and rasterise a plot to PNG/SVG via the real headless-browser pipeline.
// Run from mcp/:  node test/smoke-render.mjs
import { statSync, readFileSync } from 'node:fs';
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

// Overlays (plan 2026-09-13 B6): a wired vertical line, a typed horizontal line
// and a ribbon band on the same plot, rendered through the same pipeline. The
// SVG must carry one `overlay-rule` <line> per resolved position and the ribbon
// <path>, or the tool advertises something the picture does not show.
await call('import_data', {
	columns: [
		{ name: 'crossing', values: [6, 30] },
		{ name: 'lower', values: y.map((v) => v - 2) },
		{ name: 'upper', values: y.map((v) => v + 2) }
	]
});
const outOv = JSON.parse(
	await call('render_plot', {
		type: 'scatterplot',
		inputs: { x: 0, y: 1 },
		overlays: [
			{ kind: 'line', form: 'vertical', label: 'alert', channels: { at: ['crossing'] } },
			{ kind: 'line', form: 'horizontal', label: 'threshold', channels: { at: [12] } },
			{
				kind: 'band',
				form: 'ribbon',
				label: 'band',
				channels: { x: 'time_h', lower: 'lower', upper: 'upper' }
			}
		],
		path: '/tmp/ancir-render-smoke-overlays'
	})
);
console.log('RENDER (overlays):', JSON.stringify(outOv));

await client.close();

const svgOv = readFileSync(outOv.svg, 'utf8');
const rules = (svgOv.match(/class="[^"]*overlay-rule[^"]*"/g) ?? []).length;
if (rules !== 3)
	throw new Error(
		`expected 3 overlay-rule lines (2 wired crossings + 1 typed threshold), got ${rules}`
	);
if (!/<g class="[^"]*overlay-bands-layer[^"]*"[\s\S]*?<path/.test(svgOv))
	throw new Error('ribbon band path missing from the SVG');
for (const label of ['alert', 'threshold', 'band']) {
	if (!svgOv.includes(`>${label}<`))
		throw new Error(`legend entry "${label}" missing from the SVG`);
}
console.log(`OVERLAYS OK: ${rules} rule lines, ribbon path and 3 legend entries present`);

const png = statSync(out.png);
const svg = statSync(out.svg);
console.log(`PNG ${png.size} bytes, SVG ${svg.size} bytes`);
if (png.size < 2000) throw new Error('PNG too small — likely blank render');
if (svg.size < 500) throw new Error('SVG too small — likely empty');
if (svg.size !== out.svgBytes) throw new Error('svgBytes mismatch');
console.log('RENDER SMOKE OK ✅ (via AnCiR convertToImage export path)');
process.exit(0);
