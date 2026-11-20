import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The "all inputs must be the same type" rule is per process (core/processInputRules.js):
// Filter takes a time column and a number column in one node, each with its own output of its
// own type; Add still refuses the mix (its value is in the inputs' units). Wired as a user does
// it, by dragging a wire on the canvas, then one undo removes the wire and redo restores it.
// Runs against a dev server (E2E_BASE_URL): it reads the session through `window.__core`.
//
// Fixture: the shipped Filter demo (a free Filter on the number column y, condition
// `reference > 2`) plus a time column and a free Add node on y.

test.use({ viewport: { width: 1500, height: 1000 } });

const TIME_ID = 700;
const ADD_ID = 9;
const FILTER_NODE = 'process_4';
const ADD_NODE = `process_${ADD_ID}`;

function fixture({ multiplyOnTime = false } = {}) {
	const s = JSON.parse(
		readFileSync('static/sessions/demos/demo-process-filterbyothercol.json', 'utf8')
	);
	const n = s.rawData['618'].length;
	const start = Date.UTC(2024, 3, 6, 0, 0);
	s.rawData[String(TIME_ID)] = Array.from({ length: n }, (_, i) =>
		new Date(start + i * 3600000).toISOString().slice(0, 16).replace('T', ' ')
	);
	s.data.push({
		id: TIME_ID,
		name: 'time',
		data: TIME_ID,
		type: 'time',
		timeFormat: 'YYYY-MM-DD HH:mm',
		timeZone: 'Pacific/Auckland',
		processes: []
	});
	s.data.push({
		id: 701,
		name: 'Add result',
		data: null,
		type: 'number',
		producerNodeId: ADD_NODE,
		producerPort: 'out_618',
		producerArtifactKind: 'column',
		processes: []
	});
	s.orphanProcesses.push({ id: ADD_ID, name: 'Add', args: { value: 5, inIN: [618] } });
	s.nodeLayout[`data_${TIME_ID}`] = { x: 60, y: 560 };
	s.nodeLayout[ADD_NODE] = { x: 440, y: 560 };
	// A session saved before Multiply refused time columns: one already wired to the time
	// column, and one on the number column to drag the time column onto.
	if (multiplyOnTime) {
		s.orphanProcesses.push(
			{ id: MUL_TIME_ID, name: 'Multiply', args: { value: 2, inIN: [TIME_ID] } },
			{ id: MUL_NUM_ID, name: 'Multiply', args: { value: 2, inIN: [618] } }
		);
		s.data.push(
			{
				id: 702,
				name: 'Multiply time',
				data: null,
				type: 'time',
				producerNodeId: `process_${MUL_TIME_ID}`,
				producerPort: `out_${TIME_ID}`,
				producerArtifactKind: 'column',
				processes: []
			},
			{
				id: 703,
				name: 'Multiply y',
				data: null,
				type: 'number',
				producerNodeId: `process_${MUL_NUM_ID}`,
				producerPort: 'out_618',
				producerArtifactKind: 'column',
				processes: []
			}
		);
		s.nodeLayout[`process_${MUL_TIME_ID}`] = { x: 800, y: 560 };
		s.nodeLayout[`process_${MUL_NUM_ID}`] = { x: 800, y: 200 };
	}
	return JSON.stringify(s);
}

const MUL_TIME_ID = 10;
const MUL_NUM_ID = 11;

async function load(page, opts = {}) {
	await page.routeWebSocket(/.*/, () => {}); // no live reload mid-test
	await page.route('**/e2e-mixed-inputs.json', (route) =>
		route.fulfill({ contentType: 'application/json', body: fixture(opts) })
	);
	await page.goto(`/?loadFromURL=${encodeURIComponent('/e2e-mixed-inputs.json')}`);
	await page.waitForFunction(
		(id) =>
			window.__core &&
			window.__core.data.some((c) => c.id === id) &&
			!window.__appState.loadingState.isLoading,
		TIME_ID,
		{ timeout: 60_000 }
	);
	await page.waitForTimeout(800);
}

/** Drag a wire from one port dot to another, as a user does (pointer down, move, up). */
async function dragWire(page, from, to) {
	await to.scrollIntoViewIfNeeded();
	const b = await to.boundingBox();
	const a2 = await from.boundingBox();
	await page.mouse.move(a2.x + a2.width / 2, a2.y + a2.height / 2);
	await page.mouse.down();
	for (let k = 1; k <= 12; k++) {
		await page.mouse.move(
			a2.x + a2.width / 2 + ((b.x - a2.x) * k) / 12,
			a2.y + a2.height / 2 + ((b.y - a2.y) * k) / 12
		);
	}
	await page.mouse.up();
	await page.waitForTimeout(800);
}

