// Provenance stamped into `session.generatedBy`, beside the version.
//
// Its own module because BOTH routes stamp it (/build and /mcp) and index.js already imports
// mcp.js — putting it in either would make the imports circular.

/**
 * The point is traceability: when someone reports "the AI built me a broken session", the
 * session they send back carries `sessionId`, which joins straight to the log line that made it
 * (prompt, model, outcome). Without it, a session is anonymous the moment it leaves here.
 *
 * `model` is deliberately absent on the /mcp route rather than guessed: there, the calling agent
 * IS the model and never tells us what it is, and a wrong fingerprint is worse than none.
 * Nothing identifying the USER goes in — no key, no IP, no prompt. The prompt stays in the log,
 * which is ours; the session travels.
 *
 * @param {'build'|'mcp'} route
 * @param {string} sessionId  the same id the session is stored under and logged with
 * @param {{model?: string}} [extra]
 */
export function fingerprint(route, sessionId, { model } = {}) {
	return {
		source: 'ancir-nl',
		route,
		sessionId,
		...(model ? { model } : {}),
		generatedAt: new Date().toISOString()
	};
}
