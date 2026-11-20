// The label of the enclosing <ControlInput associate={false}>, for a composite control that
// cannot sit inside a wrapping <label> (a dropdown trigger, a colour swatch with a popup, a
// switch that already has its own <label>, a date + time pair).
//
// ControlInput always sets this context: { id, label } when it renders a <div> (associate
// false) with a label, and { id: null } when it renders a real <label> or has no label, so a
// nested ControlInput never inherits an outer one's label. A control reads it once at init
// and names itself with aria-labelledby="<id> <its own id>" (label first, then its own text
// or aria-label), so a screen reader hears "Time (x), Light" rather than just "Light".
import { createContext } from 'svelte';

/** @typedef {{ readonly id: string | null, readonly label: string }} ControlLabel */

/** @type {[() => ControlLabel, (value: ControlLabel) => ControlLabel, () => boolean]} */
const [getContext, setContext, hasContext] = createContext();

/** Called by ControlInput. @param {ControlLabel} value */
export const setControlLabel = (value) => setContext(value);

/**
 * The enclosing ControlInput's label, or null outside one. Call during component init.
 * @returns {ControlLabel | null}
 */
export function controlLabel() {
	return hasContext() ? getContext() : null;
}

/**
 * The aria-labelledby value for a control named by its ControlInput label and then itself:
 * "<labelId> <selfId>", or undefined (no attribute) when there is no label to point at.
 * @param {string | null | undefined} labelId
 * @param {string} selfId
 */
export function labelledBy(labelId, selfId) {
	return labelId ? `${labelId} ${selfId}` : undefined;
}
