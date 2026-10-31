// Warm-up gate for the MCP server's engine load.
//
// Loading AnCiR's node registry compiles every Svelte module through vite-node. Warm, that
// takes a few seconds; on the first start after an update it can take a minute or two, and
// MCP clients commonly give up on `initialize` after 60 s. So the server answers the protocol
// handshake (initialize, tools/list) straight away from the static catalogue and loads the
// engine in the background. Tool calls that arrive while it is still loading go through this
// gate: they WAIT for the engine (sending progress notifications when the client asked for
// them), and if it is still not ready after `waitMs` they return the friendly warming message
// as an error result, which the agent can read and retry. The wait stays below the 60 s
// default request timeout of the MCP SDK clients, so the caller gets the message rather than
// a timeout.
//
// Pure (no engine or SDK imports), so it is unit tested directly (test/warmup.test.js).

/** David's wording; shown to tool callers, logged to the client and printed to stderr. */
export const WARMING_MESSAGE =
	'Just warming up the bots (first start after an update takes a minute or two). Try again shortly.';

/** Default longest a tool call waits for the engine before returning WARMING_MESSAGE. */
export const DEFAULT_WAIT_MS = 25_000;
/** Default spacing of progress notifications while a call waits. */
export const DEFAULT_PROGRESS_MS = 2_000;

/** Seconds since `t0`, one decimal, for the messages. */
const secondsSince = (t0, now) => Math.round((now() - t0) / 100) / 10;

/**
 * @param {object} [opts]
 * @param {number} [opts.waitMs]      longest a gated call waits for the engine
 * @param {number} [opts.progressMs]  progress-notification spacing while waiting
 * @param {() => number} [opts.now]   clock (tests)
 */
export function createWarmup({
	waitMs = DEFAULT_WAIT_MS,
	progressMs = DEFAULT_PROGRESS_MS,
	now = Date.now
} = {}) {
	let state = 'idle'; // idle | loading | ready | failed
	let error = null;
	let startedAt = null;
	let readyMs = null;
	let done = null; // promise that settles (never rejects) when loading ends

	/**
	 * Run the loader once. Resolves with the loader's value; rejects with its error (the caller
	 * decides whether that is fatal). Gated calls see the failure as an error result.
	 */
	function start(loader) {
		if (state !== 'idle') throw new Error('warm-up already started');
		state = 'loading';
		startedAt = now();
		const run = Promise.resolve().then(loader);
		done = run.then(
			() => {
				state = 'ready';
				readyMs = now() - startedAt;
			},
			(e) => {
				state = 'failed';
				error = e;
			}
		);
		return run;
	}

	/** The result a gated call returns while the engine is not usable. */
	function notReadyResult() {
		if (state === 'failed') {
			return {
				content: [
					{
						type: 'text',
						text: `The AnCiR engine failed to load, so this tool cannot run: ${error?.message || error}. Restart the MCP server; the server's stderr has the detail.`
					}
				],
				isError: true
			};
		}
		const s = startedAt == null ? 0 : secondsSince(startedAt, now);
		return {
			content: [{ type: 'text', text: `${WARMING_MESSAGE} (still loading after ${s} s)` }],
			isError: true
		};
	}

	/**
	 * Wait (up to `waitMs`) for the engine. Calls `onProgress(seconds)` every `progressMs`
	 * while waiting. Resolves true when ready, false otherwise (still loading or failed).
	 */
	async function whenReady({ onProgress } = {}) {
		if (state === 'ready') return true;
		if (state !== 'loading') return false;
		let timer = null;
		let ticker = null;
		const timedOut = new Promise((ok) => {
			timer = setTimeout(ok, waitMs);
		});
		if (onProgress) {
			ticker = setInterval(() => {
				Promise.resolve(onProgress(secondsSince(startedAt, now))).catch(() => {});
			}, progressMs);
		}
		try {
			await Promise.race([done, timedOut]);
		} finally {
			clearTimeout(timer);
			if (ticker) clearInterval(ticker);
		}
		return state === 'ready';
	}

	/**
	 * Wrap an MCP tool handler `(args, extra) => result`. Ready: runs it. Loading: waits, with
	 * progress notifications when the request carried a progressToken, then runs it or returns
	 * the warming message. Failed: returns the failure as an error result.
	 */
	function gate(handler) {
		return async (args, extra) => {
			if (state !== 'ready') {
				const token = extra?._meta?.progressToken;
				const onProgress =
					token !== undefined && extra?.sendNotification
						? (seconds) =>
								extra.sendNotification({
									method: 'notifications/progress',
									params: { progressToken: token, progress: seconds, message: WARMING_MESSAGE }
								})
						: undefined;
				if (!(await whenReady({ onProgress }))) return notReadyResult();
			}
			return handler(args, extra);
		};
	}

	return {
		start,
		gate,
		whenReady,
		get state() {
			return state;
		},
		get error() {
			return error;
		},
		/** Milliseconds the load took, once ready. */
		get readyMs() {
			return readyMs;
		},
		/** Settles (never rejects) when loading ends. */
		get done() {
			return done;
		}
	};
}

/**
 * Was the last load of THIS version recorded? The server keeps a small stamp in the vite cache
 * dir after each successful load; no stamp, or one from another version, means the first start
 * after an update (or after the cache was cleared), the slow case worth announcing up front.
 *
 * @param {string|null} stampText  the stamp file's text, or null when absent
 * @param {string} version         the running version key
 */
export function isColdStart(stampText, version) {
	if (!stampText) return true;
	try {
		return JSON.parse(stampText).version !== version;
	} catch {
		return true;
	}
}
