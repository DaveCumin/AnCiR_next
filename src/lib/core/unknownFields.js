// @ts-nocheck
// Unknown session fields survive a load and a save (review ROB-22).
//
// A session saved by a newer AnCiR (or written by a script or the AI service) can hold fields
// this version does not know. Every loader here builds its objects from the fields it knows, and
// every saver writes the fields it knows, so an unknown field used to vanish the first time the
// file was opened and saved again: open a colleague's newer session, save it, and their settings
// were gone.
//
// ONE RULE DECIDES WHAT IS UNKNOWN: a field the loader never READ. The loader is run over a
// read-tracking view of the saved object (trackReads), and whatever it did not look at is kept
// beside the object it built and written back when that object is saved. Reading is the right
// test because it is what the loader already does for every field it handles, including the
// ones it consumes and never writes again:
//
//   - a legacy field a loader migrates (a Scatterplot's `xlabel` becoming `xAxis`, a plot's
//     `plotid`, a Column's `provenance`, an Actogram series' `phaseMarkers`) is read, so it is
//     known and is NOT kept: a migrated-away field never comes back;
//   - a field a loader reads only to decide something is read, so it is known too;
//   - a loader that copies the whole object (`{ ...json }`, Object.assign, JSON.stringify) reads
//     every field, so nothing is kept. That is the safe direction: the worst a new loader can do
//     is stop preserving, never resurrect.
//
// And a kept field NEVER overrides a known one: it is written only when the object's own save
// has no field of that name (mergeUnknown). So a newer field this version understands, or a
// field this version omits on purpose (an empty `facetOverrides`), is always decided by the
// object's current state, never by the stale copy from the file.
//
// The migrations that run on the parsed file BEFORE the loaders (facets, Data Views, phase
// marker stored values, Enright bins) rewrite or delete the fields they migrate, so the loaders
// never see those fields at all; unknownFields.test.js pins that for each one.
//
// Where it applies: the session's top level, every plot (wrapper, inner settings object and
// each series), every column and column process, every analysis node (its args were always
// kept whole), and every group, composite and note. Nested objects inside those (an axis, a
// series' line style) are not tracked: they are loaded whole or rebuilt by their own classes.

const PROXIES = new WeakSet();

/** A plain JSON object (not an array, not a class instance, not null). */
export function isPlainObject(v) {
	if (v == null || typeof v !== 'object' || Array.isArray(v)) return false;
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/**
 * A read-tracking view of a saved object. Pass `view` to the loader instead of the object; then
 * `unread()` lists the fields it never read, as [key, value] pairs (values deep-copied).
 *
 * Nested values are returned as they are (never wrapped), so a loader that keeps a nested
 * object keeps the real one. The one exception is `arrays`: for each key named there whose
 * value is an array, the loader gets an array of tracking views of its plain-object elements,
 * and `elements(key)` returns their trackers (a plot's series, `data`).
 *
 * @param {object} json
 * @param {{ arrays?: string[] }} [opts]
 */
export function trackReads(json, { arrays = [] } = {}) {
	const read = new Set();
	const elementTrackers = new Map();
	const elementViews = new Map();
	const view = new Proxy(json, {
		get(target, key, receiver) {
			if (typeof key === 'string') read.add(key);
			const value = Reflect.get(target, key, receiver);
			if (typeof key === 'string' && arrays.includes(key) && Array.isArray(value)) {
				if (!elementViews.has(key)) {
					const trackers = value.map((el) => (isPlainObject(el) ? trackReads(el) : null));
					elementTrackers.set(key, trackers);
					elementViews.set(
						key,
						value.map((el, i) => (trackers[i] ? trackers[i].view : el))
					);
				}
				return elementViews.get(key);
			}
			return value;
		},
		has(target, key) {
			if (typeof key === 'string') read.add(key);
			return Reflect.has(target, key);
		}
	});
	PROXIES.add(view);
	return {
		view,
		unread() {
			const out = [];
			for (const key of Object.keys(json)) {
				if (read.has(key)) continue;
				// A field holding nothing JSON can write carries nothing to keep.
				if (json[key] === undefined || typeof json[key] === 'function') continue;
				out.push([key, clone(json[key])]);
			}
			return out;
		},
		/** The trackers of an `arrays` key's elements, or null if the loader never read it. */
		elements(key) {
			return elementTrackers.get(key) ?? null;
		}
	};
}

/** True for a view made by trackReads (tests use it to prove no loader keeps one). */
export function isTrackingView(v) {
	return v != null && typeof v === 'object' && PROXIES.has(v);
}

/**
 * Add kept fields to an object's saved form, never over a field the save already has.
 * Returns `out` (changed in place) for chaining.
 */
export function mergeUnknown(out, entries) {
	if (!isPlainObject(out) || !entries?.length) return out;
	for (const [key, value] of entries) {
		if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = clone(value);
	}
	return out;
}

const KEPT = new WeakMap();

/**
 * Keep unread fields with the object a loader built, so its save writes them back.
 *
 * A plain object (a group, a note) is saved as it is, so the fields go straight onto it (only
 * where it has none of that name). A class instance is saved by its toJSON, so it gets its own
 * toJSON that calls the class's and then merges the kept fields: every route that serialises the
 * object (a session save, an undo snapshot, a copy) writes them, with no change to the class.
 */
export function keepUnknownFields(obj, entries) {
	if (obj == null || typeof obj !== 'object' || !entries?.length) return obj;
	if (isPlainObject(obj)) {
		for (const [key, value] of entries) {
			if (!Object.prototype.hasOwnProperty.call(obj, key)) obj[key] = value;
		}
		return obj;
	}
	const classToJSON = Object.getPrototypeOf(obj)?.toJSON;
	if (typeof classToJSON !== 'function') return obj;
	KEPT.set(obj, entries);
	Object.defineProperty(obj, 'toJSON', {
		value: function toJSON(...args) {
			return mergeUnknown(classToJSON.apply(this, args), KEPT.get(this));
		},
		configurable: true,
		writable: true,
		enumerable: false
	});
	return obj;
}

/** The fields kept for an object, as { key: value } (empty when none). For tests and tools. */
export function unknownFieldsOf(obj) {
	if (obj == null || typeof obj !== 'object') return {};
	return Object.fromEntries(KEPT.get(obj) ?? []);
}

/**
 * Build an object from saved JSON with `build(view)`, keeping whatever `build` did not read.
 * A value that is not a plain object goes to `build` unchanged.
 */
export function loadKeepingUnknown(json, build) {
	if (!isPlainObject(json)) return build(json);
	const tracker = trackReads(json);
	const obj = build(tracker.view);
	keepUnknownFields(obj, tracker.unread());
	return obj;
}
