// A compute memo that survives a component unmount, plus dev-only instrumentation.
//
// THE PROBLEM
//
// Every analysis node computes inside its own component's $effect, guarded by a
// hash of its inputs:
//
//     let lastHash = '';
//     $effect(() => { if (getHash !== lastHash) { recompute(); lastHash = getHash; } });
//
// `lastHash` is a plain `let` in the component, so it dies with the component.
// Switching between the workflow and workspace views is an `{#if}` in
// +page.svelte: it destroys one whole component tree and builds the other, and
// in the plots view NodeComputeHost deliberately mounts EVERY analysis node. So a
// view switch remounts the entire pipeline, every memo starts empty, and the
// whole session recomputes even though not one input changed.
//
// WHY NOT JUST PERSIST THE HASH
//
// Some nodes tried exactly that (`p.args._fitHash`) and had to give it up. Their
// stats panels — Cosinor's MESOR / amplitude / CIs, the fit nodes' R² and RMSE —
// live only in transient component state and are NOT saved with the session. A
// mount that skipped the fit because the persisted hash matched would leave the
// panel blank until something forced a recompute. Cosinor, FitFunction, TrendFit,
// RectangularWave and NonparametricRA all carry a comment saying so.
//
// That rules out seeding from a persisted hash. It does not rule out caching,
// which is what this module does: keep the hash AND the transient payload
// together, in memory, for the life of the session. A remount finds its own
// previous result and rehydrates the panel without recomputing. Nothing new is
// persisted, so a reopened session still computes once — correct, because the
// transient stats genuinely are not in the file.
//
// HOW A NODE USES IT
//
// Replace the declaration and leave the effect alone:
//
//     const memo = nodeMemo(p, 'tableprocess');   // instead of `let lastHash = ''`
//     $effect(() => { if (memo.hash !== getHash) { recompute(); memo.hash = getHash; } });
//
// `memo.hash` reads and writes the cache, so it is already populated on the
// second mount and the effect's own equality check does the skipping. Nodes that
// hold transient display state additionally store it (`memo.payload = data`) and
// restore it on mount.
//
// TWO INSTANCES AT ONCE
//
// The memo is keyed by node, not by component instance, and a node has two live
// instances whenever it is expanded on the canvas AND selected in the control
// panel. The guard above then lets the first instance to run claim the hash, and
// the second sees "already handled" and keeps its old panel. Fixed once, here,
// rather than per node: the payload is observable. Each instance follows it,
//
//     $effect(() => memo.follow(getHash, (cached) => { result = cached; }));
//
// and `apply` runs on every instance whose local state is behind, immediately
// when a payload for that hash is already cached (a remount rehydrating), and
// from a microtask when one is published later (the other instance finishing).
// The compute still runs once per hash; only the result fans out. The payload
// remembers the hash it was computed for, so a follower is never handed the
// previous hash's result while a new compute is in flight.
//
// A node whose compute is deferred (setTimeout, worker) claims the hash in its
// effect before starting; `has(hash)` is false until the result lands, which is
// what keeps a mount in that window from restoring stale data.
//
// SCOPE AND LIFETIME
//
// In memory only, cleared on session import because node ids are reused across
// sessions and a stale payload would be silently wrong. Keyed by node kind + id
// so table-processes and column-processes cannot collide.

import { untrack } from 'svelte';

/**
 * One node's entry. `payloadHash` is the hash `payload` was recorded under, so a
 * payload can be told apart from a hash that was merely claimed for a compute
 * still in flight. null until a payload is stored.
 * @typedef {{hash: string, payload: any, payloadHash: string|null}} Entry
 */
/** @type {Map<string, Entry>} */
const cache = new Map();

/**
 * Live followers per node: the mounted component instances waiting for a
 * payload. Deliberately NOT part of `cache`: memoClear/memoForget drop cached
 * results, but a follower belongs to a component that is still mounted and
 * unsubscribes itself on teardown.
 * @typedef {{hash: string, apply: (payload: any) => void, last: any}} Follower
 * @type {Map<string, Set<Follower>>}
 */
const followers = new Map();

/** "This follower has applied nothing yet". Not undefined or null: both are legal payloads. */
const NONE = Symbol('none');

const DEV = import.meta.env?.DEV ?? false;

/**
 * Node identity for the cache. `p` is a TableProcess or Process instance; both
 * number their ids from 1 independently, hence the kind prefix.
 * @returns {string|null} null when the node has no id, which must never share a bucket.
 */
function keyFor(p, kind) {
	if (p == null || p.id == null) return null;
	return `${kind}_${p.id}`;
}

/** @returns {Entry} */
function freshEntry() {
	return { hash: '', payload: null, payloadHash: null };
}

