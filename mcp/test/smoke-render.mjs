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

// A periodogram as an overlay host (overlays plan 2026-10-15, step 2): a 24 h line and a
// 20 to 28 h band, through the same pipeline.
const outPg = JSON.parse(
	await call('render_plot', {
		type: 'periodogram',
		inputs: { time: 0, values: 1 },
		overlays: [
			{ kind: 'line', form: 'vertical', label: '24 h', channels: { at: 24 } },
			{ kind: 'band', form: 'vertical', channels: { start: 20, end: 28 } }
		],
		path: '/tmp/ancir-render-smoke-periodogram'
	})
);
console.log('RENDER (periodogram overlays):', JSON.stringify(outPg));

// A boxplot as an overlay host (step 3): its x axis is categorical, so a line with no form is
// HORIZONTAL (the host's only line form), and a band is a horizontal value range.
const groupId = JSON.parse(
	await call('import_data', { columns: [{ name: 'group', values: t.map((i) => i % 3) }] })
).added[0].id;
const outBox = JSON.parse(
	await call('render_plot', {
		type: 'boxplot',
		inputs: { x: groupId, y: 1 },
		overlays: [
			{ kind: 'line', label: 'threshold', channels: { at: 12 } },
			{ kind: 'band', channels: { lower: 8, upper: 9 } }
		],
		path: '/tmp/ancir-render-smoke-boxplot'
	})
);
console.log('RENDER (boxplot overlays):', JSON.stringify(outBox));

// An FFT as an overlay host (step 4). Overlay positions are stored as PERIODS in hours
// (decision Q3). A rendered FFT shows period on x (4 to 30 h), so the 24 h line sits at 24.
const outFft = JSON.parse(
	await call('render_plot', {
		type: 'fft',
		inputs: { time: 0, values: 1 },
		overlays: [
			{ kind: 'line', form: 'vertical', label: '24 h', channels: { at: 24 } },
			{ kind: 'band', form: 'vertical', channels: { start: 20, end: 28 } }
		],
		path: '/tmp/ancir-render-smoke-fft'
	})
);
console.log('RENDER (fft overlays):', JSON.stringify(outFft));

await client.close();

// The same FFT in FREQUENCY mode. render_plot has no settings argument, so this goes to the
// renderer directly with a payload `settings` (and overlay JSON, as the session would send):
// the 24 h line must be drawn at 1/24 cycles per hour and the 20 to 28 h band from 1/28 to
// 1/20, i.e. the stored periods are not re-entered when the axis changes.
const { renderPlot } = await import('../src/engine/renderPlot.js');
const typed = (values) => ({ columns: [], typed: values });
const outFreq = await renderPlot(
	{
		columns: [
			{ id: 0, name: 'time_h', type: 'number', values: t },
			{ id: 1, name: 'signal', type: 'number', values: y }
		],
		plot: {
			type: 'fft',
			inputs: { time: 0, values: 1 },
			// The limits too: the app's checkbox converts them, the field alone does not.
			settings: { showPeriod: false, xlimsIN: [0, 0.1] },
			overlays: [
				{ id: 1, kind: 'line', form: 'vertical', channels: { at: typed([24]) } },
				{
					id: 2,
					kind: 'band',
					form: 'vertical',
					channels: { start: typed([20]), end: typed([28]) }
				}
			]
		},
		width: 700,
		height: 420
	},
	{ outBase: '/tmp/ancir-render-smoke-fft-frequency' }
);
console.log('RENDER (fft frequency overlays):', JSON.stringify(outFreq));

