// node --test src/emit/normalizer.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSession } from './normalizer.js';
import { SCHEMA } from './schema.js';

const findTP = (s, name) => s.tableProcesses.find((t) => t.name === name);
const colById = (s, id) => s.data.find((c) => c.id === id);

test('import columns → data + baked rawData', () => {
	const { session, errors } = normalizeSession({
		columns: [
			{ name: 'time', type: 'time', values: [0, 1, 2] },
			{ name: 'values', values: [10, 20, 30] }
		]
	});
	assert.equal(errors.length, 0);
	assert.equal(session.data.length, 2);
	const t = session.data.find((c) => c.name === 'time');
	assert.equal(t.type, 'time');
	assert.deepEqual(session.rawData[t.id], [0, 1, 2]); // inputs are baked
	assert.equal(session.data.find((c) => c.name === 'values').data, 1);
});

test('Cosinor by NAME resolves refs, pre-allocates out, leaves outputs empty', () => {
	const { session, errors } = normalizeSession({
		columns: [
			{ name: 'time', type: 'time', values: [0, 1, 2, 3] },
			{ name: 'y0', values: [1, 2, 1, 2] }
		],
		analyses: [{ name: 'Cosinor', args: { xIN: 'time', yIN: ['y0'], fixedPeriod: 24 } }]
	});
	assert.equal(errors.length, 0, errors.join('; '));
	const cos = findTP(session, 'Cosinor');
	// names resolved to ids
	assert.equal(cos.args.xIN, 0);
	assert.deepEqual(cos.args.yIN, [1]);
	// default params filled
	assert.equal(cos.args.useFixedPeriod, true);
	assert.equal(cos.args.nHarmonics, 1);
	// out pre-allocated: cosinorx (fixed, always present) + 8 metrics + one per-Y curve
	const keys = Object.keys(cos.args.out);
	assert.ok(keys.includes('period') && keys.includes('rsquared'));
	assert.ok(keys.includes('cosinory_1'), `expected cosinory_1 in ${keys}`);
	assert.ok(keys.includes('cosinorx'), 'cosinorx is a fixed output, always allocated');
	// every out id is a real column whose rawData is EMPTY (GUI computes it)
	for (const id of Object.values(cos.args.out)) {
		assert.ok(colById(session, id), `out column ${id} exists in data[]`);
		assert.deepEqual(session.rawData[id], []);
	}
});

test('yIN scalar is coerced to an array', () => {
	const { session } = normalizeSession({
		columns: [{ name: 't', values: [0, 1] }, { name: 'y', values: [1, 2] }],
		analyses: [{ name: 'Cosinor', args: { xIN: 't', yIN: 'y' } }]
	});
	assert.deepEqual(findTP(session, 'Cosinor').args.yIN, [1]);
});

test('nested params/inputs wrapper is flattened', () => {
	const { session, errors } = normalizeSession({
		columns: [{ name: 't', values: [0] }, { name: 'y', values: [1] }],
		analyses: [
			{ name: 'Cosinor', args: { inputs: { xIN: 't', yIN: ['y'] }, params: { fixedPeriod: 12 } } }
		]
	});
	assert.equal(errors.length, 0, errors.join('; '));
	const cos = findTP(session, 'Cosinor');
	assert.equal(cos.args.xIN, 0);
	assert.equal(cos.args.fixedPeriod, 12);
	assert.ok(!('inputs' in cos.args) && !('params' in cos.args));
});

test('per-Y output allocates one curve column per Y', () => {
	const { session } = normalizeSession({
		columns: [
			{ name: 't', values: [0, 1] },
			{ name: 'a', values: [1, 2] },
			{ name: 'b', values: [3, 4] }
		],
		analyses: [{ name: 'BinnedData', args: { xIN: 't', yIN: ['a', 'b'] } }]
	});
	const bin = findTP(session, 'BinnedData');
	assert.ok('binnedy_1' in bin.args.out && 'binnedy_2' in bin.args.out);
	assert.ok('binnedx' in bin.args.out);
});

test('SimulatedData BAKES its outputs so a downstream analysis has populated inputs', () => {
	const { session, errors } = normalizeSession({
		analyses: [
			{
				name: 'SimulatedData',
				args: {
					samplingPeriod_hours: 1,
					sections: [
						{
							duration_hours: 48,
							rhythmPeriod_hours: 24,
							rhythmPhase_hours: 0,
							rhythmAmplitude: 100,
							noiseEnabled: false,
							noiseMode: 'multiply',
							noiseAmplitude: 1
						}
					]
				}
			}
		]
	});
	assert.equal(errors.length, 0, errors.join('; '));
	const sim = findTP(session, 'SimulatedData');
	// 48h at 1h steps → 48 samples in BOTH outputs (not empty)
	assert.equal(session.rawData[sim.args.out.time].length, 48);
	assert.equal(session.rawData[sim.args.out.values].length, 48);
	// the time column carries type + format, or it renders as a raw number
	const timeCol = colById(session, sim.args.out.time);
	assert.equal(timeCol.type, 'time');
	assert.equal(timeCol.timeFormat, 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]');
	assert.match(session.rawData[sim.args.out.time][0], /^\d{4}-\d{2}-\d{2}T/);
});