// Production always memoises. In dev this can be switched off from the console so
// a before/after measurement runs through identical instrumentation, rather than
// comparing two different builds:
//     await __computeMetrics.measure(() => appState.view = 'plots')
let memoEnabled = true;

/**
 * Hand every follower whose hash matches the published payload that payload,
 * from a microtask so `apply` never runs inside whichever effect published it
 * (a node's apply writes its own $state; running it inside another instance's
 * effect would make that effect depend on the reads). Re-checked at delivery:
 * the follower may have unsubscribed, or a newer payload may have superseded it.
 */
function publish(set, read) {
	for (const sub of set) {
		if (sub.hash !== read()?.payloadHash) continue;
		queueMicrotask(() => {
			if (!set.has(sub)) return;
			const e = read();
			if (!e || e.payloadHash !== sub.hash || e.payload === sub.last) return;
			sub.last = e.payload;
			sub.apply(e.payload);
		});
	}
}

/**
 * The per-node handle. `hash` is a drop-in replacement for the component-local
 * `lastHash`: same reads, same writes, but backed by a cache that outlives the
 * component.
 */
export function nodeMemo(p, kind) {
	const key = keyFor(p, kind);
	const label = DEV ? `${kind}:${p?.name ?? p?.displayName ?? '?'}` : '';
	// The unmemoised fallback. Used when the node has no id to key on, and when
	// memoisation is switched off for a measurement — in both cases this is a
	// plain per-instance entry, which is exactly the `let lastHash` it replaces.
	//
	// It must exist. An earlier version returned a constant '' whenever the cache
	// was unavailable, so the node could never record the hash it had just
	// handled: every compute wrote output columns, the input hash changed, and the
	// effect fired again forever. Reading back what was written is what terminates
	// the loop, cache or no cache.
	const local = freshEntry();
	const localFollowers = new Set();
	const usable = () => key != null && memoEnabled;
	/** Where reads come from: the shared entry (may not exist yet) or the local one. */
	const read = () => (usable() ? cache.get(key) : local);
	/**
	 * Where writes go. Always the local entry; also the shared one whenever the
	 * node has a key, memoised or not, so that switching memoisation back on
	 * finds what was written while it was off (the A/B measurement relies on it).
	 */
	const targets = () => {
		if (key == null) return [local];
		let shared = cache.get(key);
		if (!shared) cache.set(key, (shared = freshEntry()));
		return [local, shared];
	};
	const followerSet = () => {
		if (!usable()) return localFollowers;
		let set = followers.get(key);
		if (!set) followers.set(key, (set = new Set()));
		return set;
	};
	return {
		get hash() {
			return read()?.hash ?? '';
		},
		set hash(v) {
			// Count a compute only when this write actually CHANGES the recorded
			// hash. Two things would otherwise be counted as work that is not work.
			// Several nodes mark the hash twice for a single run (the effect claims
			// it before dispatching, the compute function records it on completion).
			// And the nodes with a bespoke mount-time load branch — Split,
			// SmoothedData, LongToWide, CollectColumns — re-pin the unchanged hash on
			// every mount to say "the baked data is still current"; comparing against
			// a per-instance variable made each of those remounts look like a
			// recompute, which is exactly the false positive this metric exists to
			// detect. Compare against what is stored, not against what this instance
			// happens to have seen.
			const prev = read()?.hash;
			if (DEV && v !== prev) countCompute(label);
			for (const e of targets()) e.hash = v;
		},
		/**
		 * Transient display state that would otherwise be lost on unmount. With
		 * memoisation off this is per-instance and therefore always undefined on a
		 * fresh mount, so an A/B measurement exercises the real recompute path.
		 */
		get payload() {
			const e = read();
			return e && e.payloadHash != null ? e.payload : undefined;
		},
		set payload(v) {
			// Recorded under the CURRENT hash: nodes set the hash first (in the
			// effect that claims the compute, or just before storing the result).
			// Re-storing the same object under the same hash is not a publication;
			// a follower that has just applied a payload mirrors it straight back.
			const cur = read();
			if (cur && cur.payloadHash === cur.hash && cur.payload === v) return;
			for (const e of targets()) {
				e.payload = v;
				e.payloadHash = e.hash;
			}
			publish(followerSet(), read);
		},
		/** True when a payload computed for exactly `hash` is cached. */
		has(hash) {
			const e = read();
			return !!e && e.hash === hash && e.payloadHash === hash;
		},
		/**
		 * Keep this component instance's local state in step with the shared
		 * payload for `hash`: `apply` runs now if that payload is already cached,
		 * and again (from a microtask) each time a payload for `hash` is
		 * published. Call from a $effect that reads the node's hash and return
		 * the unsubscribe as the effect's teardown; the effect then re-follows
		 * on every hash change.
		 * @returns {() => void} unsubscribe
		 */
		follow(hash, apply) {
			/** @type {Follower} */
			const sub = { hash, apply, last: NONE };
			const set = followerSet();
			set.add(sub);
			const e = read();
			if (e && e.hash === hash && e.payloadHash === hash) {
				sub.last = e.payload;
				untrack(() => apply(e.payload));
			}
			return () => set.delete(sub);
		}
	};
}