// Pixel checks against the drawn x axis: the bottom axis group's translate plus each tick's.
const tagAttr = (tag, name) => Number(new RegExp(`\\s${name}="([^"]+)"`).exec(tag)?.[1]);
const fftAxisX = (svgText) => {
	// The bottom axis group (placed by a CSS translate), up to the next axis group.
	const start = svgText.search(/<g[^>]*class="axis-bottom/);
	const rest = svgText.slice(start + 1);
	const next = rest.search(/<g[^>]*class="axis-/);
	const group = '<' + (next >= 0 ? rest.slice(0, next) : rest);
	const left = Number(/translate\(([-\d.]+)px/.exec(group)?.[1]);
	const ticks = [
		...group.matchAll(
			/<g class="tick"[^>]*transform="translate\(([^,]+),[^)]*\)"[^>]*>[\s\S]*?<text[^>]*>([^<]+)<\/text>/g
		)
	]
		.map((m) => ({ x: left + Number(m[1]), v: Number(m[2]) }))
		.filter((k) => Number.isFinite(k.v) && Number.isFinite(k.x));
	if (ticks.length < 2) throw new Error('fft: could not read the x axis ticks');
	// Linear axis: map a value through two ticks.
	const [a, b] = [ticks[0], ticks.at(-1)];
	return (v) => a.x + ((v - a.v) / (b.v - a.v)) * (b.x - a.x);
};
const ruleX = (svgText) => {
	const rules = [...svgText.matchAll(/<line[^>]*class="[^"]*overlay-rule[^"]*"[^>]*>/g)].map(
		(m) => m[0]
	);
	if (rules.length !== 1) throw new Error(`fft: expected 1 overlay-rule, got ${rules.length}`);
	return tagAttr(rules[0], 'x1');
};
const bandXW = (svgText) => {
	const rect = /<rect[^>]*class="[^"]*band-rect[^"]*"[^>]*>/.exec(svgText)?.[0];
	if (!rect) throw new Error('fft: band-rect missing');
	return [tagAttr(rect, 'x'), tagAttr(rect, 'width')];
};
const near = (got, want, what) => {
	if (!(Math.abs(got - want) <= 1))
		throw new Error(`fft ${what}: expected ${want.toFixed(2)}, got ${got}`);
};
const svgFftPeriod = readFileSync(outFft.svg, 'utf8');
const toPxPeriod = fftAxisX(svgFftPeriod);
near(ruleX(svgFftPeriod), toPxPeriod(24), 'period-mode 24 h line');
const svgFftFreq = readFileSync(outFreq.svg, 'utf8');
const toPxFreq = fftAxisX(svgFftFreq);
near(ruleX(svgFftFreq), toPxFreq(1 / 24), 'frequency-mode 24 h line at 1/24');
const [bx, bw] = bandXW(svgFftFreq);
near(bx, toPxFreq(1 / 28), 'frequency-mode band start at 1/28');
near(bx + bw, toPxFreq(1 / 20), 'frequency-mode band end at 1/20');
console.log(
	'FFT OVERLAYS OK: 24 h line on the 24 tick (period) and at 1/24 (frequency); band 1/28 to 1/20'
);

const svgBox = readFileSync(outBox.svg, 'utf8');
const boxRules = [...svgBox.matchAll(/<line[^>]*class="[^"]*overlay-rule[^"]*"[^>]*>/g)].map(
	(m) => m[0]
);
const attr = (tag, name) => Number(new RegExp(`\\s${name}="([^"]+)"`).exec(tag)?.[1]);
if (boxRules.length !== 1 || attr(boxRules[0], 'y1') !== attr(boxRules[0], 'y2'))
	throw new Error(`boxplot: expected 1 horizontal overlay-rule, got ${boxRules.join(' ')}`);
if ((svgBox.match(/class="[^"]*band-rect[^"]*"/g) ?? []).length !== 1)
	throw new Error('boxplot: expected 1 band-rect');
if (!svgBox.includes('>threshold<')) throw new Error('boxplot: legend entry "threshold" missing');
console.log('BOXPLOT OVERLAYS OK: 1 horizontal rule, 1 band rect and the legend entry');

const svgPg = readFileSync(outPg.svg, 'utf8');
const pgRules = (svgPg.match(/class="[^"]*overlay-rule[^"]*"/g) ?? []).length;
const pgBands = (svgPg.match(/class="[^"]*band-rect[^"]*"/g) ?? []).length;
if (pgRules !== 1 || pgBands !== 1)
	throw new Error(
		`periodogram: expected 1 overlay-rule and 1 band-rect, got ${pgRules} and ${pgBands}`
	);
// The spectrum itself: a series path (fill="none") outside the overlay layers. Before v82.1
// the render signalled ready before the periodogram's debounced calculation had run.
if (!/<path[^>]*fill="none"/.test(svgPg.replace(/<g class="overlay-[\s\S]*?<\/g>/g, '')))
	throw new Error('periodogram: the spectrum line is missing (rendered before it was computed)');
console.log('PERIODOGRAM OVERLAYS OK: 1 rule line, 1 band rect and the spectrum');

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
