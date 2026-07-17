// node --test src/emit/fitness.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFitness, _internals } from './fitness.js';
import { normalizeSession } from './normalizer.js';
import generated from './session-schema.generated.json' with { type: 'json' };

const { PERIOD_OF, EXCLUDED } = _internals;

/** A real session: SimulatedData (baked, ISO times) → one analysis. The honest fixture. */
const simulated = ({ hours = 96, step = 1, analysis }) =>
	normalizeSession({
		analyses: [
			{
				name: 'SimulatedData',
				args: {
					seed: 1,
					samplingPeriod_hours: step,
					sections: [{ duration_hours: hours, rhythmPeriod_hours: 24, rhythmAmplitude: 100, noiseEnabled: false }]
				}
			},
			analysis
		]
	}).session;

const messages = (s) => checkFitness(s).map((f) => f.message).join('\n');
const highs = (s) => checkFitness(s).filter((f) => f.severity === 'high');

test('DRIFT GUARD: every node with a period is judged, or excluded with a reason', () => {
	// The hand-written half of this module, and so the half that can lie. A new node with a
	// period param must be classified deliberately rather than silently skipped forever.
	const withPeriod = Object.entries(generated.nodes)
		.filter(([, d]) => Object.keys(d.params ?? {}).some((k) => /period/i.test(k)))
		.map(([name]) => name);

	assert.ok(withPeriod.length >= 10, 'sanity: the registry should have plenty of these');
	for (const name of withPeriod) {
		assert.ok(
			PERIOD_OF[name] || EXCLUDED[name],
			`${name} has a period param but fitness.js neither judges nor excludes it. Add it to PERIOD_OF, or to EXCLUDED with a reason.`
		);
	}
	// And nothing is excluded by a shrug.
	for (const reason of Object.values(EXCLUDED)) assert.ok(reason.length > 20, 'excluded needs a real reason');
});

test('UNITS: an ISO time column is read as hours, not parsed into nonsense', () => {
	// The trap this module is most likely to fall into. SimulatedData bakes ISO STRINGS, while
	// every period param is in hours. Read them naively and 96 h of data looks like NaN cycles
	// (silently no warnings) or, if epoch-ms, ~480,000 cycles — either way every check lies.
	const s = simulated({
		hours: 96,
		step: 1,
		analysis: { name: 'Cosinor', args: { xIN: 'time', yIN: ['values'], useFixedPeriod: true, fixedPeriod: 24 } }
	});
	const col = s.data.find((c) => c.name === 'time');
	assert.equal(col.type, 'time');
	assert.equal(typeof s.rawData[col.id][0], 'string', 'baked as ISO strings, not numbers');

	// 96 h / 24 h = 4 clean cycles at 1 h sampling ⇒ nothing to complain about.
	assert.deepEqual(checkFitness(s), [], `expected silence, got:\n${messages(s)}`);
});

test('no false positives on a well-designed session', () => {
	// The credibility test. A warning system that cries wolf gets ignored, and then the real
	// Nyquist violation scrolls past with it.
	for (const analysis of [
		{ name: 'Cosinor', args: { xIN: 'time', yIN: ['values'], useFixedPeriod: true, fixedPeriod: 24 } },
		{ name: 'AverageProfile', args: { xIN: 'time', yIN: ['values'], period: 24 } },
		{ name: 'NonparametricRA', args: { xIN: 'time', yIN: ['values'], period: 24 } },
		{ name: 'RhythmicityAnalysis', args: { xIN: 'time', yIN: ['values'], analysis: 'periodogram', periodMax: 28 } }
	]) {
		const s = simulated({ hours: 240, step: 0.5, analysis });
		assert.deepEqual(checkFitness(s), [], `${analysis.name} should be silent:\n${messages(s)}`);
	}
});

test('a period fit over too few cycles is called out, with the number', () => {
	// 36 h of data, fitting 24 h: 1.5 cycles. Wires perfectly, normalises clean, and returns a
	// confident amplitude that means nothing. Nothing else in the pipeline can see this.
	const s = simulated({
		hours: 36,
		step: 1,
		analysis: { name: 'Cosinor', args: { xIN: 'time', yIN: ['values'], useFixedPeriod: true, fixedPeriod: 24 } }
	});
	assert.deepEqual(s.errors ?? [], [], 'the session itself is perfectly valid');
	const [f] = highs(s);
	assert.equal(f.node, 'Cosinor');
	assert.match(f.message, /1\.5 cycles/);
	assert.match(f.message, /at least 2 cycles/);
	// Actionable: says what to do, not just that it's bad.
	assert.match(f.message, /longer recording|shorter period/);
});

test('2.5 cycles is a warning, not an alarm', () => {
	const s = simulated({
		hours: 60,
		step: 1,
		analysis: { name: 'Cosinor', args: { xIN: 'time', yIN: ['values'], useFixedPeriod: true, fixedPeriod: 24 } }
	});
	const f = checkFitness(s).find((x) => /cycles of data/.test(x.message));
	assert.equal(f.severity, 'medium');
});

