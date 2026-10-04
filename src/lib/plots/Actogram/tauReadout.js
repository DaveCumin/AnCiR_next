// The τ a readout shows, beside the line's slope (pure; no Svelte state, no imports beyond
// the port definitions, so PhaseMarker.svelte and MarkerRuleBlock.svelte can both use it
// without the markerRules <-> PhaseMarker import cycle).
import { ruleOutputValues } from '../plotMetricDefs.js';

// How the harmonic check's pick relates to the line's slope, in words.
/** @type {Record<string, string>} */
const PICK_WORDS = { 'τ/2': 'half the slope', '2τ': 'twice the slope' };

/** @param {number|undefined} p */
const fmtP = (p) =>
	typeof p !== 'number' || !Number.isFinite(p)
		? 'n/a'
		: p < 0.001
			? '< 0.001'
			: `= ${p.toFixed(3)}`;

/**
 * The two periods a block carries, side by side, for any readout that shows τ:
 *   tau    what the rule's τ OUTPUT PORT reports (Decision 2b): the harmonic check's pick,
 *          read through `ruleOutputValues` so the readout cannot drift from the port;
 *   slope  the fitted slope of the line as drawn (NaN when there is no line);
 *   pick   the winning candidate's label ('τ', 'τ/2', '2τ'), or null when no check ran;
 *   disagree  true when the check picked τ/2 or 2τ, i.e. tau and slope differ;
 *   note   a tooltip line: why the check moved away from the slope (disagree), or why it
 *          kept the slope although another candidate had more periodogram power (the
 *          margin of harmonicCheck.js, review findings SPEC-5 / FIT-10); else ''.
 *
 * Reads the block's cached `harmonicCheck` $derived, the same one the port reads, so on a
 * plot whose metric effect has run it costs nothing; on its own it runs the check once
 * per slope value (see markerRules.harmonic.svelte.test.js).
 *
 * @param {any} block  a PhaseMarkerClass (an own block, a rule instance or a detached copy)
 */
export function tauReadout(block) {
	const tau = ruleOutputValues(block).tau;
	const s = block?.fittedSlope;
	const slope = Number.isFinite(s) ? s : NaN;
	const hc = block?.harmonicCheck;
	const pick = Number.isFinite(tau) ? (hc?.strongest?.label ?? null) : null;
	const disagree = pick != null && pick !== 'τ' && Number.isFinite(slope);
	let note = '';
	if (disagree) {
		const t = tau.toFixed(2);
		const test = hc?.strongest?.test;
		// Only a rule's blocks (an instance, or a series' detached copy) feed an output port.
		const reports =
			block.isInstance || block.fromRule
				? `The rule's τ output reports the harmonic check, ${t} h.`
				: `τ here is the harmonic check's value, ${t} h.`;
		const margin =
			pick === 'τ/2'
				? `and the two halves of each ${slope.toFixed(2)} h cycle do not differ significantly (p ${fmtP(test?.pValue)}), so the data are a ${t} h rhythm.`
				: `and alternate ${slope.toFixed(2)} h cycles differ significantly (p ${fmtP(test?.pValue)}), so the data repeat every ${t} h.`;
		note =
			`The line's slope (${slope.toFixed(2)} h) and the harmonic check (${t} h, ` +
			`${PICK_WORDS[pick] ?? pick}) disagree: the data have more periodogram power at ` +
			`${t} h, ${margin} ${reports}`;
	} else if (pick === 'τ' && hc?.powerStrongest && hc.powerStrongest.label !== 'τ') {
		// The margin kept the slope although another candidate had more power.
		const alt = hc.powerStrongest;
		const p = fmtP(alt.test?.pValue);
		const why =
			alt.label === 'τ/2'
				? `the two halves of each τ cycle differ significantly (p ${p}), as they do for two unequal daily bouts or one short bout, so the activity is not a ${alt.peakPeriod.toFixed(2)} h rhythm`
				: `alternate τ cycles do not differ significantly (p ${p}), so nothing repeats only every ${alt.peakPeriod.toFixed(2)} h`;
		note =
			`The periodogram has more power at ${alt.peakPeriod.toFixed(2)} h (${alt.label}) than at the line's slope, ` +
			`but the harmonic check keeps the slope: it switches only when the data support it, and here ${why}.`;
	}
	return { tau, slope, pick, disagree, note };
}
