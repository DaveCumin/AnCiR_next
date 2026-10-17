// One registry entry per stored value, however many places render its button.
//
// A node's results panel is mounted more than once at a time: the canvas node
// and the control panel each mount the node component (and so each of its
// StoreValueButtons). Before this module every mounted button registered its
// own entry, so opening a Cosinor in the control panel added a second copy of
// every value under a `_2` name (removed again on close, and saved if the panel
// was open at save time). Formulas could pick the copy and lose it when the
// panel closed.
//
// Identity is the IDENTITY KEY `<owner>|<default name>`: the owner is the node
// or plot the button belongs to (provided by the node component through
// `provideStoredValueOwner`), the default name is the button's own default. Every
// button with the same key is a HOLDER of one entry; the entry stays while any
// holder is mounted and reads the first holder's getter. The key is saved with
// the entry, so a reloaded session's snapshot is claimed by exactly its button,
// whatever name the user has since given it.
//
// A button with no owner (rendered outside a node component, e.g. a unit test)
// gets an anonymous key of its own, so it behaves as a sole holder (the
// pre-claims behaviour); anonymous keys are never saved.

import { getContext, setContext } from 'svelte';
import { core, uniqueStoredValueName, propagateStoredValueRename } from './core.svelte.js';

const OWNER_CONTEXT = Symbol('storedValueOwner');

/**
 * Called once at the top of a node / plot component: every StoreValueButton it
 * renders (including inside snippets) registers under this owner. The id is read
 * when each button mounts.
 * @param {'tp'|'plot'} kind
 * @param {() => number|string|null|undefined} getId e.g. `() => p?.id`
 */
export function provideStoredValueOwner(kind, getId) {
	setContext(OWNER_CONTEXT, () => {
		const id = getId();
		return id == null || id === '' ? null : `${kind}:${id}`;
	});
}

/** The owner provided by the enclosing node component, or null. Component init only. */
export function storedValueOwner() {
	const g = getContext(OWNER_CONTEXT);
	return typeof g === 'function' ? (g() ?? null) : null;
}

let anonCounter = 0;
/** The identity key for a button: `<owner>|<base>`, or a fresh anonymous key. */
export function storedValueKey(owner, base) {
	return owner ? `${owner}|${base}` : `anon:${++anonCounter}`;
}

/** Anonymous keys identify one mounted button only; they are never saved. */
export function isPersistentStoredValueKey(key) {
	return typeof key === 'string' && key !== '' && !key.startsWith('anon:');
}

/** key -> Map(token -> { getter, source }); insertion order, first = active. */
const holders = new Map();
/** key -> last known name (verified on every read; renames move the entry). */
const nameCache = new Map();

/**
 * The current name of the entry with this identity key, or null. Inside a
 * $derived it depends on that one entry while the cached name is right, and on
 * the whole registry only when it has to search (after a rename).
 */
export function storedValueNameForKey(key) {
	if (!key) return null;
	const cached = nameCache.get(key);
	if (cached != null && core.storedValues[cached]?.key === key) return cached;
	for (const [name, entry] of Object.entries(core.storedValues)) {
		if (entry?.key === key) {
			nameCache.set(key, name);
			return name;
		}
	}
	return null;
}

