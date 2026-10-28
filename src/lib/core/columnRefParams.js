// Node PARAMETERS that hold a column id without being an input port.
//
// A node's input ports are declared in its `columnIdFields` (xIN, yIN, ...), and every path that
// accepts a column NAME for them (the MCP normalizer and engine, the AI-edit planner) reads that
// declaration. A few params also name a column but are settings, not wires:
//
//   - `outputX` (Cosinor, Fit Function, Trend Fit, Rectangular Wave, Double Logistic): the column
//     whose values the fitted curve is evaluated at (-1 = the input x; utils/outputXSequence.js).
//   - `sortOnId` (Sort): which of the yIN columns is the sort key (-1 = the first input).
//
// Listed here once so every name-to-id path resolves them the same way as xIN / yIN. A guard test
// (mcp/src/emit/columnRefParams.test.js) fails when a node gains a column-like param that is in
// neither list.
export const COLUMN_REF_PARAMS = Object.freeze(['outputX', 'sortOnId']);

/** The column-reference params among `paramNames` (a node's param keys). */
export function columnRefParamsOf(paramNames) {
	const have = new Set(paramNames ?? []);
	return COLUMN_REF_PARAMS.filter((k) => have.has(k));
}
