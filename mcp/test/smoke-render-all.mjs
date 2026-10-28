// Table-driven end-to-end check: EVERY plot type the registry lists renders through render_plot
// over the real stdio server and headless Chromium. Run from mcp/:  npm run smoke:render:all
//
// A chart must come back as PNG + the svg the GUI's export writes (it carries `id="plot<n>"`);
// a plot that draws HTML (the Table) as a PNG with `svg: null`. Before, the renderer waited for
// `#app svg` whatever the plot drew, so every tableplot timed out. The list of types is read from
// list_capabilities, so a new plot type is covered without editing this file.
import { readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HTML_PLOTS = new Set(['tableplot']); // plots that draw HTML, not an svg
const LONG = { timeout: 300000 }; // a cold start loads the whole registry

const client = new Client({ name: 'smoke-render-all', version: '0.0.1' });
await client.connect(
	new StdioClientTransport({
		command: 'npx',
		args: ['vite-node', 'src/server.js'],
		cwd: process.cwd(),
		stderr: 'inherit'
	}),
	LONG
);
const call = async (name, args = {}) => {
	const r = await client.callTool({ name, arguments: args }, undefined, LONG);
	const text = r.content?.[0]?.text;
	if (r.isError) throw new Error(`${name}: ${text}`);
	return JSON.parse(text);
};

await call('create_session', { id: 'render-all' });
const T = Array.from({ length: 96 }, (_, i) => i);
const Y = T.map((i) => 10 + 5 * Math.cos((2 * Math.PI * i) / 24) + (i % 7) * 0.1);
await call('import_data', {
	columns: [
		{ name: 't', values: T },
		{ name: 'y', values: Y },
		{ name: 'z', values: Y.map((v) => v * 2 + 1) }
	]
});

const caps = await call('list_capabilities');
const plots = caps.plots?.types ?? caps.plots;
const list = Array.isArray(plots)
	? plots
	: Object.entries(plots).map(([type, v]) => ({ type, ...v }));
if (list.length < 2) throw new Error(`list_capabilities listed ${list.length} plot types`);

const failures = [];
for (const p of list) {
	const type = p.type ?? p.id;
	const fields = p.inputs ?? [];
	// Inputs by NAME: one-input plots get the values; two-input plots get time/x then values/y.
	const inputs =
		type === 'tableplot'
			? ['y', 'z']
			: Object.fromEntries(fields.map((f, i) => [f, fields.length === 1 ? 'y' : ['t', 'y'][i]]));
	const out = join(tmpdir(), `ancir-render-all-${type}`);
	try {
		const r = await call('render_plot', { type, inputs, path: out });
		if (!(statSync(r.png).size > 1000)) throw new Error('PNG is empty');
		if (HTML_PLOTS.has(type)) {
			if (r.svg !== null) throw new Error(`expected svg null for an HTML plot, got ${r.svg}`);
		} else if (!/id="plot\d+"/.test(readFileSync(r.svg, 'utf8'))) {
			throw new Error('the svg is not the plot export (no id="plot<n>")');
		}
		console.log(`ok   ${type}`);
	} catch (e) {
		failures.push(type);
		console.log(`FAIL ${type}: ${String(e.message).slice(0, 300)}`);
	}
}
await client.close();
if (failures.length) {
	console.error(`render_plot failed for: ${failures.join(', ')}`);
	process.exit(1);
}
console.log(`render_plot: all ${list.length} plot types rendered.`);