test('sampling below Nyquist is called an ALIAS, not just imprecision', () => {
	// Every 13 h, looking for 24 h. The periodogram will report a period. It will be a lie, and
	// the distinction from "a bit noisy" is the whole point of the message.
	const s = simulated({
		hours: 480,
		step: 13,
		analysis: { name: 'RhythmicityAnalysis', args: { xIN: 'time', yIN: ['values'], analysis: 'periodogram', periodMax: 24 } }
	});
	const f = highs(s).find((x) => /Nyquist/.test(x.message));
	assert.ok(f, `expected a Nyquist warning, got:\n${messages(s)}`);
	assert.match(f.message, /alias/);
	assert.match(f.message, /every 12 h/, 'says the sampling rate it actually needs');
});

test('an FFT on unevenly sampled data is caught, and told about Lomb-Scargle', () => {
	// The check that earns its keep: an FFT assumes even spacing and cannot notice it didn't
	// get it. The fix is one param away, so the message names it.
	const { session } = normalizeSession({
		columns: [
			{ name: 't', values: [0, 1, 2, 3.9, 8, 9, 15, 21, 30, 44, 60, 61, 62, 80, 96] },
			{ name: 'v', values: Array.from({ length: 15 }, (_, i) => Math.sin(i)) }
		],
		analyses: [{ name: 'RhythmicityAnalysis', args: { xIN: 't', yIN: ['v'], analysis: 'fft', periodMax: 24 } }]
	});
	const f = highs(session).find((x) => /FFT/.test(x.message));
	assert.ok(f, `expected an FFT warning, got:\n${messages(session)}`);
	assert.match(f.message, /Lomb-Scargle/);
});

test('a time column that goes backwards is caught', () => {
	const { session } = normalizeSession({
		columns: [
			{ name: 't', values: [0, 6, 12, 18, 24, 12, 36, 42, 48, 54, 60, 66] },
			{ name: 'v', values: Array.from({ length: 12 }, (_, i) => i) }
		],
		analyses: [{ name: 'Cosinor', args: { xIN: 't', yIN: ['v'], useFixedPeriod: true, fixedPeriod: 24 } }]
	});
	assert.ok(highs(session).some((f) => /goes backwards/.test(f.message)));
});

test('paired-by-position columns of different lengths are caught', () => {
	const { session } = normalizeSession({
		columns: [
			{ name: 't', values: Array.from({ length: 80 }, (_, i) => i) },
			{ name: 'v', values: Array.from({ length: 40 }, (_, i) => i) }
		],
		analyses: [{ name: 'Cosinor', args: { xIN: 't', yIN: ['v'], useFixedPeriod: true, fixedPeriod: 24 } }]
	});
	const f = highs(session).find((x) => /40 values/.test(x.message));
	assert.ok(f, `expected a length warning, got:\n${messages(session)}`);
	assert.match(f.message, /paired by position/);
});

test("an analysis reading another analysis's output is skipped, not guessed at", () => {
	// Split's outputs are empty at emit time — the GUI fills them in on load. Judging a column
	// we cannot see would mean inventing the verdict.
	const s = simulated({
		hours: 480,
		step: 1,
		analysis: { name: 'Split', args: { xIN: 'time', yIN: ['values'], splitTimes: [100] } }
	});
	const withDownstream = normalizeSession({
		analyses: [
			{ name: 'SimulatedData', args: { seed: 1, samplingPeriod_hours: 1, sections: [{ duration_hours: 480, rhythmPeriod_hours: 24 }] } },
			{ name: 'Split', args: { xIN: 'time', yIN: ['values'], splitTimes: [100] } },
			{ name: 'Cosinor', args: { xIN: 'time', yIN: ['values_1'], useFixedPeriod: true, fixedPeriod: 24 } }
		]
	}).session;
	// values_1 is empty; the x column is real, so only x-based checks could fire, and 480 h is
	// plenty. The point is it doesn't crash or invent a complaint about the empty column.
	assert.deepEqual(checkFitness(withDownstream), []);
	assert.deepEqual(checkFitness(s), []);
});

test('a free-period search declares no target, so nothing is measured against it', () => {
	// useFixedPeriod:false ⇒ the node is searching, not fitting a stated period. Warning that
	// 36 h is too short for "24 h" would be inventing the 24.
	const s = simulated({
		hours: 36,
		step: 1,
		analysis: { name: 'Cosinor', args: { xIN: 'time', yIN: ['values'], useFixedPeriod: false } }
	});
	assert.deepEqual(checkFitness(s), []);
});

test('findings are ordered high-severity first', () => {
	const s = simulated({
		hours: 30,
		step: 13,
		analysis: { name: 'Cosinor', args: { xIN: 'time', yIN: ['values'], useFixedPeriod: true, fixedPeriod: 24 } }
	});
	const sev = checkFitness(s).map((f) => f.severity);
	assert.ok(sev.length > 1);
	assert.deepEqual(sev, [...sev].sort((a, b) => (a === 'high' ? -1 : 1) - (b === 'high' ? -1 : 1)));
});