test('SimulatedData is deterministic: same seed → same values', () => {
	const draft = (seed) => ({
		analyses: [{ name: 'SimulatedData', args: { seed, samplingPeriod_hours: 1 } }]
	});
	const a = normalizeSession(draft(7));
	const b = normalizeSession(draft(7));
	const c = normalizeSession(draft(8));
	const valsOf = (r) => r.session.rawData[findTP(r.session, 'SimulatedData').args.out.values];
	assert.deepEqual(valsOf(a), valsOf(b), 'same seed reproduces');
	assert.notDeepEqual(valsOf(a), valsOf(c), 'different seed diverges');
});

// A 'suffix' node (RhythmicityAnalysis) keys its per-Y outputs `${yid}_${suffix}` — the id
// LEADS, where every other node's trails. The name-mapping rule only knew about trailing ids,
// so these columns kept their id-keyed names and nothing could refer to them: the model writes
// NAMES and cannot know an id. It's also what the live app calls the column, so a built session
// and a hand-made one now agree.
test('suffix-node outputs are named after the Y column, so the model can plot them', () => {
	const { session, errors, warnings } = normalizeSession({
		columns: [
			{ name: 'time', type: 'time', values: [0, 1, 2, 3] },
			{ name: 'activity', values: [1, 2, 3, 4] }
		],
		analyses: [
			{
				name: 'RhythmicityAnalysis',
				args: { xIN: 'time', yIN: ['activity'], analysis: 'periodogram', pgMethod: 'Lomb-Scargle' }
			}
		],
		// Exactly what the catalogue now tells a model to write.
		plots: [
			{ type: 'periodogram', series: [{ time: 'activity_period', values: 'activity_power' }] }
		]
	});
	assert.deepEqual(errors, []);
	assert.deepEqual(warnings, []);

	const tp = findTP(session, 'RhythmicityAnalysis');
	// The KEYS stay id-based — that's the node's own contract, and not the model's business.
	assert.deepEqual(Object.keys(tp.args.out), ['1_period', '1_power']);
	// The NAMES are what the model was told to use.
	const named = session.data.map((c) => c.name);
	assert.ok(named.includes('activity_period'), `expected activity_period in ${named}`);
	assert.ok(named.includes('activity_power'), `expected activity_power in ${named}`);

	// And the plot actually wired to them, rather than being dropped as unresolvable.
	const [series] = session.plots[0].plot.data;
	assert.equal(series.x.refId, tp.args.out['1_period']);
	assert.equal(series.y.refId, tp.args.out['1_power']);
});

// The catalogue is GENERATED and TRACKED, and `npm run build` regenerates it — so it has to be
// a pure function of the registry. It wasn't: SimulatedData/Random seed from entropy and
// SimulatedData/SequenceColumn default to the current clock, so every build rewrote the file
// with a new seed and timestamp. Tracked churn hides real changes and makes two developers
// conflict over noise.
// Split keys its per-Y outputs `${yid}_${segment}` — so with yIN [1] and two segments the keys
// are `1_1` and `1_2`. BOTH naming rules match `1_1`: read as `${prefix}${yid}` it becomes
// `1_values`, read as `${yid}_${suffix}` it becomes `values_1`. The trailing rule used to win,
// so one Split produced `1_values` AND `values_2` — two conventions from one node, neither of
// them guessable. A model asked to "split the data and plot each part" invented `values_0` /
// `values_1` and every downstream analysis was dropped.
test('Split names every segment the same way, and the way a model would guess', () => {
	const { session, errors } = normalizeSession({
		columns: [
			{ name: 'time', type: 'time', values: [0, 1, 2, 3] },
			{ name: 'values', values: [1, 2, 3, 4] }
		],
		analyses: [{ name: 'Split', args: { xIN: 'time', yIN: ['values'], splitTimes: [2] } }]
	});
	assert.deepEqual(errors, []);

	const tp = findTP(session, 'Split');
	// One segment per split point, plus the tail — keyed by id, as the node does internally.
	assert.deepEqual(Object.keys(tp.args.out), ['1_1', '1_2']);

	// ...but NAMED consistently after the Y column, so `values_1` and `values_2` are referable.
	const named = Object.values(tp.args.out).map((id) => colById(session, id).name);
	assert.deepEqual(named, ['values_1', 'values_2']);
});

// The units trap that made a user's periodograms blank: on a time axis the model gives split
// points as HOURS from the start (it reads "14 days" and emits 336), but the Split node compares
// against absolute epoch-ms. 336 ms lands on the first sample, so one segment is empty and every
// analysis downstream plots nothing. The normalizer bridges it using the baked time column.
test('Split on a TIME axis converts hours-from-start to absolute time', () => {
	const times = Array.from({ length: 49 }, (_, i) => i * 3600000); // epoch-ms, 0..48h hourly
	const { session, errors } = normalizeSession({
		columns: [
			{ name: 'time', type: 'time', values: times },
			{ name: 'values', values: times.map((_, i) => i) }
		],
		analyses: [{ name: 'Split', args: { xIN: 'time', yIN: ['values'], splitTimes: [24] } }]
	});
	assert.deepEqual(errors, []);
	// 24 HOURS from start (0) → the real 24 h boundary in ms, not the literal 24.
	assert.deepEqual(findTP(session, 'Split').args.splitTimes, [24 * 3600000]);
});

