// @ts-nocheck
// Shared residual-diagnostic support for the curve-fit nodes (FitFunction, TrendFit, Cosinor,
// RectangularWave, DoubleLogistic) and the SmoothedData node.
//
// A residual is observed − fitted, aligned to the FULL input length so it pairs 1:1 with the input
// x column (NaN wherever the input pair was invalid). The fit nodes evaluate their model at EVERY
// input x — rather than reusing the fit's `fitted`, which covers only the valid points — so the
// residual column stays the same length as the input and the residual quick-plot lines up.
import { isInvalidValue } from '$lib/utils/stats.js';
import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';
import { mutationService } from '$lib/core/mutationService.js';
import { core } from '$lib/core/core.svelte.js';

export const RESIDUAL_COLOUR = '#BE796B'; // terracotta — matches the fitted-output colour

/**
 * observed − predicted, aligned to the full input length; NaN wherever the observed value, the
 * input x, or the prediction is not finite.
 * @param {number[]} predicted  model prediction at each input x (full length)
 * @param {number[]} yFull      observed values (full length)
 * @param {number[]} [xFull]    input x (full length) — only used to null out invalid-x rows
 * @returns {number[]|null}
 */
export function residualColumn(predicted, yFull, xFull) {
	if (!Array.isArray(predicted) || !Array.isArray(yFull)) return null;
	return yFull.map((v, i) =>
		isInvalidValue(v) || (xFull ? isInvalidValue(xFull[i]) : false) || !Number.isFinite(predicted[i]) ? NaN : v - predicted[i]
	);
}

/**
 * Write a residual output column if its out-key is wired.
 * @param {number} outId       the resid_<yId> output column id (or -1/undefined to skip)
 * @param {number[]} predicted model prediction at each input x
 * @param {number[]} yFull     observed values
 * @param {number[]} xFull     input x
 * @param {string} processHash shared hash so the column is grouped with its siblings
 */
export function writeResidual(outId, predicted, yFull, xFull, processHash) {
	if (outId == null || outId === -1) return;
	const resid = residualColumn(predicted, yFull, xFull);
	if (resid) writeOutputColumn(outId, resid, { processHash });
}

/**
 * Spawn a wired residual scatter (input x vs residual) for one series. A good fit leaves residuals
 * scattered structurelessly around zero; a pattern (trend, fanning, curvature) flags a
 * mis-specified model. Wired to the real output columns, so it stays live.
 * @param {object} p         the reactive TableProcess prop (needs id)
 * @param {{xId:number, residId:number, label:string, colour?:string}} opts
 */
export function spawnResidualPlot(p, { xId, residId, label, colour = RESIDUAL_COLOUR }) {
	if (residId == null || residId < 0 || xId == null || xId < 0) return;
	const pos = core.nodeLayout?.[`tableprocess_${p.id}`] ?? { x: 200, y: 200 };
	mutationService.addPlot({
		name: `Residuals: ${label}`,
		type: 'scatterplot',
		sourceNodeId: `tableprocess_${p.id}`,
		x: (pos.x ?? 0) + 360,
		y: pos.y ?? 0,
		width: 420,
		height: 300,
		plot: {
			data: [
				{
					x: { refId: xId },
					y: { refId: residId },
					label: `${label} residuals`,
					line: { colour, draw: false },
					points: { colour, draw: true, radius: 3, shape: 'circle' }
				}
			]
		}
	});
}
