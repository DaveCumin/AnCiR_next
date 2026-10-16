// The one source of truth for a node card's port-row geometry (detailed, not compact, nodes).
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
