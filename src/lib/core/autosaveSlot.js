// Which autosave slot this tab writes to (autosave.svelte.js).
//
// Every page load gets a fresh slot id, so two tabs (or a tab and its own reload) never write
// over each other's copy. A tab that restores a copy adopts that copy's slot, so the restored
// session keeps one copy rather than two.
//
// Kept in a module of its own, with no imports, so the crash reporter (errorReporter.js) can
// note the slot in its crash copy without importing autosave and everything autosave imports.

/** A new, unguessable slot id. */
export function newSlotId() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `slot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

let slot = newSlotId();

/** The slot this tab's autosave writes to. */
export function getAutosaveSlot() {
	return slot;
}

/** Write to `id` from now on (after restoring the copy in that slot). */
export function setAutosaveSlot(id) {
	if (typeof id === 'string' && id) slot = id;
}
