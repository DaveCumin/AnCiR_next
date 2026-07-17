// Multi-session isolation smoke test: two concurrent sessions, each its own worker
// process + engine. Proves they don't share state (AnCiR's core is a singleton, so
// without process isolation they would clobber each other). Run from mcp/:
//   node test/smoke-multisession.mjs
import { SessionManager } from '../src/sessionManager.js';

const mgr = new SessionManager({ idleMs: 60000 });

try {
	// Session A: 2 columns. Session B: 4 columns. Build them interleaved.
	await mgr.call('A', 'create_session', { id: 'A' });
	await mgr.call('B', 'create_session', { id: 'B' });

	await mgr.call('A', 'import_data', {
		columns: [
			{ name: 't', values: Array.from({ length: 48 }, (_, i) => i) },
			{ name: 'y', values: Array.from({ length: 48 }, (_, i) => 10 + 5 * Math.cos((2 * Math.PI * i) / 24)) }
		]
	});
	await mgr.call('B', 'import_data', {
		columns: [
			{ name: 'a', values: [1, 2, 3] },
			{ name: 'b', values: [4, 5, 6] },
			{ name: 'c', values: [7, 8, 9] },
			{ name: 'd', values: [10, 11, 12] }
		]
	});

	const aCols = JSON.parse(JSON.stringify(await mgr.call('A', 'list_columns'))).columns;
	const bCols = (await mgr.call('B', 'list_columns')).columns;
	console.log(`A columns: ${aCols.length}, B columns: ${bCols.length}, workers: ${mgr.size}`);

	// A runs a cosinor on its own data; B is untouched.
	const fit = await mgr.call('A', 'run_table_process', {
		name: 'Cosinor',
		args: { xIN: 0, yIN: [1], useFixedPeriod: true, fixedPeriod: 24 }
	});
	const aMesor = fit.outputs.length;

	const bColsAfter = (await mgr.call('B', 'list_columns')).columns;
	console.log(`After A's analysis — B columns still: ${bColsAfter.length}, A cosinor valid: ${fit.valid}`);

	if (aCols.length !== 2) throw new Error('A should have 2 columns, got ' + aCols.length);
	if (bCols.length !== 4) throw new Error('B should have 4 columns, got ' + bCols.length);
	if (bColsAfter.length !== 4) throw new Error('B leaked state from A! got ' + bColsAfter.length);
	if (!fit.valid) throw new Error('A cosinor failed');
	if (mgr.size !== 2) throw new Error('expected 2 isolated workers, got ' + mgr.size);
	console.log('MULTISESSION OK ✅ (', aMesor, 'A outputs; B isolated)');
} finally {
	mgr.destroyAll();
}
process.exit(0);
