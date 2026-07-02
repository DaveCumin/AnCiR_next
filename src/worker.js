// Per-session engine worker.
//
// AnCiR's `core` is a module-level singleton, so one process holds exactly one
// session. To support many concurrent isolated sessions (e.g. a multi-tenant app),
// the SessionManager (sessionManager.js) spawns one of these workers per session
// and talks to it over Node's IPC channel (process.send / 'message'), which is
// separate from stdout/stderr so engine log noise can't corrupt the protocol.
//
// Protocol: parent → { rid, method, args }; worker → { rid, ok, result } | { rid,
// ok:false, error }. On startup the worker sends { type: 'ready' }.
import { ensureDom } from './engine/bootstrapDom.js';

await ensureDom();
const { AncirSession, ensureRegistry, describeCapabilities } = await import('./engine/session.js');
await ensureRegistry();

let session = null;
const requireSession = () => {
	if (!session) throw new Error('No active session. Call create_session first.');
	return session;
};

const methods = {
	describe_capabilities: () => describeCapabilities(),
	create_session: ({ id } = {}) => {
		session = new AncirSession(id ?? 'default');
		return { created: true, id: session.id };
	},
	import_data: ({ columns }) => ({ added: requireSession().importColumns(columns) }),
	list_columns: () => ({ columns: requireSession().listColumns() }),
	run_table_process: ({ name, args }) => requireSession().runTableProcess(name, args ?? {}),
	add_column_process: ({ columnId, name, args }) =>
		requireSession().addColumnProcess(columnId, name, args ?? {}),
	add_plot: ({ type, inputs }) => requireSession().addPlot(type, inputs),
	render_plot: ({ type, inputs, outBase, width, height }) =>
		requireSession().renderPlotToFiles(type, inputs, { outBase, width, height }),
	export_session: () => ({ json: requireSession().exportSession() })
};

process.on('message', async (msg) => {
	const { rid, method, args } = msg ?? {};
	try {
		const fn = methods[method];
		if (!fn) throw new Error(`Unknown method "${method}"`);
		const result = await fn(args ?? {});
		process.send({ rid, ok: true, result });
	} catch (err) {
		process.send({ rid, ok: false, error: err?.message || String(err) });
	}
});

process.send({ type: 'ready' });
