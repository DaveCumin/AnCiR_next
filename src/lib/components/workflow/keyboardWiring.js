// Keyboard wiring on the canvas (UI-25): which key on which port does what.
//
// The wire in progress is WorkflowEditor's `pendingConnection`, the same state a mouse
// click-to-start sets, flagged `keyboard: true` when a key started it. A keyboard wire
// therefore completes through the same applyConnection() as a mouse wire (one undo step, the
// same ops), and a mouse click on an input can finish a wire a key started.
//
//   idle        Enter/Space on an output starts a wire from it.
//               Enter/Space on an input opens its column list (the right-click picker).
//               Delete/Backspace on an input removes the wires into it.
//   connecting  Tab/Shift+Tab (or the arrow keys) move focus among the inputs that can take
//               the wire, Enter/Space on one completes it, Escape cancels (only the wire; the
//               next Escape deselects, as in utils/editableTarget.js).
//
// Pure module: the editor reads the focused port from the event target's data-* attributes.

/** @typedef {{ nodeId: string, port: string, dir: string }} PortRef dir is 'in' or 'out' */
/** @typedef {{ fromNodeId?: string, fromPort?: string, keyboard?: boolean, reverse?: boolean } | null} Wiring */

const ACTIVATE = new Set(['Enter', ' ']);
const REMOVE = new Set(['Delete', 'Backspace']);
const NEXT = new Set(['ArrowDown', 'ArrowRight']);
const PREV = new Set(['ArrowUp', 'ArrowLeft']);

/**
 * Whether `port` can finish `wiring`: an input on another node that accepts it.
 * @param {Wiring} wiring
 * @param {PortRef | null} port
 * @param {(wiring: Wiring, port: PortRef) => boolean} accepts the editor's per-port check
 */
export function isWireCandidate(wiring, port, accepts) {
	if (!wiring || wiring.reverse || !port || port.dir !== 'in') return false;
	if (port.nodeId === wiring.fromNodeId) return false;
	return accepts(wiring, port) === true;
}

/**
 * The action for a keydown. `port` is the focused port, or null when focus is elsewhere.
 * Returns null when the key is not the canvas wiring's (let the rest of the app have it),
 * 'ignore' when it is, but there is nothing to do (the caller still swallows it).
 *
 * @param {Wiring} wiring
 * @param {{ key: string, shiftKey?: boolean, metaKey?: boolean, ctrlKey?: boolean, altKey?: boolean }} e
 * @param {PortRef | null} port
 * @param {(wiring: Wiring, port: PortRef) => boolean} accepts
 * @returns {null | 'start' | 'pick' | 'complete' | 'invalid' | 'disconnect' | 'next' | 'prev' | 'cancel' | 'ignore'}
 */
export function portKeyAction(wiring, e, port, accepts) {
	if (e.metaKey || e.ctrlKey || e.altKey) return null;
	const key = e.key;
	if (wiring) {
		if (key === 'Escape') return 'cancel';
		// Only a wire the keyboard started steers focus; a mouse wire follows the pointer.
		if (wiring.keyboard) {
			if (key === 'Tab') return e.shiftKey ? 'prev' : 'next';
			if (NEXT.has(key)) return 'next';
			if (PREV.has(key)) return 'prev';
		}
		if (!port) return null;
		if (ACTIVATE.has(key)) {
			if (port.dir === 'out') return 'start';
			return isWireCandidate(wiring, port, accepts) ? 'complete' : 'invalid';
		}
		if (REMOVE.has(key)) return 'ignore';
		return null;
	}
	if (!port) return null;
	if (ACTIVATE.has(key)) return port.dir === 'out' ? 'start' : 'pick';
	if (REMOVE.has(key)) return port.dir === 'in' ? 'disconnect' : 'ignore';
	return null;
}

/** Next index in a list of `n`, wrapping; from outside the list (-1), the first or the last. */
export function cycleIndex(n, current, backwards) {
	if (n <= 0) return -1;
	if (current < 0 || current >= n) return backwards ? n - 1 : 0;
	return (current + (backwards ? n - 1 : 1)) % n;
}

/** Text for the canvas live region. */
export const wiringMessages = {
	start(node, port, candidates) {
		const head = `Connecting from ${node}: ${port}.`;
		if (candidates <= 0) return `${head} No input port can take it. Escape cancels.`;
		const n =
			candidates === 1 ? '1 input port can take it' : `${candidates} input ports can take it`;
		return `${head} ${n}: press Tab to move between them and Enter to connect. Escape cancels.`;
	},
	done: (fromNode, fromPort, toNode, toPort) =>
		`Connected ${fromNode}: ${fromPort} to ${toNode}: ${toPort}.`,
	cancel: () => 'Connection cancelled.',
	invalid: (node, port) => `${node}: ${port} cannot take this wire. Choose another input port.`,
	removed: (node, port) => `Removed the wires into ${node}: ${port}.`,
	nothing: (node, port) => `Nothing is connected to ${node}: ${port}.`
};

/** id of the canvas's one visually hidden description of the port keys; every port dot points
 *  its aria-describedby at it. */
export const PORT_KEYS_HELP_ID = 'canvas-port-keys-help';

/** That description's text. */
export const PORT_KEYS_HELP =
	'Enter on an output port starts a wire; Tab then moves between the inputs that can take it ' +
	'and Enter connects. Enter on an input port lists columns to connect. Delete on an input ' +
	'port removes its wires.';
