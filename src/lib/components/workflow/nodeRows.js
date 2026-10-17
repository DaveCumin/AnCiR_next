// The one source of truth for a node card's port-row geometry: detailed cards and compact
// squares (CompactNode) alike.
//
// WorkflowEditor anchors wires with nodeRowCentreY(); WorkflowNode, TableProcessNode and
// GroupNode draw their rows from the same numbers, through the CSS custom properties in
// NODE_ROW_CSS_VARS (set on each card's root element, read as var(--node-row-h) and so on).
// Change a value here and the rows, the dots and the wire ends move together.
//
// Pure module, no imports: the Playwright specs import it too.

/** Height of one port row. 24 px so the 24 x 24 pointer targets on a row (its expand
 *  chevron, its port dot) never reach into the next row (WCAG 2.2 SC 2.5.8). */
export const NODE_ROW_H = 24;
/** Header strip height, its 1 px bottom rule included (box-sizing: border-box). */
export const NODE_HEADER_H = 26;
/** The card's own border; rows start below it and the header. */
export const NODE_CARD_BORDER = 1;
/** Port dot diameter. */
export const PORT_DOT = 13;

/** Top of the first port row, from the card's outer (border-box) top. */
export const NODE_ROWS_TOP = NODE_CARD_BORDER + NODE_HEADER_H;

/** Centre y of row `slot`, from the card's outer top: where that row's dot and wires sit. */
export function nodeRowCentreY(slot) {
	return NODE_ROWS_TOP + slot * NODE_ROW_H + NODE_ROW_H / 2;
}

/** Height of the header plus `rows` port rows, from the card's outer top. */
export function nodePortAreaHeight(rows) {
	return NODE_ROWS_TOP + rows * NODE_ROW_H;
}

/** Inline style for a node card's root: exposes the geometry above to its CSS. */
export const NODE_ROW_CSS_VARS =
	`--node-row-h: ${NODE_ROW_H}px; --node-header-h: ${NODE_HEADER_H}px; ` +
	`--port-dot: ${PORT_DOT}px; --node-card-border: ${NODE_CARD_BORDER}px;`;

// --- Compact nodes (CompactNode.svelte): a small square with its ports stacked on its edges.

/** Compact square width (fixed). */
export const COMPACT_W = 56;
/** Vertical step between a compact node's ports: one full row, so each port's 24 x 24 target
 *  meets its neighbour's and never overlaps it (WCAG 2.2 SC 2.5.8), as on a detailed card. */
export const COMPACT_PORT_H = NODE_ROW_H;
/** Total vertical padding around the port stack: 2 ports x 24 + 8 = 56, so a node with up to
 *  two ports a side stays a square. */
export const COMPACT_V_PAD = COMPACT_W - 2 * COMPACT_PORT_H;

/** Compact body height: a square unless one side has more ports than fit in it. */
export function compactNodeHeight(nInputs = 0, nOutputs = 0) {
	const sideMax = Math.max(nInputs, nOutputs, 1);
	return Math.max(COMPACT_W, sideMax * COMPACT_PORT_H + COMPACT_V_PAD);
}

/** Centre y of port `slot` of `sideCount`, from the square's outer top: a centred stack. Where
 *  the dot sits and where its wires end. */
export function compactPortAnchorY(slot, sideCount, height) {
	const count = Math.max(1, sideCount);
	const topPad = (height - count * COMPACT_PORT_H) / 2;
	return topPad + slot * COMPACT_PORT_H + COMPACT_PORT_H / 2;
}
