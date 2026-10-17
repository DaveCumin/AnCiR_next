import { describe, it, expect } from 'vitest';
import { portKeyAction, isWireCandidate, cycleIndex, wiringMessages } from './keyboardWiring.js';

// UI-25: keyboard wiring on the canvas. The state is the editor's pendingConnection (the same
// one a mouse click-to-start sets), so a keyboard wire and a mouse wire share one apply path.
// This file pins the key-to-action table; tests/e2e/keyboard-wiring.spec.js drives it with
// real keys in the app.

const out = { nodeId: 'tableprocess_1', port: 'col_5', dir: 'out' };
const inOther = { nodeId: 'plot_2', port: 'ys1', dir: 'in' };
const inSame = { nodeId: 'tableprocess_1', port: 'yIN', dir: 'in' };
const wiring = { fromNodeId: 'tableprocess_1', fromPort: 'col_5', keyboard: true };
const key = (k, extra = {}) => ({ key: k, shiftKey: false, ...extra });
const any = () => true;

describe('portKeyAction: idle (no wire in progress)', () => {
	it('Enter or Space on an output port starts a wire from it', () => {
		expect(portKeyAction(null, key('Enter'), out, any)).toBe('start');
		expect(portKeyAction(null, key(' '), out, any)).toBe('start');
	});
	it('Enter or Space on an input port opens its column list', () => {
		expect(portKeyAction(null, key('Enter'), inOther, any)).toBe('pick');
		expect(portKeyAction(null, key(' '), inOther, any)).toBe('pick');
	});
	it('Delete or Backspace on an input port removes the wires into it', () => {
		expect(portKeyAction(null, key('Delete'), inOther, any)).toBe('disconnect');
		expect(portKeyAction(null, key('Backspace'), inOther, any)).toBe('disconnect');
	});
	it('Delete on an output port is the port’s, and does nothing (never deletes the node)', () => {
		expect(portKeyAction(null, key('Delete'), out, any)).toBe('ignore');
	});
	it('leaves Tab, Escape and keys off a port to the rest of the app', () => {
		expect(portKeyAction(null, key('Tab'), out, any)).toBe(null);
		expect(portKeyAction(null, key('Escape'), out, any)).toBe(null);
		expect(portKeyAction(null, key('Enter'), null, any)).toBe(null);
		expect(portKeyAction(null, key('Delete'), null, any)).toBe(null);
	});
	it('leaves modified keys alone (Cmd+Enter, Ctrl+Delete are not port gestures)', () => {
		expect(portKeyAction(null, key('Enter', { metaKey: true }), out, any)).toBe(null);
		expect(portKeyAction(null, key('Delete', { ctrlKey: true }), inOther, any)).toBe(null);
	});
});

describe('portKeyAction: connecting', () => {
	it('Enter on a valid input completes the wire', () => {
		expect(portKeyAction(wiring, key('Enter'), inOther, any)).toBe('complete');
		expect(portKeyAction(wiring, key(' '), inOther, any)).toBe('complete');
	});
	it('Enter on an input that cannot take the wire says so and keeps the wire', () => {
		expect(portKeyAction(wiring, key('Enter'), inSame, any)).toBe('invalid');
		expect(portKeyAction(wiring, key('Enter'), inOther, () => false)).toBe('invalid');
	});
	it('Enter on an output re-picks the source (as a mouse click on another output does)', () => {
		expect(portKeyAction(wiring, key('Enter'), { ...out, port: 'col_6' }, any)).toBe('start');
	});
	it('Tab and Shift+Tab move among the valid inputs, from anywhere', () => {
		expect(portKeyAction(wiring, key('Tab'), out, any)).toBe('next');
		expect(portKeyAction(wiring, key('Tab', { shiftKey: true }), inOther, any)).toBe('prev');
		expect(portKeyAction(wiring, key('Tab'), null, any)).toBe('next');
	});
	it('arrow keys move among the valid inputs too', () => {
		expect(portKeyAction(wiring, key('ArrowDown'), inOther, any)).toBe('next');
		expect(portKeyAction(wiring, key('ArrowRight'), inOther, any)).toBe('next');
		expect(portKeyAction(wiring, key('ArrowUp'), inOther, any)).toBe('prev');
		expect(portKeyAction(wiring, key('ArrowLeft'), inOther, any)).toBe('prev');
	});
	it('Escape cancels the wire (and only the wire)', () => {
		expect(portKeyAction(wiring, key('Escape'), inOther, any)).toBe('cancel');
		expect(portKeyAction(wiring, key('Escape'), null, any)).toBe('cancel');
	});
	it('a mouse wire in progress gets Escape too, but not Tab or arrows', () => {
		const mouse = { fromNodeId: 'tableprocess_1', fromPort: 'col_5' };
		expect(portKeyAction(mouse, key('Escape'), null, any)).toBe('cancel');
		expect(portKeyAction(mouse, key('Tab'), null, any)).toBe(null);
		expect(portKeyAction(mouse, key('ArrowDown'), null, any)).toBe(null);
	});
	it('Delete while connecting is swallowed (it would otherwise delete the selected node)', () => {
		expect(portKeyAction(wiring, key('Delete'), inOther, any)).toBe('ignore');
	});
});

