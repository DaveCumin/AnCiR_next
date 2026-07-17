// Is this analysis a sensible thing to do TO THIS DATA?
//
// WHY THIS EXISTS
//
// The normalizer checks wiring: does the column exist, do the args typecheck. The intent
// contract checks that we built what was asked for. Neither asks the question a
// chronobiologist would ask first — whether the number that comes out will mean anything.
//
// Nothing else in the pipeline can. A Cosinor fitted to 1.5 cycles produces a confident
// amplitude and acrophase. A periodogram over data sampled every 13 h will report a period,
// and it will be an alias. Both sessions are perfectly wired, raise zero errors, and are
// wrong in a way that looks exactly like being right. That is the failure mode worth catching:
// the tool is most dangerous when it is confidently useless.
//
// WHAT IT CAN AND CANNOT SEE
//
// Only columns that hold data AT EMIT TIME: imported columns and baked generator outputs
// (SimulatedData, SequenceColumn). An analysis's outputs are empty by design — the GUI
// computes them on load — so a chain like Split → RhythmicityAnalysis reads an empty column
// here and is skipped rather than guessed at. Fit diagnostics (R², residuals, convergence)
// need results and so are out of reach from a Worker; they belong to the app, if anywhere.
//
// Never an error, never a blocker, and it never triggers a repair round. Every check here is a
// judgement call on a spectrum ("2 cycles" is a convention, not a law), and the user may have
// excellent reasons we can't see. Being wrong must cost them a sentence, not their session.
//
// Pure and dependency-free, like the normalizer: it runs in the Worker.

const MS_PER_HOUR = 3600000;

/**
 * A column's values as HOURS.
 *
 * The units bridge, and the easiest thing here to get quietly wrong. Every `period` param in
 * the registry is in HOURS, but a `time` column is not a number of hours: SimulatedData bakes
 * ISO strings (`new Date(...).toISOString()`), and an imported one may hold epoch numbers.
 * Compare an ISO string to a period of 24 and you get NaN; compare epoch-ms and you get a
 * recording apparently 480,000 cycles long. Both would make every check below a liar.
 */
function toHours(values, column) {
	if (column?.type !== 'time') return values.map(Number);
	return values.map((v) => (typeof v === 'number' ? v : Date.parse(v)) / MS_PER_HOUR);
}

const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Shape of a time column: span, sampling step, regularity. Null when there's nothing to say. */
function timeStats(hours) {
	const xs = hours.filter(Number.isFinite);
	if (xs.length < 2) return null;
	const diffs = [];
	for (let i = 1; i < xs.length; i++) diffs.push(xs[i] - xs[i - 1]);
	const step = median(diffs.filter((d) => d > 0));
	const positive = diffs.filter((d) => d > 0);
	return {
		n: xs.length,
		span: Math.max(...xs) - Math.min(...xs),
		step,
		backwards: diffs.some((d) => d < 0),
		duplicates: diffs.some((d) => d === 0),
		// Regularity as a RELATIVE spread: an FFT needs even sampling, Lomb-Scargle doesn't.
		// Relative, because 5 minutes of jitter is nothing in daily data and everything in
		// per-minute data. The 5% threshold is a convention, and only ever raises a warning.
		irregular: positive.length > 1 && step > 0 && (Math.max(...positive) - Math.min(...positive)) / step > 0.05
	};
}

/**
 * The period each node is FITTING OR SEARCHING FOR, in hours — or null when it doesn't declare
 * one (a free search) and there is nothing to measure the recording against.
 *
 * Hand-written, because this is semantics the registry doesn't carry: `params` knows that
 * Cosinor has a `fixedPeriod`, not that `fixedPeriod` is only meaningful when `useFixedPeriod`
 * is set, nor that RhythmicityAnalysis' `periodMax` bounds a SEARCH rather than fixing a fit.
 *
 * Hand-written is a drift risk — the exact risk that produced the catalogue lies. So a test
 * asserts every node in the generated schema with a period-ish param appears HERE or in
 * EXCLUDED with a reason. Add a node with a period and that test fails until you say which.
 */
const PERIOD_OF = {
	// Fits: the period is only fixed if the node was told to fix it. Free-running searches
	// declare no target, so there's nothing to check the recording length against.
	Cosinor: (a) => (a.useFixedPeriod ? a.fixedPeriod : null),
	FitFunction: (a) => (a.periodic && a.useFixedPeriod ? a.fixedPeriod : null),
	DoubleLogistic: (a) => (a.fixPeriod ? a.fixedPeriod : null),
	RectangularWave: (a) => (a.fixOmega ? a.fixedPeriod : null),
	// Searches: the LONGEST period searched is the demanding one — resolving it is what needs
	// the cycles. A 28 h search over 30 h of data cannot find what it's looking for.
	RhythmicityAnalysis: (a) => a.periodMax,
	// Nodes that fold data onto a known period.
	NonparametricRA: (a) => a.period,
	CircadianFunctionIndex: (a) => a.period,
	RayleighTest: (a) => a.period,
	AverageProfile: (a) => a.period
};

/** Nodes with a period-ish param that is NOT a fit target. Each needs a reason, not a shrug. */
const EXCLUDED = {
	SimulatedData: 'samplingPeriod_hours describes the data it MAKES; there is no input to judge',
	MovingAnalysis:
		'fits within a sliding windowSize, so the recording span is the wrong yardstick — the window is. Judging it needs the window rule, which is a bigger job than this'
};

