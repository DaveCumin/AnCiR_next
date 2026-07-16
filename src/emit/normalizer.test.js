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

test('generator emits empty outputs (GUI regenerates on load)', () => {
	const { session, errors } = normalizeSession({
		analyses: [{ name: 'SimulatedData', args: {} }]
	});
	assert.equal(errors.length, 0, errors.join('; '));
	const sim = findTP(session, 'SimulatedData');
	assert.ok('time' in sim.args.out && 'values' in sim.args.out);
	assert.equal(colById(session, sim.args.out.time).type, 'time');
	assert.deepEqual(session.rawData[sim.args.out.values], []);
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

test('runtime-dynamic node (Split) emits fixed outputs only + a warning', () => {
	const { session, warnings } = normalizeSession({
		columns: [{ name: 't', values: [0, 1, 2] }, { name: 'y', values: [1, 2, 3] }],
		analyses: [{ name: 'Split', args: { xIN: 't', yIN: ['y'] } }]
	});
	assert.ok(session.tableProcesses.find((t) => t.name === 'Split'), 'node is still emitted');
	assert.match(warnings.join(' '), /dynamic outputs are not pre-allocated/);
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