test('Split conversion honours a non-zero start time', () => {
	const start = Date.parse('2020-06-01T00:00:00.000Z');
	const times = Array.from({ length: 49 }, (_, i) => new Date(start + i * 3600000).toISOString());
	const { session } = normalizeSession({
		columns: [
			{ name: 'time', type: 'time', values: times },
			{ name: 'values', values: times.map((_, i) => i) }
		],
		analyses: [{ name: 'Split', args: { xIN: 'time', yIN: ['values'], splitTimes: [12] } }]
	});
	assert.deepEqual(findTP(session, 'Split').args.splitTimes, [start + 12 * 3600000]);
});

test('Split on a NUMERIC axis leaves splitTimes in the column’s own units', () => {
	const { session } = normalizeSession({
		columns: [
			{ name: 'x', values: [0, 1, 2, 3, 4] },
			{ name: 'y', values: [0, 1, 2, 3, 4] }
		],
		analyses: [{ name: 'Split', args: { xIN: 'x', yIN: ['y'], splitTimes: [2] } }]
	});
	assert.deepEqual(findTP(session, 'Split').args.splitTimes, [2]);
});

test('Split warns when a converted split falls outside the recording', () => {
	const times = Array.from({ length: 25 }, (_, i) => i * 3600000); // only 24 h of data
	const { warnings } = normalizeSession({
		columns: [
			{ name: 'time', type: 'time', values: times },
			{ name: 'v', values: times }
		],
		analyses: [{ name: 'Split', args: { xIN: 'time', yIN: ['v'], splitTimes: [999] } }] // 999 h ≫ 24 h
	});
	assert.ok(warnings.some((w) => /outside the recording/.test(w)), warnings.join('; '));
});

test('a Split segment can be fed straight into another analysis, by name', () => {
	// The whole point: "split the data, then run a periodogram on each part". Time is epoch-ms
	// (hourly), and the split is 2 HOURS in — a real point inside the recording, so it converts
	// cleanly and raises no warning.
	const hourly = [0, 3600000, 7200000, 10800000];
	const { session, errors, warnings } = normalizeSession({
		columns: [
			{ name: 'time', type: 'time', values: hourly },
			{ name: 'values', values: [1, 2, 3, 4] }
		],
		analyses: [
			{ name: 'Split', args: { xIN: 'time', yIN: ['values'], splitTimes: [2] } },
			{
				name: 'RhythmicityAnalysis',
				args: { xIN: 'time', yIN: ['values_2'], analysis: 'periodogram', pgMethod: 'Lomb-Scargle' }
			}
		],
		plots: [{ type: 'periodogram', series: [{ time: 'values_2_period', values: 'values_2_power' }] }]
	});
	assert.deepEqual(errors, []);
	assert.deepEqual(warnings, []);
	assert.ok(session.plots[0].plot.data[0].x.refId >= 0, 'the periodogram is wired, not dropped');
});

