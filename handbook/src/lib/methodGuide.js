/**
 * The goal-first index that backs BOTH the "Start from your goal" table and the
 * interactive Method Picker, so the two can never disagree.
 *
 * Each row is a QUESTION a reader might arrive with, together with the two data
 * properties that most often disqualify the method that answers it:
 *
 *   sampling — the study design the question demands:
 *     'longitudinal'     one individual, measured repeatedly over time
 *     'cross-sectional'  many individuals, each sampled once or over a short window
 *     'both'             many individuals, each with a record over time
 *     'either'           the method does not care which
 *
 *   spacing  — 'any' if the method fits against actual timestamps, 'even' if it
 *     reads position-in-sequence and so assumes one fixed interval between samples.
 *
 *   ifUneven — when spacing is 'even', what to reach for instead on unevenly
 *     spaced or gappy data. null means the question cannot be answered from such
 *     data at all, and the picker says so rather than suggesting a substitute.
 *
 * The method-level version of the same two axes, for the methods covered by
 * Refinetti, Cornélissen & Halberg (2007), is Chapter 13's requirements table.
 */

export const SAMPLING_LABEL = {
	longitudinal: 'One individual, over time',
	'cross-sectional': 'Many individuals',
	both: 'Many individuals, each over time',
	either: 'Either'
};

/** Compact form for the table's badge column. */
export const SAMPLING_SHORT = {
	longitudinal: 'One, over time',
	'cross-sectional': 'Many individuals',
	both: 'Many, each over time',
	either: 'Either'
};

export const SPACING_SHORT = {
	any: 'Any',
	even: 'Even'
};

/** The three picker inputs. 'unsure' never filters anything out. */
export const SAMPLING_OPTIONS = [
	{ value: 'unsure', label: "I'm not sure yet" },
	{ value: 'longitudinal', label: 'One individual, measured over time' },
	{ value: 'cross-sectional', label: 'Many individuals, sampled once or twice each' },
	{ value: 'both', label: 'Many individuals, each measured over time' }
];

export const SPACING_OPTIONS = [
	{ value: 'unsure', label: "I'm not sure yet" },
	{ value: 'even', label: 'Evenly spaced, few or no gaps' },
	{ value: 'uneven', label: 'Unevenly spaced, or with real gaps' }
];

export const GOALS = [
	{
		id: 'rhythm-one',
		goal: 'Is there a rhythm?',
		context: 'one individual, over time',
		method:
			'Periodogram (χ² or Lomb–Scargle), read with its <em>peak power</em> next to the actogram',
		need: '≥ 3–4 days of record',
		whyLongitudinal:
			'A period is a within-individual property: it is the interval after which that oscillator returns to the same phase. One observation per subject carries no such interval, so there is nothing to measure.',
		sampling: 'longitudinal',
		spacing: 'even',
		ifUneven: 'the Lomb–Scargle periodogram, which fits against the actual timestamps',
		go: [
			['Ch 6', 'ch6'],
			['Recipe', 'recipes']
		]
	},
	{
		id: 'rhythm-many',
		goal: 'Is there a rhythm?',
		context: 'many individuals',
		method:
			'Fit a cosinor at the expected period and test whether the amplitude differs from zero (the fit’s F-test / p-value)',
		need: 'Samples spread across the cycle, clock times recorded',
		sampling: 'cross-sectional',
		spacing: 'any',
		ifUneven: null,
		go: [['Ch 7', 'ch7']]
	},
	{
		id: 'period',
		goal: 'What is the period, τ?',
		context: null,
		method:
			'χ² periodogram (dense, even) · Lomb–Scargle (sparse, uneven) · FFT for a quick spectral view',
		need: 'Ideally ≥ 7 cycles',
		whyLongitudinal:
			'A period is a within-individual property: it is the interval after which that oscillator returns to the same phase. One observation per subject carries no such interval, so there is nothing to measure.',
		sampling: 'longitudinal',
		spacing: 'even',
		ifUneven:
			'the Lomb–Scargle periodogram; the χ² periodogram and the FFT both assume even spacing',
		go: [
			['Ch 6', 'ch6'],
			['Ch 8', 'ch8']
		]
	},
	{
		id: 'cosinor-params',
		goal: 'Amplitude, phase and MESOR at a known τ?',
		context: null,
		method: 'Cosinor (fixed period); population-mean cosinor for a group',
		need: 'τ known',
		sampling: 'either',
		spacing: 'any',
		ifUneven: null,
		go: [
			['Ch 7', 'ch7'],
			['Recipe', 'recipes']
		]
	},
	{
		id: 'phase-groups',
		goal: 'Compare <strong>phase</strong> between groups?',
		context: null,
		method: 'Circular statistics (Rayleigh, Watson–Williams)',
		need: 'One acrophase per individual',
		sampling: 'cross-sectional',
		spacing: 'any',
		ifUneven: null,
		go: [
			['Ch 12', 'ch12'],
			['Recipe', 'recipes']
		]
	},
	{
		id: 'period-groups',
		goal: 'Compare <strong>period</strong> between groups?',
		context: null,
		method: 'Estimate τ per individual (periodogram), then t-test or regression on the periods',
		need: 'Several cycles per individual',
		sampling: 'both',
		spacing: 'even',
		ifUneven: 'a Lomb–Scargle periodogram per individual, then the same group test on the periods',
		go: [
			['Ch 6', 'ch6'],
			['Ch 12', 'ch12']
		]
	},
	{
		id: 'amplitude-groups',
		goal: 'Compare <strong>amplitude</strong> or mean level between groups?',
		context: null,
		method: 'Cosinor per individual, then t-test on the parameters',
		need: 'τ known or estimated',
		sampling: 'both',
		spacing: 'any',
		ifUneven: null,
		go: [
			['Ch 7', 'ch7'],
			['Recipe', 'recipes']
		]
	},
	{
		id: 'npcra',
		goal: 'How strong or fragmented is the rhythm?',
		context: null,
		method:
			'NPCRA: interdaily stability (IS), intradaily variability (IV), relative amplitude (RA), M10 / L5',
		need: 'Continuous actigraphy, ≥ 7 days',
		whyLongitudinal:
			'IS, IV, RA and M10/L5 all describe how activity is distributed within and between days, so they need a continuous multi-day record from one individual.',
		sampling: 'longitudinal',
		spacing: 'even',
		ifUneven:
			null /* IS and IV are defined on equal-length epochs; gappy data must be re-binned or interpolated first */,
		go: [
			['Ch 9', 'ch9'],
			['Recipe', 'recipes']
		]
	},
	{
		id: 'waveform',
		goal: 'Waveform clearly non-sinusoidal?',
		context: null,
		method:
			'A shape-matched fit rather than a plain cosine: harmonic cosinor, <strong>rectangular-wave</strong> (crisp on/off rhythms) or <strong>double-logistic</strong> (gradual, asymmetric on/off transitions), all via <strong>FitFunction</strong>; or NPCRA / an average-day profile for a shape-free summary',
		need: 'Continuous record',
		whyLongitudinal:
			'The shape of a cycle can only be seen in a record that traces the cycle out, which means repeated sampling of the same individual.',
		sampling: 'longitudinal',
		spacing: 'any',
		ifUneven: null,
		go: [
			['Ch 7', 'ch7'],
			['Ch 9', 'ch9']
		]
	},
	{
		id: 'prc',
		goal: 'Size and direction of a phase shift (PRC)?',
		context: null,
		method: 'Detect activity onsets, then measure the phase difference against the stimulus time',
		need: 'Free-run before and after the stimulus',
		whyLongitudinal:
			"A phase shift is measured as the difference between one individual's rhythm before and after the stimulus, so it needs a free-running record on both sides of it.",
		sampling: 'longitudinal',
		spacing: 'even',
		ifUneven: null /* onset detection reads a regularly binned series */,
		go: [['Ch 10', 'ch10']]
	},
	{
		id: 'events',
		goal: 'Only times of events (no magnitude)?',
		context: null,
		method: 'Rayleigh test on the event phases',
		need: 'Event or onset times',
		sampling: 'either',
		spacing: 'any',
		ifUneven: null,
		go: [['Ch 12', 'ch12']]
	},
	{
		id: 'cross-corr',
		goal: 'How do two rhythms line up in time?',
		context: null,
		method: 'Cross-correlation',
		need: 'Two aligned series',
		whyLongitudinal:
			'Cross-correlation slides one series against the other, so it needs two series measured over time in the same individual.',
		sampling: 'longitudinal',
		spacing: 'even',
		ifUneven: null /* the lag axis is counted in samples, so it needs one fixed interval */,
		go: [['Ch 9', 'ch9']]
	}
];

