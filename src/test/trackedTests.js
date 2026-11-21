// A test that times out is abandoned by Vitest, not stopped: its body keeps running while the
// next test starts. In a file whose tests share the app (one `core`, one mounted tree, and
// importJson's one-load-at-a-time lock), the abandoned body then fails the tests after it
// ("Another session is still loading", a control panel that another test just unmounted), so
// one slow test reads as a dozen broken ones.
//
// trackedTests() returns an `it` (with `.each`) that records the running body, and `settled()`,
// which waits for it. Await settled() FIRST in the file's afterEach, before any cleanup, and
// give that afterEach a timeout as long as the tests', so each test only ever starts after the
// previous one has really ended and a slow test can only fail itself:
//
//   const { it, settled } = trackedTests();
//   afterEach(async () => { await settled(); cleanup(); }, 60_000);
import { it as vitestIt } from 'vitest';

export function trackedTests() {
	let running = null;
	const track = (fn) =>
		function (...args) {
			const body = Promise.resolve().then(() => fn.apply(this, args));
			running = body;
			return body;
		};
	const it = (name, fn, options) => vitestIt(name, track(fn), options);
	it.each = (table) => (name, fn, options) => vitestIt.each(table)(name, track(fn), options);
	async function settled() {
		const body = running;
		running = null;
		await body?.catch(() => {});
	}
	return { it, settled };
}
