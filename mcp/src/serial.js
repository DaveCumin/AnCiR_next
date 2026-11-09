// One engine call at a time. The engine's store is a process singleton, so two calls that
// overlap can corrupt each other: a create_session that ran while a run_table_process was still
// awaiting emptied the store and restarted the id counters, and the run then wrote its outputs
// over the new session's columns. The MCP server's tool gate and the per-session worker's
// message loop both run every call through one of these queues, so a call starts only once the
// previous one has settled (a failure does not block the next).

/** @returns {<T>(fn: () => T | Promise<T>) => Promise<T>} run `fn` after every earlier call settles */
export function createSerialQueue() {
	let tail = Promise.resolve();
	return (fn) => {
		const run = tail.then(() => fn());
		tail = run.then(
			() => {},
			() => {}
		);
		return run;
	};
}
