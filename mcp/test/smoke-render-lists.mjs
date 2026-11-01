// End-to-end check for plot inputs that take a LIST of columns (engine/plotInputs.js), over the
// real stdio server and headless Chromium. Run from mcp/:  npm run smoke:render:lists
//
// A correlation heatmap or pairs plot needs two or more columns on its one input. Before, the
// tools took one column per input, so both drew "Wire two or more columns" over MCP. Here each
// gets three columns by name and must draw its matrix; a single-column call still renders; and
// an unknown column in a list is refused by name.
import { readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const LONG = { timeout: 300000 }; // a cold start loads the whole registry
const EMPTY = /Wire two or more columns/;

const client = new Client({ name: 'smoke-render-lists', version: '0.0.1' });
await client.connect(
	new StdioClientTransport({
		command: 'npx',
		args: ['vite-node', 'src/server.js'],
		cwd: process.cwd(),
		stderr: 'inherit'
	}),
	LONG
);
const raw = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, LONG);
const call = async (name, args = {}) => {
	const r = await raw(name, args);
	const text = r.content?.[0]?.text;
	if (r.isError) throw new Error(`${name}: ${text}`);
	return JSON.parse(text);
};

await call('create_session', { id: 'render-lists' });
const T = Array.from({ length: 96 }, (_, i) => i);
await call('import_data', {
	columns: [
		{ name: 't', values: T },
		{ name: 'a', values: T.map((i) => 10 + 5 * Math.cos((2 * Math.PI * i) / 24)) },
		{ name: 'b', values: T.map((i) => 3 + 2 * Math.sin((2 * Math.PI * i) / 24) + (i % 5) * 0.1) },
		{ name: 'c', values: T.map((i) => i * 0.5 + (i % 3)) }
	]
});

const failures = [];
const check = async (label, fn) => {
	try {
		await fn();
		console.log(`ok   ${label}`);
	} catch (e) {
		failures.push(label);
		console.log(`FAIL ${label}: ${String(e.message).slice(0, 300)}`);
	}
};
const render = async (type, inputs) => {
	const r = await call('render_plot', {
		type,
		inputs,
		path: join(tmpdir(), `ancir-lists-${type}`)
	});
	if (!(statSync(r.png).size > 1000)) throw new Error('PNG is empty');
	return readFileSync(r.svg, 'utf8');
};
const count = (svg, tag) => (svg.match(new RegExp(`<${tag}\\b`, 'g')) ?? []).length;

await check('render_plot correlationheatmap of 3 columns draws a 3 x 3 matrix', async () => {
	const svg = await render('correlationheatmap', { column: ['a', 'b', 'c'] });
	if (EMPTY.test(svg)) throw new Error('drew "Wire two or more columns"');
	if (count(svg, 'rect') < 9) throw new Error(`only ${count(svg, 'rect')} <rect>, want 9 cells`);
	for (const n of ['a', 'b', 'c'])
		if (!svg.includes(`>${n}</text>`)) throw new Error(`no ${n} label`);
});

await check('render_plot pairsplot of 3 columns draws its panels', async () => {
	const svg = await render('pairsplot', { column: ['a', 'b', 'c'] });
	if (EMPTY.test(svg)) throw new Error('drew "Wire two or more columns"');
	if (count(svg, 'circle') < 96) throw new Error(`only ${count(svg, 'circle')} points`);
});

await check('render_plot with one column still renders (histogram, scatterplot)', async () => {
	const h = await render('histogram', { column: 'a' });
	if (count(h, 'rect') < 2) throw new Error('histogram has no bars');
	await render('scatterplot', { x: 't', y: 'a' });
});

await check('render_plot scatterplot with a y list draws both series', async () => {
	// A scatterplot draws each series' points as ONE path of circle arcs, and legends each.
	const svg = await render('scatterplot', { x: 't', y: ['a', 'b'] });
	const seriesPaths = (svg.match(/<path stroke="none" d="M[^"]*a4 4/g) ?? []).length;
	if (seriesPaths !== 2) throw new Error(`${seriesPaths} point series, want 2`);
	for (const n of ['a', 'b'])
		if (!new RegExp(`>${n}\\s*</text>`).test(svg)) throw new Error(`no legend ${n}`);
});

await check('add_plot correlationheatmap of 3 columns saves 3 variables', async () => {
	const r = await call('add_plot', {
		type: 'correlationheatmap',
		inputs: { column: ['a', 'b', 'c'] }
	});
	const exp = await call('export_session', { inline: true });
	const session = exp.session ?? exp;
	const plot = (session.plots ?? []).find((p) => p.id === r.plotId);
	if (plot?.plot?.data?.length !== 3) {
		throw new Error(`saved ${plot?.plot?.data?.length} variables (keys: ${Object.keys(exp)})`);
	}
});

await check('an unknown column in a list is refused by name', async () => {
	const r = await raw('add_plot', { type: 'pairsplot', inputs: { column: ['a', 'zzz'] } });
	const text = r.content?.[0]?.text ?? '';
	if (!r.isError || !/No column named "zzz"/.test(text)) throw new Error(`got: ${text}`);
});

await client.close();
if (failures.length) {
	console.error(`failed: ${failures.join('; ')}`);
	process.exit(1);
}
console.log('all list-input renders ok');