/**
 * The mount-time decision for a node that computes in `onMount` as well as in its
 * $effect: rehydrate the previous result, or do the work.
 *
 * These nodes keep their whole result in transient component state (`result`,
 * `comparisonData`, `rayleighData`), so they could not simply skip a recompute —
 * the panel would come back blank. Handing them back the cached payload is what
 * makes skipping safe.
 *
 * @param memo     the node's handle from nodeMemo()
 * @param hash     the node's current input hash
 * @param restore  called with the cached payload when the work can be skipped
 * @param compute  called to do the work otherwise
 * @returns true if it computed, false if it restored. Mostly for tests.
 */
export function restoreOrCompute(memo, hash, restore, compute) {
	// A payload recorded under this exact hash. A hash that was only claimed (a
	// compute still in flight elsewhere) is not a hit; nor is the previous
	// hash's payload. A node whose result is legitimately null still stores
	// null, and null is a hit.
	if (memo.has(hash)) {
		restore(memo.payload);
		return false;
	}
	compute();
	return true;
}

/** Drop one node's entry (node deleted, or an invalidating rewire). */
export function memoForget(p, kind) {
	const key = keyFor(p, kind);
	if (key != null) cache.delete(key);
}

/** Drop everything. Called on session import; node ids are reused across sessions. */
export function memoClear() {
	cache.clear();
}

/** Test seam. */
export function _memoSize() {
	return cache.size;
}

/** Test seam: force the A/B switch. */
export function _setMemoEnabled(v) {
	memoEnabled = v;
}

/** Test seam: total computes counted since the last reset. DEV builds only. */
export function _computeCount() {
	return [...computeCounts.values()].reduce((n, c) => n + c, 0);
}

/** Test seam: clear the counter. */
export function _resetComputeCount() {
	computeCounts.clear();
}

// --- Dev-only instrumentation ----------------------------------------------
// `DEV` is a compile-time constant, so every `if (DEV)` block is dead code that
// Rollup strips from the production bundle.

/** @type {Map<string, number>} */
const computeCounts = new Map();
let lastComputeAt = 0;

function countCompute(label) {
	computeCounts.set(label, (computeCounts.get(label) ?? 0) + 1);
	lastComputeAt = performance.now();
}

if (DEV && typeof window !== 'undefined') {
	/**
	 * Time an action and count the recomputes it triggers.
	 *
	 * Counting alone is not enough — most node computes are async (`setTimeout`,
	 * `await`), so the action returns long before the work finishes. This waits
	 * until no new compute has started for `quietMs`, which is what makes the
	 * wall-clock figure mean "until the app went quiet" rather than "until the
	 * function returned".
	 */
	async function measure(action, { quietMs = 400, timeoutMs = 60000 } = {}) {
		computeCounts.clear();
		const t0 = performance.now();
		lastComputeAt = t0;
		await action();
		while (performance.now() - lastComputeAt < quietMs) {
			if (performance.now() - t0 > timeoutMs) break;
			await new Promise((r) => setTimeout(r, 50));
		}
		const rows = [...computeCounts.entries()]
			.map(([node, computes]) => ({ node, computes }))
			.sort((a, b) => b.computes - a.computes);
		const total = rows.reduce((n, r) => n + r.computes, 0);
		// Subtract the trailing quiet period: it is the detector's settling time,
		// not time the app spent working.
		const wallMs = Math.round(Math.max(0, lastComputeAt - t0));
		// eslint-disable-next-line no-console
		if (rows.length) console.table(rows);
		return { memo: memoEnabled ? 'ON' : 'OFF', computes: total, wallMs, rows };
	}

	window.__computeMetrics = {
		measure,
		/** Turn memoisation on or off, to measure the same action both ways. */
		memo(on) {
			memoEnabled = !!on;
			return `memo ${memoEnabled ? 'ON' : 'OFF'}`;
		},
		/** Run the same action with memo off, then on, and report both. */
		async compare(action, opts) {
			memoEnabled = false;
			const before = await measure(action, opts);
			memoEnabled = false;
			await measure(action, opts); // return to the starting view, still unmemoised
			memoEnabled = true;
			await measure(action, opts); // warm the cache
			await measure(action, opts); // back again, cache now warm
			const after = await measure(action, opts);
			return { before, after };
		},
		cacheSize: () => cache.size,
		clear: memoClear
	};
}
