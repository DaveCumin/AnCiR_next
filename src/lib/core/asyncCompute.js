// @ts-check
// One guard for a node's deferred or async compute (ROB-11).
//
// THE PROBLEM
//
// Every analysis node that computes off the effect (a setTimeout so the spinner paints,
// an `await` on a worker task, or both) hand-rolled the same few lines:
//
//     calculating = true;
//     const token = ++_calcToken;
//     setTimeout(async () => {
//         const [data, valid] = await compute(p.args);
//         if (token !== _calcToken) return;
//         result = data; calculating = false; memo.hash = getHash;
//     }, 0);
//
// with no try/finally. When `compute` threw (a bad parameter, a worker error, an
// allocation failure on a huge period grid), `calculating` stayed true, so the node
// spun forever over the PREVIOUS result, which was still on the panel and in the output
// columns. And most nodes claim the memo hash in their effect BEFORE starting (so a second
// mounted instance does not run the same compute), which meant the failed hash stayed
// claimed: a remount, or putting the same inputs back, never tried again.
//
// THE RULE
//
//   - `busy` is cleared in a finally, whatever happens (for the run that is current).
//   - the memo hash is committed only on success, and a claim on the failed hash is
//     released, so a remount or a Retry recomputes.
//   - a failure is reported as a message the node shows, and the node's `onError`
//     clears its stale result (and usually its output columns, see clearOutputColumns).
//   - a superseded run (a newer `run` started, or `cancel`) does nothing at all: no
//     commit, no error, no busy change.
//
// USAGE (in a node component)
//
//     let calculating = $state(false);
//     let calcError = $state(null);
//     const runner = createComputeRunner({
//         memo,                                  // nodeMemo(p, 'tableprocess'), optional
//         node: p,                               // optional: the failure also goes on p.warnings
//         label: 'Rhythmicity',                 // for the console
//         setBusy: (v) => (calculating = v),
//         setError: (msg) => (calcError = msg)
//     });
//     function recompute() {
//         const hash = untrack(() => getHash);
//         runner.run(hash, () => untrack(() => analyse(p.args)), ([data, valid]) => {
//             result = data;
//             p.args.valid = valid;
//         }, () => {
//             result = undefined;
//             p.args.valid = false;
//             clearOutputColumns(p.args.out);
//         });
//     }
//
// and in the markup, next to the spinner:
//
//     {#if calculating}<LoadingSpinner />
//     {:else if calcError}
//         <ErrorBox title="The analysis failed." message={calcError} onretry={recompute} />
//     {:else} ...results...
//
// With `node`, the failure is also added to `node.warnings` ("The analysis failed: ..."),
// which the canvas node card and the collapsed square show as a warning even while the
// editor panel is closed. It is removed again when the next run starts (a node that
// rewrites `p.warnings` on success replaces it anyway).

// Errors that only a mistake in the code can raise ("y is not iterable", "Cannot read
// properties of undefined"). Shown raw they read like a complaint about the user's data;
// worker errors keep their name across the thread (workerPool.js taskError).
const PROGRAMMING_ERRORS = new Set(['TypeError', 'ReferenceError']);

/** The message for an internal error: what it means for the user first, the detail last. */
export function internalErrorMessage(detail) {
	return (
		'An internal error in AnCiR stopped this calculation; it is not a problem with your data. ' +
		'Please report it, with the session file if you can. ' +
		`(Detail: ${detail})`
	);
}

/**
 * A short, human-readable message for a thrown value. An internal error (a TypeError or
 * ReferenceError) is explained as a bug rather than shown as a bare JavaScript message.
 * @param {unknown} e
 * @returns {string}
 */
export function computeErrorMessage(e) {
	if (e == null) return 'Unknown error';
	if (typeof e === 'string') return e || 'Unknown error';
	if (e instanceof Error) {
		const raw = e.message || e.name || 'Unknown error';
		return PROGRAMMING_ERRORS.has(e.name) ? internalErrorMessage(raw) : raw;
	}
	const m = /** @type {any} */ (e)?.message;
	if (typeof m === 'string' && m) return m;
	try {
		return String(e);
	} catch {
		return 'Unknown error';
	}
}

