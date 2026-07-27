// Integration half of the unknown-node guard. Split out because loading the
// whole node registry takes several seconds — far past vitest's 5s default — and
// because these touch rune-backed classes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetUnknownNodeReports } from './unknownNode.js';

let errSpy;
beforeEach(() => {
	resetUnknownNodeReports();
	errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

describe('the three node kinds all report', () => {
	// Guards against one kind being wired and another quietly left silent, which
	// is how they diverged in the first place: TableProcess no-opped, Process set
	// an error marker without logging, and Plot threw a bare TypeError.
	it('TableProcess.doProcess reports an unresolvable name', async () => {
		const { core, appConsts, pushObj } = await import('$lib/core/core.svelte.js');
		const { TableProcess } = await import('$lib/core/TableProcess.svelte');
		const { loadTableProcesses } = await import('$lib/tableProcesses/tableProcessMap.js');
		appConsts.tableProcessMap = await loadTableProcesses();
		core.data = [];
		core.rawData = new Map();
		core.tableProcesses = [];

		const tp = new TableProcess(
			{ name: 'NoSuchNodeXYZ', args: { xIN: -1, yIN: -1, out: {} } },
			null
		);
		pushObj(tp);
		const res = await tp.doProcess();

		expect(res).toBeNull(); // still degrades safely
		expect(errSpy).toHaveBeenCalled(); // but no longer silently
		expect(errSpy.mock.calls.some((c) => String(c[0]).includes('NoSuchNodeXYZ'))).toBe(true);
	}, 30000);

	it('Process reports an unresolvable name at construction', async () => {
		const { appConsts } = await import('$lib/core/core.svelte.js');
		const { Process } = await import('$lib/core/Process.svelte');
		const { loadProcesses } = await import('$lib/processes/processMap.js');
		appConsts.processMap = await loadProcesses();

		const proc = new Process({ name: 'NoSuchProcessXYZ', args: {} }, null);
		expect(errSpy.mock.calls.some((c) => String(c[0]).includes('NoSuchProcessXYZ'))).toBe(true);
		// The error marker is still set, and now carries the explanatory text.
		expect(proc.args.error).toMatch(/NoSuchProcessXYZ/);
	}, 30000);
});
