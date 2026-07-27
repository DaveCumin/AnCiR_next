// A node whose registry key cannot be resolved must fail LOUDLY.
//
// Measured before this guard existed, on a TableProcess with an unknown name:
//   constructed OK           : true
//   doProcess() returned     : null
//   console.warn calls       : 0
//   console.error calls      : 0
//   node still in core.tableProcesses: true
//
// The session opened, the node sat on the canvas under its stored name, and its
// outputs were simply stale — indistinguishable from a node the user forgot to
// wire. That is the failure this pins shut.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reportUnknownNode, resetUnknownNodeReports } from './unknownNode.js';

let errSpy;
beforeEach(() => {
	resetUnknownNodeReports();
	errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

describe('reportUnknownNode', () => {
	it('logs an error naming the kind and the key', () => {
		reportUnknownNode('table process', 'CategoricalTests');
		expect(errSpy).toHaveBeenCalledTimes(1);
		const msg = errSpy.mock.calls[0][0];
		expect(msg).toMatch(/table process/);
		expect(msg).toMatch(/CategoricalTests/);
	});

	it('explains the likely cause and the consequence', () => {
		// A bare "unknown node" would leave the user no better off than silence.
		const msg = reportUnknownNode('plot', 'scalogram');
		expect(msg).toMatch(/renamed or removed|newer version/);
		expect(msg).toMatch(/cannot compute/);
	});

	it('returns the message so the UI can show the same text', () => {
		const msg = reportUnknownNode('column process', 'Frobnicate');
		expect(msg).toMatch(/Frobnicate/);
		expect(errSpy.mock.calls[0][0]).toContain(msg);
	});

	it('logs only ONCE per kind+key', () => {
		// These lookups sit inside reactive effects; without dedup a single broken
		// node would flood the console on every recompute.
		for (let i = 0; i < 20; i++) reportUnknownNode('table process', 'Gone');
		expect(errSpy).toHaveBeenCalledTimes(1);
	});

	it('still reports a DIFFERENT key, and the same key under a different kind', () => {
		reportUnknownNode('table process', 'A');
		reportUnknownNode('table process', 'B');
		reportUnknownNode('plot', 'A');
		expect(errSpy).toHaveBeenCalledTimes(3);
	});
});