const isStaticLeftover = (e) => !!e && typeof e.getter !== 'function' && !e.ref;
const family = (source) => String(source ?? '').split(/[\s(]/)[0];
const sameSnapshot = (a, b) => typeof a === 'number' && Number.isFinite(a) && a === b;

/**
 * A legacy session (saved before identity keys) saved with the control panel
 * open carries the panel's copy of each value as `<base>_N`: same node family,
 * same value. Once the base snapshot has been claimed, fold those copies into
 * it (formula references follow), so re-saving drops them. A value of the same
 * name from a different node only folds in if its snapshot is identical, which
 * is the case it would also be indistinguishable in.
 */
function absorbLegacyCopies(name, base, claimed) {
	for (let n = 2; `${base}_${n}` in core.storedValues; n++) {
		const dup = `${base}_${n}`;
		if (dup === name) continue;
		const e = core.storedValues[dup];
		if (!isStaticLeftover(e) || e.key) continue;
		if (family(e.source) !== family(claimed.source)) continue;
		if (!sameSnapshot(e.staticValue, claimed.staticValue)) continue;
		delete core.storedValues[dup];
		propagateStoredValueRename(dup, name);
	}
}

/**
 * Register a holder for `key`. Joins the live entry when there is one;
 * otherwise takes over this key's restored snapshot, then (legacy sessions) a
 * keyless snapshot of the default name, and only then creates a new name.
 * @returns {string} the entry's name
 */
export function claimStoredValue({ key, base, getter, source = '', token }) {
	let hs = holders.get(key);
	if (!hs) holders.set(key, (hs = new Map()));
	hs.set(token, { getter, source });
	const persistent = isPersistentStoredValueKey(key);
	const keyed = (extra = {}) => ({ getter, source, ...(persistent ? { key } : {}), ...extra });

	const existing = storedValueNameForKey(key);
	if (existing != null) {
		const e = core.storedValues[existing];
		// A saved snapshot of this very key: bring it back to life.
		if (typeof e.getter !== 'function') core.storedValues[existing] = keyed();
		return existing;
	}

	// Legacy snapshot of the default name (keyless: written before identity keys,
	// or by a button without an owner). Never another owner's keyed entry, never
	// a metric-port ref, never a live getter.
	const claimable = (e) => isStaticLeftover(e) && (!persistent || !e.key);
	let name = null;
	if (claimable(core.storedValues[base])) name = base;
	else if (base in core.storedValues) {
		for (let n = 2; `${base}_${n}` in core.storedValues; n++) {
			if (claimable(core.storedValues[`${base}_${n}`])) {
				name = `${base}_${n}`;
				break;
			}
		}
	}
	if (name != null) {
		const claimed = core.storedValues[name];
		core.storedValues[name] = keyed();
		if (persistent) absorbLegacyCopies(name, base, claimed);
	} else {
		name = uniqueStoredValueName(base);
		core.storedValues[name] = keyed();
	}
	nameCache.set(key, name);
	return name;
}

/** The anonymous-key entry has no `key` field; find it by the cached name. */
function nameOf(key) {
	if (isPersistentStoredValueKey(key)) return storedValueNameForKey(key);
	const cached = nameCache.get(key);
	return cached != null && cached in core.storedValues ? cached : null;
}

/** Track a holder's new getter; the entry follows when that holder is the active one. */
export function updateStoredValueClaim(key, token, getter, source = '') {
	const hs = holders.get(key);
	if (!hs || !hs.has(token)) return;
	const prev = hs.get(token);
	hs.set(token, { getter, source });
	const name = nameOf(key);
	if (name == null) return;
	const entry = core.storedValues[name];
	if (entry?.getter === prev.getter || hs.keys().next().value === token) {
		if (entry.getter !== getter || entry.source !== source)
			core.storedValues[name] = { ...entry, getter, source };
	}
}

/** Anonymous holders keep their name locally across a rename (no key to search by). */
export function renameAnonymousClaim(key, newName) {
	if (!isPersistentStoredValueKey(key)) nameCache.set(key, newName);
}

/**
 * Drop a holder. The last one out removes the entry, but only while the entry is
 * still its live getter: a snapshot restored by a session load that happened
 * before this unmount is left alone.
 */
export function releaseStoredValue(key, token) {
	const hs = holders.get(key);
	if (!hs || !hs.has(token)) return;
	const gone = hs.get(token);
	hs.delete(token);
	const name = nameOf(key);
	const entry = name != null ? core.storedValues[name] : null;
	if (hs.size === 0) {
		holders.delete(key);
		nameCache.delete(key);
		if (entry && entry.getter === gone.getter) delete core.storedValues[name];
		return;
	}
	if (entry && entry.getter === gone.getter) {
		const next = hs.values().next().value;
		core.storedValues[name] = { ...entry, getter: next.getter, source: next.source };
	}
}

/** Test helper: how many buttons currently hold `key`. */
export function storedValueHolderCount(key) {
	return holders.get(key)?.size ?? 0;
}

/** Test helper: forget every holder (module state outlives a test's fresh core). */
export function resetStoredValueClaimsForTest() {
	holders.clear();
	nameCache.clear();
}