test('the generated catalogue holds no entropy or wall-clock values', async () => {
	const generated = (await import('./session-schema.generated.json', { with: { type: 'json' } })).default;

	const volatile = [];
	const walk = (value, path) => {
		if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${path}[${i}]`));
		if (value && typeof value === 'object') {
			return Object.entries(value).forEach(([k, v]) => walk(v, `${path}.${k}`));
		}
		// A real timestamp is ~1.7e12; a real seed is a big random int. The placeholders are 0.
		const key = path.split('.').pop();
		if (/^(seed|startTime|endTime)/.test(key) && typeof value === 'number' && value !== 0) {
			volatile.push(`${path} = ${value}`);
		}
	};
	for (const [name, node] of Object.entries(generated.nodes)) walk(node.params ?? {}, name);

	assert.deepEqual(volatile, [], 'regenerating would churn these fields on every build');
});

test('the session version is registry-derived, not a hand-kept literal', async () => {
	const { session } = normalizeSession({ analyses: [{ name: 'SimulatedData', args: { seed: 1 } }] });
	const generated = (await import('./session-schema.generated.json', { with: { type: 'json' } })).default;

	// It must be the version the CATALOGUE was generated from — the same read, carried across
	// the boundary in a plain file rather than by importing core.svelte.js (which would drag the
	// app into a Worker bundle). Hand-maintaining it let it fall two versions behind the app.
	assert.equal(session.version, generated.generatedFromVersion);
	// A real version, not the 'unknown' fallback: shipping sessions stamped "unknown" would make
	// them untraceable, and it means someone committed a catalogue generated without a registry.
	assert.notEqual(session.version, 'unknown');
	assert.match(session.version, /^β\./);
});

test('provenance is opt-in, injected, and keeps the normalizer pure', () => {
	const draft = { analyses: [{ name: 'SimulatedData', args: { seed: 1 } }] };

	// A human-built session must not be labelled as AI-built, so no caller ⇒ no key at all
	// (`'generatedBy' in session` is false, not `generatedBy: null`).
	const plain = normalizeSession(draft);
	assert.equal('generatedBy' in plain.session, false);

	// Stamped verbatim when given — the normalizer never mints an id or reads the clock, which
	// is what keeps "same draft ⇒ same session" true.
	const fp = { source: 'ancir-nl', route: 'mcp', sessionId: 'abc', generatedAt: 'T' };
	const a = normalizeSession(draft, { provenance: fp });
	const b = normalizeSession(draft, { provenance: fp });
	assert.deepEqual(a.session.generatedBy, fp);
	assert.deepEqual(a.session, b.session, 'still deterministic with provenance');

	// Provenance is the ONLY difference it makes: strip it and the sessions are identical.
	delete a.session.generatedBy;
	assert.deepEqual(a.session, plain.session);
});

test('SequenceColumn time mode emits a time-typed, formatted column', () => {
	const { session } = normalizeSession({
		analyses: [
			{
				name: 'SequenceColumn',
				args: { seqType: 'time', startTime: Date.parse('2024-01-01T00:00:00.000Z'), stepHours: 1, count: 5 }
			}
		]
	});
	const seq = findTP(session, 'SequenceColumn');
	const col = colById(session, seq.args.out.result);
	assert.equal(col.type, 'time');
	assert.equal(col.timeFormat, 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]');
	assert.equal(session.rawData[seq.args.out.result].length, 5);
});

test('generator with a generate() bakes its outputs (SequenceColumn)', () => {
	const { session } = normalizeSession({
		analyses: [{ name: 'SequenceColumn', args: { start: 0, step: 2, count: 5 } }]
	});
	const seq = findTP(session, 'SequenceColumn');
	assert.deepEqual(session.rawData[seq.args.out.result], [0, 2, 4, 6, 8]);
});

test('SequenceColumn output is usable as a NAMED input to an analysis, with baked data', () => {
	const { session, errors } = normalizeSession({
		analyses: [
			{ name: 'SequenceColumn', args: { start: 0, step: 1, count: 4 } },
			// reference the generator output by its key name "result"
			{ name: 'BinnedData', args: { xIN: 'result', yIN: ['result'] } }
		]
	});
	assert.equal(errors.length, 0, errors.join('; '));
	const bin = findTP(session, 'BinnedData');
	const seq = findTP(session, 'SequenceColumn');
	assert.equal(bin.args.xIN, seq.args.out.result); // resolved to the baked generator column
	assert.deepEqual(session.rawData[seq.args.out.result], [0, 1, 2, 3]);
});

test('unresolved column ref drops the analysis with an error', () => {
	const { session, errors } = normalizeSession({
		columns: [{ name: 't', values: [0] }],
		analyses: [{ name: 'Cosinor', args: { xIN: 't', yIN: ['does_not_exist'] } }]
	});
	assert.equal(session.tableProcesses.length, 0);
	assert.match(errors.join(' '), /does_not_exist/);
});

test('semantic validation drops a bad SimulatedData (invalid startTime)', () => {
	const { session, errors } = normalizeSession({
		analyses: [{ name: 'SimulatedData', args: { startTime: 'not-a-date' } }]
	});
	assert.equal(session.tableProcesses.length, 0);
	assert.match(errors.join(' '), /startTime/);
});

test('unknown analysis is reported, not emitted', () => {
	const { session, errors } = normalizeSession({
		analyses: [{ name: 'NoSuchNode', args: {} }]
	});
	assert.equal(session.tableProcesses.length, 0);
	assert.match(errors.join(' '), /Unknown analysis/);
});

test('schema is registry-derived: broad node coverage + Cosinor keeps its fixed cosinorx', () => {
	// Regression guard for the bug this whole exercise found: a hand-authored schema
	// missed Cosinor's fixed `cosinorx` output; the registry-derived one must carry it.
	assert.ok(Object.keys(SCHEMA).length >= 20, 'expected the full registry, not a hand-picked few');
	const cosOut = SCHEMA.Cosinor.out({ yIN: [7] }).map((o) => o.key);
	assert.ok(cosOut.includes('cosinorx'), `Cosinor fixed outputs must include cosinorx: ${cosOut}`);
	assert.ok(cosOut.includes('cosinory_7'), 'per-Y curve key derives from the y id');
	// BinnedData params come from the registry (the hand-authored ones were wrong).
	assert.ok('binMode' in SCHEMA.BinnedData.params, 'registry params, not guessed names');
});

test('suffix node (RhythmicityAnalysis) pre-allocates `${yid}_${suffix}` keys per method', () => {
	const draft = (args) => ({
		columns: [{ name: 't', values: [0, 1, 2] }, { name: 'y', values: [1, 2, 3] }],
		analyses: [{ name: 'RhythmicityAnalysis', args: { xIN: 't', yIN: ['y'], ...args } }]
	});
	// default periodogram (Lomb-Scargle) → period + power for y (column id 1)
	const pg = normalizeSession(draft({}));
	const pgKeys = Object.keys(pg.session.tableProcesses[0].args.out);
	assert.deepEqual(pgKeys.sort(), ['1_period', '1_power']);
	assert.equal(pg.warnings.length, 0, 'a baked combo must not warn');
	// NOT the collected-mode prefix — that would be the wrong key and silently break compute
	assert.ok(!pgKeys.some((k) => k.startsWith('rhythmicityy_')));

	// Chi-squared adds a `threshold` output — baked from the node's own helper
	const chi = normalizeSession(draft({ pgMethod: 'Chi-squared' }));
	assert.ok(Object.keys(chi.session.tableProcesses[0].args.out).includes('1_threshold'));

	// fft has an entirely different key set
	const fft = normalizeSession(draft({ analysis: 'fft' }));
	assert.deepEqual(
		Object.keys(fft.session.tableProcesses[0].args.out).sort(),
		['1_frequency', '1_magnitude', '1_period', '1_phase']
	);
});

test('un-baked discriminator combo warns instead of emitting wrong keys', () => {
	const { warnings } = normalizeSession({
		columns: [{ name: 't', values: [0, 1] }, { name: 'y', values: [1, 2] }],
		analyses: [
			{ name: 'RhythmicityAnalysis', args: { xIN: 't', yIN: ['y'], analysis: 'not-a-method' } }
		]
	});
	assert.match(warnings.join(' '), /no baked output keys/);
});

test('computed-output node (Split) pre-allocates one column per y × segment', () => {
	const { session, warnings, errors } = normalizeSession({
		columns: [{ name: 't', values: [0, 1, 2] }, { name: 'y', values: [1, 2, 3] }],
		analyses: [{ name: 'Split', args: { xIN: 't', yIN: ['y'], splitTimes: [1] } }]
	});
	assert.equal(errors.length, 0, errors.join('; '));
	assert.equal(warnings.length, 0, 'args-derived keys need no warning');
	const split = findTP(session, 'Split');
	// 1 split point → 2 segments for y (column id 1)
	assert.deepEqual(Object.keys(split.args.out).sort(), ['1_1', '1_2']);
	for (const id of Object.values(split.args.out)) assert.ok(colById(session, id));
});

test('MovingAnalysis pre-allocates movex + per-(y,stat) columns', () => {
	const { session, warnings } = normalizeSession({
		columns: [{ name: 't', values: [0, 1] }, { name: 'y', values: [1, 2] }],
		analyses: [{ name: 'MovingAnalysis', args: { xIN: 't', yIN: ['y'], analysis: 'periodogram' } }]
	});
	const ma = findTP(session, 'MovingAnalysis');
	// movex is the node's own fixed output; the stats are computed per y (column id 1)
	assert.deepEqual(Object.keys(ma.args.out).sort(), ['1_peak_period', '1_peak_power', 'movex']);
	assert.equal(warnings.length, 0);
});

test('LongToWide reads its categories from the baked category column', () => {
	const { session, warnings } = normalizeSession({
		columns: [
			{ name: 'time', values: [0, 1, 2, 3] },
			{ name: 'group', type: 'category', values: ['ctrl', 'ko', 'ctrl', 'wt'] },
			{ name: 'val', values: [1, 2, 3, 4] }
		],
		analyses: [
			{ name: 'LongToWide', args: { timeIN: 'time', categoryIN: 'group', valueIN: 'val' } }
		]
	});
	const l2w = findTP(session, 'LongToWide');
	// `time` is its fixed output; one value_<category> per distinct group, de-duplicated
	assert.deepEqual(Object.keys(l2w.args.out).sort(), [
		'time', 'value_ctrl', 'value_ko', 'value_wt'
	]);
	assert.equal(warnings.length, 0);
});

test('LongToWide warns (rather than guesses) when categories are not yet knowable', () => {
	// categoryIN wired to an ANALYSIS output → empty at emit time, so the categories in it
	// cannot be enumerated. Warn instead of inventing keys.
	const { warnings } = normalizeSession({
		columns: [{ name: 't', values: [0, 1] }, { name: 'y', values: [1, 2] }],
		analyses: [
			{ name: 'Cosinor', args: { xIN: 't', yIN: ['y'] } },
			{ name: 'LongToWide', args: { timeIN: 't', categoryIN: 'period', valueIN: 'y' } }
		]
	});
	assert.match(warnings.join(' '), /no data at emit time/);
});

test('plot emits refId series in the inner `plot.data`, not flat column ids', () => {
	const { session, errors } = normalizeSession({
		columns: [{ name: 'hour', values: [0, 1] }, { name: 'signal', values: [5, 6] }],
		plots: [{ type: 'scatterplot', inputs: { x: 'hour', y: 'signal' } }]
	});
	assert.equal(errors.length, 0, errors.join('; '));
	const p = session.plots[0];
	assert.equal(p.type, 'scatterplot');
	// the shape the GUI actually reads: plot.data[] with {refId} wrappers
	const s = p.plot.data[0];
	assert.deepEqual(s.x, { refId: 0 });
	assert.deepEqual(s.y, { refId: 1 });
	// …and the style slots MUST be present: the plot classes do an unguarded
	// LineClass.fromJSON(json.line) → json.colour, so an absent slot throws and
	// importJson silently skips the whole plot. Empty objects → class defaults.
	assert.ok(s.line.colour, 'line slot carries an explicit colour (palette fallback would crash)');
	assert.ok(s.points.colour, 'points slot carries an explicit colour');
	assert.ok(p.width > 0 && p.height > 0, 'carries a renderable box');
});

test('a requested series colour reaches a plot that reads a TOP-LEVEL colour (actogram)', () => {
	// "plot the binned profile in a pink actogram" produced a NAVY actogram: the colour was
	// written into the line/points slots, but the actogram reads `series.colour` directly, so it
	// never saw it and fell back to the palette. The colour must be emitted at the top level too.
	const { session, errors } = normalizeSession({
		columns: [{ name: 'binnedx', type: 'time', values: [0, 3600000] }, { name: 'act', values: [1, 2] }],
		plots: [{ type: 'actogram', series: [{ time: 'binnedx', values: 'act', colour: 'pink' }] }]
	});
	assert.deepEqual(errors, []);
	const s = session.plots[0].plot.data[0];
	assert.equal(s.colour, 'pink', 'the actogram reads this; it must carry the requested colour');
	// Still in the slots too, so line/points plots are unaffected.
	assert.equal(s.line.colour, 'pink');
});

test('an omitted colour still defaults, and only the asked-for series is coloured', () => {
	const { session } = normalizeSession({
		columns: [{ name: 't', type: 'time', values: [0, 3600000] }, { name: 'a', values: [1, 2] }],
		plots: [{ type: 'actogram', series: [{ time: 't', values: 'a' }] }]
	});
	// No colour asked ⇒ a real default, never undefined (the actogram would palette-fallback).
	assert.ok(session.plots[0].plot.data[0].colour, 'a default colour is always present');
});

test('a plot carries MULTIPLE series, so raw data + fitted curve share one plot', () => {
	// The canonical Cosinor viz (matches AnCiR's own Quick-Plot): raw points + fit line.
	const { session, errors } = normalizeSession({
		columns: [{ name: 'hour', values: [0, 1] }, { name: 'signal', values: [5, 6] }],
		analyses: [{ name: 'Cosinor', args: { xIN: 'hour', yIN: ['signal'], fixedPeriod: 24 } }],
		plots: [
			{
				type: 'scatterplot',
				name: 'Cosinor: data + fit',
				series: [
					{ x: 'hour', y: 'signal', label: 'signal', kind: 'points' },
					{ x: 'cosinorx', y: 'cosinory_signal', label: 'signal fit', kind: 'line' }
				]
			}
		]
	});
	assert.equal(errors.length, 0, errors.join('; '));
	const data = session.plots[0].plot.data;
	assert.equal(data.length, 2, 'both series are emitted');

	const cos = findTP(session, 'Cosinor');
	// raw series: the analysis's OWN inputs, drawn as points
	assert.deepEqual(data[0].x, { refId: 0 });
	assert.deepEqual(data[0].y, { refId: 1 });
	assert.equal(data[0].points.draw, true);
	assert.equal(data[0].line.draw, false);
	assert.equal(data[0].label, 'signal');
	// fit series: the fit's x paired with the fit's y — NOT the fitted x against the raw y.
	// NB the out KEY is keyed by the y column's ID (`cosinory_1`) while the output COLUMN is
	// named after it (`cosinory_signal`) — the draft refers to the friendly name.
	assert.deepEqual(data[1].x, { refId: cos.args.out.cosinorx });
	assert.deepEqual(data[1].y, { refId: cos.args.out.cosinory_1 });
	assert.equal(colById(session, cos.args.out.cosinory_1).name, 'cosinory_signal');
	assert.equal(data[1].line.draw, true);
	assert.equal(data[1].points.draw, false);
	// and they're visually distinguishable
	assert.notEqual(data[0].points.colour, data[1].line.colour);
});

test('single-series `inputs` shorthand still works', () => {
	const { session, errors } = normalizeSession({
		columns: [{ name: 'hour', values: [0, 1] }, { name: 'signal', values: [5, 6] }],
		plots: [{ type: 'scatterplot', inputs: { x: 'hour', y: 'signal' } }]
	});
	assert.equal(errors.length, 0, errors.join('; '));
	assert.equal(session.plots[0].plot.data.length, 1);
	assert.deepEqual(session.plots[0].plot.data[0].x, { refId: 0 });
});

test('an unresolved ref in ANY series drops the plot rather than emitting half of it', () => {
	const { session, errors } = normalizeSession({
		columns: [{ name: 'hour', values: [0, 1] }, { name: 'signal', values: [5, 6] }],
		plots: [
			{
				type: 'scatterplot',
				series: [
					{ x: 'hour', y: 'signal' },
					{ x: 'hour', y: 'not_a_column' }
				]
			}
		]
	});
	assert.equal(session.plots.length, 0);
	assert.match(errors.join(' '), /not_a_column/);
});

test('schema exposes each fit node’s x/y pairing (registry-derived)', () => {
	// This is what the prompt teaches the model, so it must come from the registry.
	assert.deepEqual(SCHEMA.Cosinor.fitOut, { x: 'cosinorx', yPrefix: 'cosinory_' });
	assert.deepEqual(SCHEMA.FitFunction.fitOut, { x: 'fitx', yPrefix: 'fity_' });
	assert.equal(SCHEMA.GroupComparison.fitOut, null, 'non-fit nodes have none');
});

test('a time/values plot is READ by port name but STORED as x/y', () => {
	// The two vocabularies that broke the actogram. `time`/`values` are the PORT names the
	// registry advertises and the prompt teaches; the plot classes persist every series as
	// generic x/y and their fromJSON reads nothing else. This test previously asserted
	// `pg.time`, which locked the bug in: AnCiR loaded such a plot with refId -1 on every
	// input and then threw "undefined (reading 'left')" from the actogram's LightBand.
	const { session, errors } = normalizeSession({
		columns: [{ name: 't', values: [0, 1] }, { name: 'v', values: [5, 6] }],
		plots: [
			{ type: 'periodogram', inputs: { time: 't', values: 'v' } },
			{ type: 'histogram', inputs: { column: 'v' } }
		]
	});
	assert.equal(errors.length, 0, errors.join('; '));
	const pg = session.plots[0].plot.data[0];
	assert.deepEqual(pg.x, { refId: 0 }, 'the `time` port is stored as x');
	assert.deepEqual(pg.y, { refId: 1 }, 'the `values` port is stored as y');
	assert.equal(pg.time, undefined, 'port names must not be persisted — fromJSON ignores them');
	assert.equal(pg.values, undefined);
	// Periodogram reads line + thresholdline + points unguarded — all must be present
	for (const slot of ['line', 'thresholdline', 'points']) assert.ok(pg[slot]?.colour, slot);
	// histogram's single input keeps its own name: the class reads json.column.
	assert.deepEqual(session.plots[1].plot.data[0].column, { refId: 1 });
	// staggered so they don't stack
	assert.notDeepEqual(
		[session.plots[0].x, session.plots[0].y],
		[session.plots[1].x, session.plots[1].y]
	);
});

test('tableplot uses columnRefs/showCol, not x/y series', () => {
	const { session } = normalizeSession({
		columns: [{ name: 'a', values: [1] }, { name: 'b', values: [2] }],
		plots: [{ type: 'tableplot', inputs: ['a', 'b'] }]
	});
	assert.deepEqual(session.plots[0].plot, { columnRefs: [0, 1], showCol: [true, true] });
});

test('an actogram wired by port name loads WIRED (the reported bug)', () => {
	// The exact prompt: "bin it into 1 h bins and plot the binned profile in an actogram".
	// The model got it right (time/values are the actogram's real port names), but the emitted
	// series used those names as storage keys, ActogramDataclass.fromJSON read json.x/json.y,
	// found nothing, and defaulted both to refId -1. The user got an unwired actogram that
	// crashed the canvas. Every input must resolve to a REAL column id.
	const { session, errors } = normalizeSession({
		columns: [{ name: 'binnedx', values: [0, 1] }, { name: 'binnedy_values', values: [5, 6] }],
		plots: [
			{ type: 'actogram', name: 'Binned profile', series: [{ time: 'binnedx', values: 'binnedy_values' }] }
		]
	});
	assert.equal(errors.length, 0, errors.join('; '));
	const s = session.plots[0].plot.data[0];
	assert.deepEqual(s.x, { refId: 0 });
	assert.deepEqual(s.y, { refId: 1 });
	assert.ok(s.x.refId >= 0 && s.y.refId >= 0, 'never the -1 that made the plot unwired');
});

test('a time/values plot also accepts the generic x/y vocabulary', () => {
	// The prompt's worked example is a scatterplot, so a model may reach for x/y on an actogram.
	// It means the same thing; refusing it would cost the user a plot for no reason.
	const { session, errors } = normalizeSession({
		columns: [{ name: 'hour', values: [0, 1] }, { name: 'act', values: [5, 6] }],
		plots: [{ type: 'actogram', inputs: { x: 'hour', y: 'act' } }]
	});
	assert.equal(errors.length, 0, errors.join('; '));
	assert.equal(session.plots.length, 1, 'the plot survives instead of being silently dropped');
	const s = session.plots[0].plot.data[0];
	assert.deepEqual(s.x, { refId: 0 });
	assert.deepEqual(s.y, { refId: 1 });
});

test('the port name wins when a spec carries both vocabularies', () => {
	const { session, errors } = normalizeSession({
		columns: [{ name: 'hour', values: [0, 1] }, { name: 'act', values: [5, 6] }],
		plots: [
			{ type: 'periodogram', series: [{ time: 'hour', values: 'act', label: 'act' }] },
			{ type: 'actogram', series: [{ time: 'hour', values: 'act', x: 'act', y: 'hour' }] }
		]
	});
	assert.equal(errors.length, 0, errors.join('; '));
	assert.deepEqual(session.plots[0].plot.data[0].x, { refId: 0 });
	assert.equal(session.plots[0].plot.data[0].label, 'act');
	assert.deepEqual(session.plots[1].plot.data[0].x, { refId: 0 }, 'time won over x');
	assert.deepEqual(session.plots[1].plot.data[0].y, { refId: 1 });
});

test('plots whose ports really are x/y, and histogram, are unaffected', () => {
	const scatter = normalizeSession({
		columns: [{ name: 'a', values: [1] }, { name: 'b', values: [2] }],
		plots: [{ type: 'scatterplot', inputs: { x: 'a', y: 'b' } }]
	});
	assert.equal(scatter.errors.length, 0, scatter.errors.join('; '));
	assert.deepEqual(scatter.session.plots[0].plot.data[0].x, { refId: 0 });
	assert.deepEqual(scatter.session.plots[0].plot.data[0].y, { refId: 1 });

	// histogram has ONE input, stored under its own name — it must not become `x`.
	const hist = normalizeSession({
		columns: [{ name: 'a', values: [1] }],
		plots: [{ type: 'histogram', inputs: { column: 'a' } }]
	});
	assert.equal(hist.errors.length, 0, hist.errors.join('; '));
	assert.deepEqual(hist.session.plots[0].plot.data[0].column, { refId: 0 });
	assert.equal(hist.session.plots[0].plot.data[0].x, undefined);
});

test('an unresolvable ref reports the PORT name the author used, not the storage name', () => {
	const { session, errors } = normalizeSession({
		columns: [{ name: 'hour', values: [0, 1] }],
		plots: [{ type: 'actogram', inputs: { time: 'hour', values: 'nope' } }]
	});
	assert.equal(session.plots.length, 0);
	assert.match(errors.join(' '), /actogram\.values: no column named "nope"/);
});

test('unknown plot type and unresolved plot refs are reported, not emitted', () => {
	const bogusType = normalizeSession({ plots: [{ type: 'nope', inputs: {} }] });
	assert.equal(bogusType.session.plots.length, 0);
	assert.match(bogusType.errors.join(' '), /Unknown plot type/);

	const badRef = normalizeSession({
		columns: [{ name: 'a', values: [1] }],
		plots: [{ type: 'scatterplot', inputs: { x: 'a', y: 'missing' } }]
	});
	assert.equal(badRef.session.plots.length, 0);
	assert.match(badRef.errors.join(' '), /missing/);
});

test('session skeleton has every slice the GUI importJson expects', () => {
	const { session } = normalizeSession({ columns: [{ name: 'x', values: [1] }] });
	for (const k of [
		'rawData', 'data', 'plots', 'tableProcesses', 'storedValues', 'chainRefs',
		'nodeNotes', 'notes', 'groups', 'composites', 'orphanProcesses', 'nodeLayout', 'version'
	]) {
		assert.ok(k in session, `missing slice ${k}`);
	}
	assert.ok(!('appState' in session)); // omitted on purpose → GUI keeps defaults
});

// A model asked for 100 phases emitted them as ONE run-together blob:
// values: ["00.20.40.60000000000000010.8…"]. That IS an array, which was the only thing checked,
// so a 400-character string landed in a column typed "number" and got plotted. Valid wiring,
// zero errors, total nonsense — the worst shape a failure can take.
test('a column of run-together numbers is rejected, not plotted', () => {
	// The real blob: 50 values from 0 to 9.8, run together, float artefacts and all.
	const blob = Array.from({ length: 50 }, (_, i) => i * 0.2).join('');
	const { session, errors } = normalizeSession({
		columns: [{ name: 'phase', type: 'number', values: [blob] }]
	});
	assert.equal(session.data.length, 0, 'garbage must not become a column');
	// Summarised, not echoed: a 400-character blob in an error message helps nobody.
	assert.match(errors[0], new RegExp(`values\\[0\\] is a ${blob.length}-character string`));
	assert.ok(errors[0].length < 500, 'the error must not BE the blob');
	// The message has to teach the fix: hand-typing is the cause, generators are the cure. It
	// reaches the MODEL via the repair round, which is what makes this self-correcting.
	assert.match(errors[0], /Random, SequenceColumn or SimulatedData/);
});

test('legitimate literal data still passes, blanks and all', () => {
	// The rejection must not cost a user who pasted real readings. Blanks are missing data.
	const { session, errors } = normalizeSession({
		columns: [
			{ name: 't', type: 'number', values: [0, 6, 12, null, 24] },
			{ name: 'iso', type: 'time', values: ['2026-07-17T00:00:00.000Z', '2026-07-17T01:00:00.000Z'] },
			{ name: 'label', type: 'category', values: ['wt', 'ko'] }
		]
	});
	assert.deepEqual(errors, []);
	assert.deepEqual(session.data.map((c) => c.name), ['t', 'iso', 'label']);
	assert.deepEqual(session.rawData[0], [0, 6, 12, null, 24]);
});

test('a non-number in a number column names the offending index', () => {
	const { errors } = normalizeSession({
		columns: [{ name: 'v', type: 'number', values: [1, 2, 'about three', 4] }]
	});
	assert.match(errors[0], /values\[2\] is "about three", not a number/);
});

// Names are the ONLY way a draft refers to a column, so a duplicate name doesn't just look
// untidy — it makes a column unreachable. Two Random nodes both produce `result`, the name index
// kept the first, and the second's column sat in the session with nothing able to point at it.
// Every "50 here, 50 there" request was unbuildable however good the draft.
test('same-named outputs are uniquified so every column stays referenceable', () => {
	const { session, errors } = normalizeSession({
		analyses: [
			{ name: 'Random', args: { N: 5, distribution: 'gaussian', offset: 0, multiply: 0.5, seed: 1 } },
			{ name: 'Random', args: { N: 5, distribution: 'gaussian', offset: 5, multiply: 0.5, seed: 2 } },
			{ name: 'Random', args: { N: 5, distribution: 'gaussian', offset: 1, multiply: 0, seed: 3 } }
		],
		plots: [
			{
				type: 'circularphase',
				series: [
					{ time: 'result', values: 'result_2' },
					{ time: 'result_1', values: 'result_2' }
				]
			}
		]
	});
	assert.deepEqual(errors, [], 'the second and third Random must be nameable');
	assert.deepEqual(session.data.map((c) => c.name), ['result', 'result_1', 'result_2']);
	// Each series points at a DIFFERENT phase column, sharing the constant one.
	const series = session.plots[0].plot.data;
	assert.deepEqual(series.map((s) => s.x.refId), [0, 1]);
	assert.deepEqual(series.map((s) => s.y.refId), [2, 2]);
});

test('uniquified generator columns still carry their own baked data', () => {
	// The names being distinct is worthless if they share values.
	const { session } = normalizeSession({
		analyses: [
			{ name: 'Random', args: { N: 40, distribution: 'gaussian', offset: 0, multiply: 0.5, seed: 1 } },
			{ name: 'Random', args: { N: 40, distribution: 'gaussian', offset: 5, multiply: 0.5, seed: 2 } }
		]
	});
	const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
	assert.ok(Math.abs(mean(session.rawData[0]) - 0) < 0.3, 'first is centred on 0');
	assert.ok(Math.abs(mean(session.rawData[1]) - 5) < 0.3, 'second is centred on 5');
});

test('a gaussian with multiply:0 is the way to make a constant column', () => {
	// The only route to a column of 1s: SequenceColumn's step:0 yields nothing. USAGE_NOTES
	// promises this, so it has to be true.
	const { session } = normalizeSession({
		analyses: [{ name: 'Random', args: { N: 6, distribution: 'gaussian', offset: 1, multiply: 0, seed: 1 } }]
	});
	assert.deepEqual(session.rawData[0], [1, 1, 1, 1, 1, 1]);
});
