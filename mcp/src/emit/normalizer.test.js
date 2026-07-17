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
