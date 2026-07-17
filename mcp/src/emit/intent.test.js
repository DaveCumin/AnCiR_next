// node --test src/emit/intent.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreIntent, repairIsBetter, buildManifest } from './intent.js';

/** A normalised session, cut down to the fields intent.js reads. */
const session = (tps = [], plots = [], data = [{ id: 0 }]) => ({
	tableProcesses: tps.map((name) => ({ name })),
	plots: plots.map((type) => ({ type })),
	data
});

const INTENT = {
	goal: 'fit a 24 h rhythm and show it',
	deliverables: [
		{ kind: 'data', what: '14 days simulated' },
		{ kind: 'analysis', what: 'Cosinor' },
		{ kind: 'plot', what: 'actogram' }
	],
	assumptions: ['period not given; assumed 24 h']
};

test('scores each deliverable against what was actually built', () => {
	const s = scoreIntent(INTENT, session(['SimulatedData', 'Cosinor'], ['actogram']));
	assert.equal(s.met, 3);
	assert.equal(s.verifiable, 3);
	assert.deepEqual(
		s.deliverables.map((d) => d.met),
		[true, true, true]
	);
});

test('an unbuilt deliverable is caught even when the session is error-free', () => {
	// The whole point: this session normalises perfectly. Nothing downstream of the normalizer
	// can tell that the actogram the user asked for was never built.
	const s = scoreIntent(INTENT, session(['SimulatedData', 'Cosinor'], []));
	assert.equal(s.met, 2);
	assert.equal(s.verifiable, 3);
	assert.equal(s.deliverables.find((d) => d.what === 'actogram').met, false);
});

test('names are matched case-insensitively — the model writes "cosinor", the registry "Cosinor"', () => {
	const s = scoreIntent({ deliverables: [{ kind: 'analysis', what: ' cosinor ' }] }, session(['Cosinor']));
	assert.equal(s.met, 1);
});

test('an unknown kind is unverifiable, not failed', () => {
	// null ⇒ excluded from the score. Counting a claim we cannot check as a failure would make
	// every draft look broken; counting it as a pass would make the score a rubber stamp.
	const s = scoreIntent({ deliverables: [{ kind: 'vibes', what: 'nice' }] }, session(['Cosinor']));
	assert.equal(s.deliverables[0].met, null);
	assert.equal(s.verifiable, 0);
	assert.equal(s.met, 0);
});

test('no intent, or no deliverables, means NO OPINION rather than a zero', () => {
	// Must be distinguishable from a real 0/3: callers fall back on null, and a model that
	// promised nothing must not be blocked from repairing.
	assert.equal(scoreIntent(undefined, session()), null);
	assert.equal(scoreIntent({ goal: 'x' }, session()), null);
	assert.equal(scoreIntent({ deliverables: [] }, session()), null);
});

test('a model-controlled intent cannot flood a log line or a response', () => {
	const s = scoreIntent(
		{
			goal: 'g'.repeat(9999),
			deliverables: Array.from({ length: 500 }, () => ({ kind: 'plot', what: 'x'.repeat(999) })),
			assumptions: Array.from({ length: 500 }, () => 'a'.repeat(999))
		},
		session()
	);
	assert.equal(s.deliverables.length, 20);
	assert.equal(s.assumptions.length, 10);
	assert.ok(s.goal.length <= 300);
	assert.ok(s.deliverables[0].what.length <= 80);
});

test('a repair that fixes errors without losing coverage is kept', () => {
	const first = { errors: ['bad col'], session: session(['Cosinor']), score: null };
	const second = { errors: [], session: session(['Cosinor', 'Actogram']), score: null };
	first.score = scoreIntent(INTENT, first.session);
	second.score = scoreIntent(INTENT, second.session);
	assert.equal(repairIsBetter(first, second), true);
});

test('a repair that buys fewer errors by dropping a deliverable is REJECTED', () => {
	// The case node-counting cannot see: same number of analyses, but the Cosinor the user
	// asked for has been swapped for a Periodogram that happened to wire up cleanly.
	const first = { errors: ['bad col'], session: session(['SimulatedData', 'Cosinor'], ['actogram']) };
	const second = { errors: [], session: session(['SimulatedData', 'Periodogram'], ['actogram']) };
	first.score = scoreIntent(INTENT, first.session);
	second.score = scoreIntent(INTENT, second.session);

	assert.equal(second.session.tableProcesses.length, first.session.tableProcesses.length);
	assert.equal(repairIsBetter(first, second), false, 'the old node-count proxy would accept this');
});

test('a repair is never accepted for equal or greater errors', () => {
	const s = session(['Cosinor']);
	assert.equal(repairIsBetter({ errors: [], session: s, score: null }, { errors: [], session: s, score: null }), false);
	assert.equal(
		repairIsBetter({ errors: ['a'], session: s, score: null }, { errors: ['a', 'b'], session: s, score: null }),
		false
	);
});

test('with no intent, repair acceptance falls back to the node-count proxy', () => {
	const first = { errors: ['x'], session: session(['A', 'B']), score: null };
	assert.equal(repairIsBetter(first, { errors: [], session: session(['A', 'B']), score: null }), true);
	// Dropped a node ⇒ still rejected, even without a contract.
	assert.equal(repairIsBetter(first, { errors: [], session: session(['A']), score: null }), false);
});

test('the manifest leads with what is MISSING, and says so out loud', () => {
	const s = scoreIntent(INTENT, session(['SimulatedData', 'Cosinor'], []));
	const m = buildManifest(s, session(['SimulatedData', 'Cosinor'], []));
	assert.equal(m.complete, false);
	assert.deepEqual(m.missing, ['plot: actogram']);
	// The assumptions are the point of showing this to a user at all.
	assert.deepEqual(m.assumptions, ['period not given; assumed 24 h']);
	assert.deepEqual(m.built.analyses, ['SimulatedData', 'Cosinor']);
});

test('no stated intent ⇒ no manifest, rather than one we invented', () => {
	assert.equal(buildManifest(null, session(['Cosinor'])), null);
});