const port = (page, nodeId, dir, name) =>
	page.locator(
		`.port-dot[data-node-id="${nodeId}"][data-port-dir="${dir}"]${name ? `[data-port-name="${name}"]` : ''}`
	);

/** The time column's output port, wherever the canvas draws it. */
async function timeOut(page) {
	const own = port(page, `data_${TIME_ID}`, 'out');
	if (await own.count()) return own.first();
	return page.locator(`.port-dot[data-port-dir="out"][data-port-name="col_${TIME_ID}"]`).first();
}

/** A free process node's inputs and its outputs' types and data. */
const nodeState = (page, procId) =>
	page.evaluate((id) => {
		const proc = window.__core.orphanProcesses.find((p) => p.id === id);
		const outs = window.__core.data
			.filter((c) => c.producerNodeId === `process_${id}`)
			.map((c) => ({ port: c.producerPort, type: c.type, data: c.getData() }));
		const input = (cid) => window.__core.data.find((c) => c.id === cid)?.getData();
		return { inIN: [...proc.args.inIN], outs, y: input(618), t: input(700), ref: input(619) };
	}, procId);

test('Filter takes a time and a number column; Add refuses the mix; undo and redo', async ({
	page
}) => {
	await load(page);
	const time = await timeOut(page);
	await expect(time).toBeVisible();

	// Add: wiring the time column next to the number column is refused, with the reason.
	await dragWire(page, time, port(page, ADD_NODE, 'in', 'input'));
	await expect(
		page.locator('.toast').getByText(/Add inputs must all be the same type \(already number\)/)
	).toBeVisible();
	expect((await nodeState(page, ADD_ID)).inIN).toEqual([618]);

	// Filter: the same drag is accepted, and the node shows a second output.
	const filterOutsBefore = await port(page, FILTER_NODE, 'out').count();
	await dragWire(page, await timeOut(page), port(page, FILTER_NODE, 'in', 'input'));
	const s = await nodeState(page, 4);
	expect(s.inIN).toEqual([618, TIME_ID]);
	expect(s.outs.map((o) => [o.port, o.type])).toEqual([
		['out_618', 'number'],
		[`out_${TIME_ID}`, 'time']
	]);
	await expect(port(page, FILTER_NODE, 'out')).toHaveCount(filterOutsBefore + 1);
	await expect(port(page, FILTER_NODE, 'out', `out_${TIME_ID}`)).toBeVisible();
	// Each output is its own input, filtered by `reference > 2`, in its own type.
	const keep = s.ref.map((r) => Number(r) > 2);
	expect(s.outs[0].data).toEqual(s.y.map((v, i) => (keep[i] ? v : null)));
	expect(s.outs[1].data).toEqual(s.t.map((v, i) => (keep[i] ? v : null)));
	expect(s.outs[1].data.filter((v) => v != null).every((v) => typeof v === 'number')).toBe(true);

	// One undo removes the wire and its output; redo puts both back.
	await page.locator('.workflow-editor').click({ position: { x: 5, y: 5 } });
	await page.keyboard.press('ControlOrMeta+z');
	await expect.poll(async () => (await nodeState(page, 4)).inIN).toEqual([618]);
	expect((await nodeState(page, 4)).outs.map((o) => o.port)).toEqual(['out_618']);
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect.poll(async () => (await nodeState(page, 4)).inIN).toEqual([618, TIME_ID]);
	expect((await nodeState(page, 4)).outs.map((o) => o.type)).toEqual(['number', 'time']);
});

test('Multiply refuses a time column; a saved one passes through with the refusal shown', async ({
	page
}) => {
	await load(page, { multiplyOnTime: true });

	// The saved wire loads: the node shows the standard refusal as its warning, and its output
	// is the time column unchanged (not its epoch milliseconds doubled).
	const node = page.locator(`.workflow-node-wrapper:has([data-node-id="process_${MUL_TIME_ID}"])`);
	const badge = node.locator('.node-warning-badge').first();
	await expect(badge).toBeVisible();
	await expect(badge).toHaveAttribute(
		'aria-label',
		"Warning: Multiply doesn't support time columns yet. Its time input passes through unchanged."
	);
	const s = await nodeState(page, MUL_TIME_ID);
	expect(s.outs).toHaveLength(1);
	expect(s.outs[0].data).toEqual(s.t);

	// A new wire from the time column is refused with the same words, and wires nothing.
	await dragWire(page, await timeOut(page), port(page, `process_${MUL_NUM_ID}`, 'in', 'input'));
	await expect(
		page.locator('.toast').getByText("Multiply doesn't support time columns yet.")
	).toBeVisible();
	expect((await nodeState(page, MUL_NUM_ID)).inIN).toEqual([618]);
});