describe('isWireCandidate', () => {
	it('an input on another node that accepts the wire', () => {
		expect(isWireCandidate(wiring, inOther, any)).toBe(true);
	});
	it('never an output, nor an input on the source node', () => {
		expect(isWireCandidate(wiring, out, any)).toBe(false);
		expect(isWireCandidate(wiring, inSame, any)).toBe(false);
	});
	it('asks the editor whether the port accepts this wire (Column Sets: many-in only)', () => {
		const seen = [];
		isWireCandidate(wiring, inOther, (w, p) => (seen.push([w, p]), false));
		expect(seen).toEqual([[wiring, inOther]]);
	});
	it('no wire, no candidates', () => {
		expect(isWireCandidate(null, inOther, any)).toBe(false);
	});
});

describe('cycleIndex', () => {
	it('steps forward and back, wrapping', () => {
		expect(cycleIndex(3, 0, false)).toBe(1);
		expect(cycleIndex(3, 2, false)).toBe(0);
		expect(cycleIndex(3, 0, true)).toBe(2);
	});
	it('from outside the list: first going forward, last going back', () => {
		expect(cycleIndex(3, -1, false)).toBe(0);
		expect(cycleIndex(3, -1, true)).toBe(2);
	});
	it('an empty list has nowhere to go', () => {
		expect(cycleIndex(0, -1, false)).toBe(-1);
	});
});

describe('wiringMessages (live-region text)', () => {
	it('names the source and the keys on start', () => {
		expect(wiringMessages.start('Cosinor', 'amplitude', 3)).toBe(
			'Connecting from Cosinor: amplitude. 3 input ports can take it: press Tab to move between them and Enter to connect. Escape cancels.'
		);
		expect(wiringMessages.start('Cosinor', 'amplitude', 1)).toMatch(/1 input port can take it/);
		expect(wiringMessages.start('Cosinor', 'amplitude', 0)).toBe(
			'Connecting from Cosinor: amplitude. No input port can take it. Escape cancels.'
		);
	});
	it('done, cancelled, refused, removed', () => {
		expect(wiringMessages.done('Cosinor', 'amplitude', 'Scatter', 'y')).toBe(
			'Connected Cosinor: amplitude to Scatter: y.'
		);
		expect(wiringMessages.cancel()).toBe('Connection cancelled.');
		expect(wiringMessages.invalid('Scatter', 'y')).toBe(
			'Scatter: y cannot take this wire. Choose another input port.'
		);
		expect(wiringMessages.removed('Scatter', 'y')).toBe('Removed the wires into Scatter: y.');
		expect(wiringMessages.nothing('Scatter', 'y')).toBe('Nothing is connected to Scatter: y.');
	});
	it('uses no em-dashes', () => {
		const all = [
			wiringMessages.start('a', 'b', 2),
			wiringMessages.start('a', 'b', 0),
			wiringMessages.done('a', 'b', 'c', 'd'),
			wiringMessages.cancel(),
			wiringMessages.invalid('a', 'b'),
			wiringMessages.removed('a', 'b'),
			wiringMessages.nothing('a', 'b')
		].join(' ');
		expect(all).not.toMatch(/—/);
	});
});