/**
 * @typedef {'ok'|'error'|'stale'} RunOutcome
 *
 * @typedef {object} ComputeRunner
 * @property {<T>(hash: string|null|undefined, work: () => T|Promise<T>, commit: (value: T) => void, onError?: (e: unknown) => void) => Promise<RunOutcome>} run
 *   Start a compute for `hash`. Supersedes any run in flight. Resolves once the run has
 *   settled (never rejects).
 * @property {() => void} cancel  Supersede the run in flight without starting another.
 * @property {() => boolean} running  True while a current run has not settled.
 */

/** The warning text a failed run adds to `node.warnings`. */
export function failureWarning(message) {
	return `The analysis failed: ${message}`;
}

/**
 * @param {object} [opts]
 * @param {{hash: string}|null} [opts.memo] the node's nodeMemo handle; its hash is set on
 *   success and a claim on the failed hash is released
 * @param {{warnings?: string[]}|null} [opts.node] the node (TableProcess); a failure is
 *   also listed in its `warnings`
 * @param {string} [opts.label] names the node in the console
 * @param {(busy: boolean) => void} [opts.setBusy]
 * @param {(message: string|null) => void} [opts.setError] null clears the error (at the
 *   start of each run and on success)
 * @param {boolean} [opts.defer=true] start the work from a setTimeout(0), so a spinner
 *   paints first (what every node did by hand)
 * @returns {ComputeRunner}
 */
export function createComputeRunner({
	memo = null,
	node = null,
	label = 'compute',
	setBusy = () => {},
	setError = () => {},
	defer = true
} = {}) {
	let token = 0;
	let inFlight = false;
	/** The warning this runner last put on `node.warnings`, so it can take exactly that back. */
	let posted = null;

	function retractWarning() {
		if (!node || posted == null) return;
		const list = Array.isArray(node.warnings) ? node.warnings : [];
		if (list.includes(posted)) node.warnings = list.filter((w) => w !== posted);
		posted = null;
	}
	function postWarning(message) {
		if (!node) return;
		retractWarning();
		posted = failureWarning(message);
		const list = Array.isArray(node.warnings) ? node.warnings : [];
		node.warnings = [...list, posted];
	}

	/**
	 * @template T
	 * @param {number} my
	 * @param {string|null|undefined} hash
	 * @param {() => T|Promise<T>} work
	 * @param {(value: T) => void} commit
	 * @param {((e: unknown) => void)|undefined} onError
	 * @returns {Promise<RunOutcome>}
	 */
	async function exec(my, hash, work, commit, onError) {
		const current = () => my === token;
		try {
			const value = await work();
			if (!current()) return 'stale';
			commit(value);
			if (memo && hash != null) memo.hash = hash;
			setError(null);
			return 'ok';
		} catch (e) {
			if (!current()) return 'stale';
			// Release the claim the node's effect made before starting, so the same inputs
			// are tried again on a remount or a Retry. Only OUR hash: a newer claim stays.
			if (memo && hash != null && memo.hash === hash) memo.hash = '';
			console.error(`[${label}] compute failed:`, e);
			const message = computeErrorMessage(e);
			setError(message);
			if (onError) {
				try {
					onError(e);
				} catch (cleanupErr) {
					console.error(`[${label}] clearing the failed result also failed:`, cleanupErr);
				}
			}
			// After onError, which may itself reset node.warnings.
			postWarning(message);
			return 'error';
		} finally {
			if (current()) {
				inFlight = false;
				setBusy(false);
			}
		}
	}

	return {
		run(hash, work, commit, onError) {
			const my = ++token;
			inFlight = true;
			setBusy(true);
			setError(null);
			retractWarning();
			if (!defer) return exec(my, hash, work, commit, onError);
			return new Promise((resolve) => {
				setTimeout(() => {
					if (my !== token) {
						resolve('stale');
						return;
					}
					exec(my, hash, work, commit, onError).then(resolve);
				}, 0);
			});
		},
		cancel() {
			token++;
			if (inFlight) {
				inFlight = false;
				setBusy(false);
			}
		},
		running() {
			return inFlight;
		}
	};
}
