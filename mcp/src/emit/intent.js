// The model's own account of what it set out to build, checked against what it actually built.
//
// WHY THIS EXISTS
//
// The normalizer answers "is this session wired correctly?". It cannot answer "is this the
// session the user asked for?", because it has never seen the request — by the time a draft
// reaches it, the prompt is gone and only column names remain. So a draft that quietly builds
// four of the five things asked for normalises perfectly, with zero errors, and nobody notices.
//
// That gap bit us in the repair round. The acceptance test for a repair was "fewer errors, and
// no fewer analyses" — a proxy, and a weak one: node COUNT can hold steady while the repair
// swaps the analysis the user wanted for one that merely wires up. Counting nodes cannot tell
// a Cosinor from a Periodogram.
//
// The fix is to make the model state its goal in the SAME reply as the draft (no extra call, no
// extra round-trip, a handful of tokens), and to make that statement CHECKABLE. Prose can't be
// checked, so deliverables are structured — {kind, what} — and everything here is a mechanical
// lookup against the normalised session. The prose parts (goal, assumptions) are for the user's
// manifest, and are never scored.
//
// Pure and dependency-free, like the normalizer, so it runs in the Worker.

/** Case/space-insensitive compare — the model writes "cosinor", the registry says "Cosinor". */
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/**
 * Was one deliverable actually built?
 *
 * @returns {boolean|null} null ⇒ UNVERIFIABLE (a kind we have no mechanical check for). Null is
 * not failure: an unverifiable claim is excluded from the score rather than counted against the
 * draft, because guessing would make the score a liar in both directions.
 */
function isMet(deliverable, session) {
	const what = deliverable?.what;
	switch (deliverable?.kind) {
		case 'analysis':
			return (session.tableProcesses ?? []).some((t) => same(t.name, what));
		case 'plot':
			return (session.plots ?? []).some((p) => same(p.type, what));
		case 'data':
			// "there is input data" — either literal columns or a generator that makes some.
			return (session.data ?? []).length > 0;
		default:
			return null;
	}
}

/**
 * Score a draft's stated intent against the session it produced.
 *
 * @param {object|null|undefined} intent the draft's `intent` field, if it emitted one
 * @param {object} session a normalised session
 * @returns {{goal:string, assumptions:string[], deliverables:Array<{kind:string,what:string,met:boolean|null}>, met:number, verifiable:number}|null}
 *   null when there is no usable contract (no intent, or no deliverables). Null means "no
 *   opinion" — callers must fall back rather than treat it as a zero score.
 */
export function scoreIntent(intent, session) {
	const listed = Array.isArray(intent?.deliverables) ? intent.deliverables : [];
	// A model that emitted no deliverables has made no promises. We don't invent any for it:
	// an empty contract scored as 0/0 would fail every comparison and block every repair.
	if (!listed.length) return null;

	const deliverables = listed
		// Cap the list: it's model-controlled, and it ends up in a response and a log line.
		.slice(0, 20)
		.map((d) => ({
			kind: String(d?.kind ?? 'other'),
			what: String(d?.what ?? '').slice(0, 80),
			met: isMet(d, session)
		}));

	const verifiable = deliverables.filter((d) => d.met !== null);
	return {
		goal: String(intent.goal ?? '').slice(0, 300),
		assumptions: (Array.isArray(intent.assumptions) ? intent.assumptions : [])
			.slice(0, 10)
			.map((a) => String(a).slice(0, 200)),
		deliverables,
		met: verifiable.filter((d) => d.met).length,
		verifiable: verifiable.length
	};
}

/**
 * Is the repaired attempt better than the first one?
 *
 * Note WHICH intent is passed in: the FIRST draft's. The repair is scored against the ORIGINAL
 * contract, never against its own self-report, or the goalposts move — a model that drops the
 * periodogram it couldn't wire and also drops it from its deliverables would otherwise score a
 * clean 100% for building less than it was asked for.
 *
 * @param {object} first  {errors, session, score} the first attempt (score may be null)
 * @param {object} second {errors, session, score} the repair, scored against the FIRST intent
 * @returns {boolean}
 */
export function repairIsBetter(first, second) {
	// Non-negotiable: a repair exists to fix errors. Never accept one that doesn't.
	if (!(second.errors.length < first.errors.length)) return false;

	// With a contract, coverage decides: fixing a wiring error by silently dropping a requested
	// analysis is not a fix, and this is the check that can see that.
	// Both are scored against the SAME deliverable list, so the met counts are comparable.
	if (first.score && second.score) return second.score.met >= first.score.met;

	// No contract (an older model, or one that ignored the field) ⇒ fall back to the node-count
	// proxy. Weaker, but it still catches the worst case, and a missing intent must not make
	// repairs impossible.
	return second.session.tableProcesses.length >= first.session.tableProcesses.length;
}

/**
 * What was built, in a form a person can audit without reading the node graph.
 *
 * The Worker's reply was a URL, warnings and errors: enough to know something went wrong, never
 * enough to know whether it went RIGHT. A user who asked for five things and got four had to
 * reverse-engineer the graph to notice. This states the goal, the assumptions (the interesting
 * part — everything the model decided for them without being told), and which deliverables
 * actually landed.
 *
 * @param {object|null} score  from scoreIntent
 * @param {object} session
 * @returns {object|null} null when the model stated no intent — no manifest is better than one
 *   we made up by summarising the graph back at the user.
 */
export function buildManifest(score, session) {
	if (!score) return null;
	const missing = score.deliverables.filter((d) => d.met === false);
	return {
		goal: score.goal,
		assumptions: score.assumptions,
		built: {
			analyses: (session.tableProcesses ?? []).map((t) => t.name),
			plots: (session.plots ?? []).map((p) => p.type)
		},
		deliverables: score.deliverables,
		// The headline: stated in the negative, because "4 of 5" is the sentence worth reading.
		missing: missing.map((d) => `${d.kind}: ${d.what}`),
		complete: missing.length === 0
	};
}
