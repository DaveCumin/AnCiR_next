import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
	NODE_ROW_H,
	NODE_HEADER_H,
	NODE_CARD_BORDER,
	NODE_ROWS_TOP,
	PORT_DOT,
	NODE_ROW_CSS_VARS,
	nodeRowCentreY,
	nodePortAreaHeight
} from './nodeRows.js';

// The rendered side of this geometry (row heights, dots on row centres, wire ends on dot
// centres, for every node kind) is measured in tests/e2e/port-geometry.spec.js; the 24 x 24
// targets it leaves room for in tests/e2e/hit-targets.spec.js.

describe('nodeRows geometry', () => {
	it('rows are 24 px, so a 24 x 24 target on one never reaches the next (WCAG 2.2 SC 2.5.8)', () => {
		expect(NODE_ROW_H).toBe(24);
		// The port dot's hit area is one row tall; the dot must fit inside it.
		expect(PORT_DOT).toBeLessThan(NODE_ROW_H);
	});

	it('row centres step by one row from under the card border and header', () => {
		expect(NODE_ROWS_TOP).toBe(NODE_CARD_BORDER + NODE_HEADER_H);
		for (let slot = 0; slot < 12; slot++) {
			const top = NODE_ROWS_TOP + slot * NODE_ROW_H;
			expect(nodeRowCentreY(slot)).toBe(top + NODE_ROW_H / 2);
			// A row's centre is the midpoint of its own band in the port area.
			expect(nodeRowCentreY(slot)).toBe(
				(nodePortAreaHeight(slot) + nodePortAreaHeight(slot + 1)) / 2
			);
		}
	});

	it('exposes every value the node CSS reads as a custom property', () => {
		expect(NODE_ROW_CSS_VARS).toContain(`--node-row-h: ${NODE_ROW_H}px;`);
		expect(NODE_ROW_CSS_VARS).toContain(`--node-header-h: ${NODE_HEADER_H}px;`);
		expect(NODE_ROW_CSS_VARS).toContain(`--port-dot: ${PORT_DOT}px;`);
		expect(NODE_ROW_CSS_VARS).toContain(`--node-card-border: ${NODE_CARD_BORDER}px;`);
	});
});

// Drift guard: the node cards take the row geometry from nodeRows.js only. A local copy of
// the row or header height (a `const PORT_H = 22`, a `height: 22px` row) is how the wires
// and rows came apart before; this fails on the first one.
describe('node cards read the row geometry from nodeRows.js', () => {
	const dir = path.dirname(new URL(import.meta.url).pathname);
	const cards = ['WorkflowNode.svelte', 'TableProcessNode.svelte', 'GroupNode.svelte'];
	for (const file of cards) {
		const src = fs.readFileSync(path.join(dir, file), 'utf8');
		it(`${file} sets the CSS variables and keeps no local copy`, () => {
			expect(src).toMatch(/NODE_ROW_CSS_VARS/);
			expect(src).not.toMatch(/const\s+(PORT_H|HEADER_H)\s*=\s*\d/);
			const css = src.slice(src.indexOf('<style>'));
			// Row strips, input rows, series headers and port rows: all one row tall.
			for (const sel of ['.row-strip', '.in-row', '.port-row', '.series-header']) {
				const m = css.match(new RegExp(`\\n\\t${sel.replace('.', '\\.')} \\{([^}]*)\\}`));
				if (m) expect(m[1], `${file} ${sel}`).toMatch(/height: var\(--node-row-h\)/);
			}
			// Headers: the shared header height.
			const header = css.match(/\n\t\.(node-header|tp-header|group-header) \{([^}]*)\}/);
			expect(header?.[2], `${file} header`).toMatch(/height: var\(--node-header-h\)/);
		});
	}
	it('CompactNode sizes and places its dots from nodeRows.js', () => {
		const src = fs.readFileSync(path.join(dir, 'CompactNode.svelte'), 'utf8');
		expect(src).toMatch(/NODE_ROW_CSS_VARS/);
		expect(src).toMatch(/compactPortAnchorY\(/);
		// No hard-coded dot size or half-dot offset (the 13 px / 6.5 that put the dots 1 px low).
		expect(src).not.toMatch(/\b(13|15)px\b/);
		expect(src).not.toMatch(/6\.5/);
		const css = src.slice(src.indexOf('<style>'));
		const dot = css.match(/\n\t\.port-dot \{([^}]*)\}/);
		expect(dot?.[1]).toMatch(/width: var\(--port-dot\)/);
		expect(dot?.[1]).toMatch(/box-sizing: border-box/);
	});
	it('WorkflowEditor anchors wires with nodeRowCentreY', () => {
		const src = fs.readFileSync(path.join(dir, 'WorkflowEditor.svelte'), 'utf8');
		expect(src).toMatch(/nodeRowCentreY\(/);
		expect(src).not.toMatch(/const\s+PORT_H\s*=/);
	});
});