/**
 * Verdict for one goal under the reader's answers. 'unsure' matches everything,
 * so an untouched picker shows the full index rather than an empty result.
 *
 * Returns { state, reason } where state is:
 *   'ok'        the question is answerable as listed
 *   'swap'      answerable, but reach for something else on this data (reason says what)
 *   'blocked'   this design cannot answer the question at all (reason says why)
 */
/**
 * Does the reader's design satisfy what the question demands? Note that 'both'
 * (many individuals, each with a record over time) is a SUPERSET: it contains a
 * longitudinal record and it contains many individuals, so it satisfies every
 * requirement. Treating it as just another distinct value would wrongly rule out
 * the cross-sectional and longitudinal questions for the richest design of all.
 */
function samplingSatisfied(need, have) {
	if (have === 'unsure' || need === 'either') return true;
	if (have === 'both') return true;
	return need === have;
}

export function verdictFor(goal, sampling, spacing) {
	if (!samplingSatisfied(goal.sampling, sampling)) {
		return { state: 'blocked', reason: samplingReason(goal, sampling) };
	}
	if (spacing === 'uneven' && goal.spacing === 'even') {
		return goal.ifUneven
			? { state: 'swap', reason: `On unevenly spaced data, use ${goal.ifUneven}.` }
			: {
					state: 'blocked',
					reason:
						'This method reads position in the sequence rather than clock time, so it needs one fixed interval between samples. Re-bin or interpolate onto an even grid first, and report that you did.'
				};
	}
	return { state: 'ok', reason: null };
}

function samplingReason(goal, sampling) {
	const needs = SAMPLING_LABEL[goal.sampling].toLowerCase();
	if (goal.sampling === 'longitudinal' && sampling === 'cross-sectional') {
		// Why a time course is required differs by question, and a generic "period is
		// within-individual" line would be simply wrong for the shape and coupling ones.
		return (
			goal.whyLongitudinal ??
			'This question is answered from a time course within one individual. A single observation per subject carries no time course to analyse.'
		);
	}
	if (goal.sampling === 'cross-sectional' && sampling === 'longitudinal') {
		return 'This question compares a group, so it needs many individuals. One individual is a sample of one.';
	}
	if (goal.sampling === 'both') {
		return 'This one needs both at once: many individuals, and a record over time from each, because the per-individual estimate is computed first and the groups are compared afterwards.';
	}
	return `This question needs ${needs}.`;
}