/** The column a node reads as its time axis. Most say xIN; RayleighTest says timeIN. */
const timeRef = (args) => (args?.xIN != null && args.xIN !== -1 ? args.xIN : args?.timeIN);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const round = (v, dp = 1) => Number(v.toFixed(dp));

/**
 * Judge every analysis in a normalised session against the data it will actually read.
 *
 * @param {object} session a normalised session (needs data, rawData, tableProcesses)
 * @returns {Array<{node:string, severity:'high'|'medium', message:string}>} ordered high-first
 */
export function checkFitness(session) {
	const out = [];
	const colById = new Map((session.data ?? []).map((c) => [c.id, c]));
	const valuesOf = (id) => (id == null ? null : session.rawData?.[id]);

	for (const tp of session.tableProcesses ?? []) {
		const { name, args } = tp;
		if (EXCLUDED[name] || !PERIOD_OF[name]) continue;

		const xId = timeRef(args);
		const xRaw = valuesOf(xId);
		// Empty ⇒ it's another analysis's output, which the GUI fills in on load. We can't see
		// it from here, and a guess would be worse than silence.
		if (!Array.isArray(xRaw) || xRaw.length === 0) continue;

		const say = (severity, message) => out.push({ node: name, severity, message });
		const stats = timeStats(toHours(xRaw, colById.get(xId)));
		if (!stats) continue;

		// --- the time axis itself ---
		if (stats.backwards)
			say('high', `${name} reads a time column that goes backwards. Sort the data by time first; every period estimate below depends on the order.`);
		if (stats.duplicates)
			say('medium', `${name} reads a time column with repeated timestamps. Duplicate times are usually a merge or import artefact, and they bias a fit toward whatever was double-counted.`);

		// --- lengths ---
		for (const yId of Array.isArray(args.yIN) ? args.yIN : []) {
			const y = valuesOf(yId);
			if (!Array.isArray(y) || y.length === 0) continue;
			if (y.length !== xRaw.length)
				say('high', `${name}: "${colById.get(yId)?.name ?? yId}" has ${y.length} values but its time column has ${xRaw.length}. They are paired by position, so the extra values are read against the wrong times.`);
			const missing = y.filter((v) => v == null || (typeof v === 'number' && !Number.isFinite(v))).length;
			if (y.length && missing / y.length > 0.5)
				say('medium', `${name}: "${colById.get(yId)?.name ?? yId}" is ${Math.round((missing / y.length) * 100)}% blank. The fit uses only what's left.`);
		}

		const period = num(PERIOD_OF[name](args));
		if (!period || period <= 0) continue;

		// --- enough cycles to fit? ---
		// Amplitude and phase are only identifiable across repeats. Under ~2 cycles a fit
		// returns numbers, and they describe the noise as much as the rhythm.
		const cycles = stats.span / period;
		if (cycles < 2)
			say('high', `${name} is fitting a ${round(period)} h period to ${round(stats.span)} h of data — only ${round(cycles)} cycles. A period fit needs at least 2 cycles, and 3+ to be worth reporting: below that the amplitude and phase are not identifiable, though it will still return a confident-looking number. Use a longer recording, or fit a shorter period.`);
		else if (cycles < 3)
			say('medium', `${name} is fitting a ${round(period)} h period to ${round(cycles)} cycles of data. Usable, but amplitude and phase will be poorly constrained — 3+ cycles is the usual minimum for reporting.`);

		// --- can the sampling even see it? ---
		// Nyquist is the hard one: below 2 samples per cycle the rhythm is not attenuated, it
		// is ALIASED — reported as a period that isn't there.
		if (stats.step > 0) {
			const perCycle = period / stats.step;
			if (perCycle < 2)
				say('high', `${name} is looking for a ${round(period)} h period in data sampled every ${round(stats.step)} h — under 2 samples per cycle. Nyquist: this cannot resolve that rhythm, and will report an alias (a period that isn't there) rather than nothing. Sample at least every ${round(period / 2)} h.`);
			else if (perCycle < 4)
				say('medium', `${name} has only ${round(perCycle)} samples per ${round(period)} h cycle. Above Nyquist, so the period is recoverable, but amplitude and phase get rough below ~4.`);
		}

		// --- method vs sampling ---
		// The check that earns its keep: an FFT ASSUMES even spacing and has no way to notice
		// it didn't get it. Lomb-Scargle exists precisely for this and is one param away.
		if (stats.irregular) {
			if (args.analysis === 'fft')
				say('high', `${name} runs an FFT on unevenly sampled data (steps vary around ${round(stats.step)} h). An FFT assumes even spacing and cannot tell that it didn't get it; the spectrum will be wrong. Use analysis:"periodogram" with pgMethod:"Lomb-Scargle", which is built for uneven sampling.`);
			else if (args.analysis === 'periodogram' && args.pgMethod && args.pgMethod !== 'Lomb-Scargle')
				say('medium', `${name} uses pgMethod:"${args.pgMethod}" on unevenly sampled data (steps vary around ${round(stats.step)} h). "Lomb-Scargle" handles uneven sampling properly.`);
		}
	}

	const rank = { high: 0, medium: 1 };
	return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export const _internals = { PERIOD_OF, EXCLUDED, timeStats, toHours };
