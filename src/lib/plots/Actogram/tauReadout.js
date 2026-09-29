// The τ a readout shows, beside the line's slope (pure; no Svelte state, no imports beyond
// the port definitions, so PhaseMarker.svelte and MarkerRuleBlock.svelte can both use it
// without the markerRules <-> PhaseMarker import cycle).
import { ruleOutputValues } from '../plotMetricDefs.js';

// How the harmonic check's pick relates to the line's slope, in words.
const PICK_WORDS = { 'τ/2': 'half the slope', '2τ': 'twice the slope' };

/**
 * The two periods a block carries, side by side, for any readout that shows τ:
 *   tau    what the rule's τ OUTPUT PORT reports (Decision 2b): the harmonic check's pick,
 *          read through `ruleOutputValues` so the readout cannot drift from the port;
 *   slope  the fitted slope of the line as drawn (NaN when there is no line);
 *   pick   the winning candidate's label ('τ', 'τ/2', '2τ'), or null when no check ran;
 *   disagree  true when the check picked τ/2 or 2τ, i.e. tau and slope differ;
 *   note   a one-line explanation for a tooltip when they disagree, else ''.
 *
 * Reads the block's cached `harmonicCheck` $derived, the same one the port reads, so on a
 * plot whose metric effect has run it costs nothing; on its own it runs the check once
 * per slope value (see markerRules.harmonic.svelte.test.js).
 */
export function tauReadout(block) {
	const tau = ruleOutputValues(block).tau;
	const s = block?.fittedSlope;
	const slope = Number.isFinite(s) ? s : NaN;
	const pick = Number.isFinite(tau) ? (block.harmonicCheck?.strongest?.label ?? null) : null;
	const disagree = pick != null && pick !== 'τ' && Number.isFinite(slope);
	let note = '';
	if (disagree) {
		const t = tau.toFixed(2);
		// Only a rule's blocks (an instance, or a series' detached copy) feed an output port.
		const reports =
			block.isInstance || block.fromRule
				? `The rule's τ output reports the harmonic check, ${t} h.`
				: `τ here is the harmonic check's value, ${t} h.`;
		note =
			`The line's slope (${slope.toFixed(2)} h) and the harmonic check (${t} h, ` +
			`${PICK_WORDS[pick] ?? pick}) disagree: the data have more periodogram power at ` +
			`${t} h. ${reports}`;
	}
	return { tau, slope, pick, disagree, note };
}
