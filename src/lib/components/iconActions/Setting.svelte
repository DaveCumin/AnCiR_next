<script module>
	import { appConsts, appState, outputCoreAsJson } from '$lib/core/core.svelte';
	import { addNotification } from '$lib/core/notifications.svelte.js';
	import { loadPythonExporter, loadRExporter } from '$lib/utils/pythonExportLoader.js';
	import { zipSync, strToU8 } from 'fflate';
	import { checkRSupport, explainRSupport } from '$lib/utils/rExportSupport.js';
	import { normaliseFigureStyle, transitionalFigureStyle } from '$lib/plots/figureStyle.js';
	import { migrateCategoryColourMap } from '$lib/plots/seriesColour.js';
	import { migrateAppearanceMaps } from '$lib/plots/appearanceIdentity.js';
	import { migrateFacetChildren } from '$lib/core/facetMigration.js';
	import { migratePhaseMarkerStoredValues } from '$lib/core/phaseMarkerStoredValueMigration.js';
	import { migrateLegacyEnrightBins } from '$lib/core/enrightBinMigration.js';
	import { migrateLegacyAutoPeriodRange } from '$lib/tableProcesses/periodRangeAuto.svelte.js';
	import { migrateDataViews } from '$lib/core/dataViewMigration.js';
	import { childDefaultsFromRegistry } from '$lib/core/facetMigrationDefaults.js';
	import { history } from '$lib/core/opHistory.svelte.js';
	import { paramDiffWatcher } from '$lib/core/paramDiffWatcher.svelte.js';
	import {
		NotASessionError,
		sessionShapeProblem,
		snapshotSession,
		restoreSession,
		resetSession,
		compareAppVersions
	} from '$lib/core/sessionLoad.svelte.js';
	import { markSessionSaved } from '$lib/core/unsavedChanges.svelte.js';
	import { clearNotesFromPlots } from '$lib/core/notePlacement.js';
	import { clearCrashSnapshot } from '$lib/core/errorReporter.js';
	import { sessionSaveFileName, sessionNameForSave } from '$lib/core/sessionFiles.js';
	import { downloadBlob } from '$lib/utils/downloadBlob.js';
	import { trackReads, loadKeepingUnknown } from '$lib/core/unknownFields.js';
	export function exportJson() {
		try {
			// outputCoreAsJson builds this with JSON.stringify, so it is valid JSON by construction.
			// It used to be parsed again here just to check, a full extra pass over a large session.
			const jsonStr = outputCoreAsJson();
			if (typeof jsonStr !== 'string' || !jsonStr) {
				throw new Error('Invalid or empty JSON string returned by outputCoreAsJson');
			}

			// "<data source> <YYYY-MM-DD>.ancir" rather than "session.json" every time (UI-15).
			const fileName = sessionSaveFileName(sessionNameForSave(core));
			downloadBlob(fileName, new Blob([jsonStr], { type: 'application/json' }));

			// The open session is now in a file: nothing to warn about on close (ROB-5), and
			// a crash copy kept from earlier is older than the file, so it is not offered back.
			markSessionSaved();
			clearCrashSnapshot();

			addNotification(`Session saved as "${fileName}".`, 'info');
		} catch (error) {
			console.error('Failed to save the session:', error.message);
			addNotification('Could not save the session: ' + error.message);
		}
	}

	/**
	 * Deliver export files: one file downloads directly; several (split mode
	 * and/or a data CSV) are bundled into ONE zip, because sequential downloads
	 * trip most browsers' multiple-download blocking and the files only work
	 * together in one folder anyway. fflate is already a dependency (the XLSX
	 * importer unzips with it), so this adds nothing new.
	 * Returns the delivered filename for the notification.
	 */
	function deliverExportFiles(files, zipName, singleMime) {
		if (files.length === 1) {
			downloadBlob(files[0].name, new Blob([files[0].text], { type: singleMime }));
			return files[0].name;
		}
		const entries = {};
		for (const f of files) entries[f.name] = strToU8(f.text);
		downloadBlob(zipName, new Blob([zipSync(entries)], { type: 'application/zip' }));
		return zipName;
	}

	/** Build export files via the sidecar, honouring {split, dataAsCsv}. The default
	 *  (both off) keeps the original single-script path and entry point. */
	function exportFilesFrom(mod, session, opts, buildScript, buildFiles, scriptName) {
		const split = opts?.split === true;
		const dataAsCsv = opts?.dataAsCsv === true;
		if (!split && !dataAsCsv) {
			return [{ name: scriptName, text: mod[buildScript](session) }];
		}
		if (typeof mod[buildFiles] !== 'function') {
			// A stale cached sidecar from before split/CSV export existed.
			throw new Error('the export module is out of date; reload the app and try again');
		}
		return mod[buildFiles](session, { split, dataAsCsv });
	}

	// EXPERIMENTAL: export the current session as a Python script
	// (ports tools/ancir_to_python.py).
	//
	// The exporter and its ~198 KB Python runtime live in a SIDECAR file rather than in the
	// bundle. A `?raw` import used to look lazy but was not: the app inlines everything into
	// one index.html, so every visitor downloaded the runtime whether or not they ever
	// exported Python — about 7% of the page, raw and gzipped, for an experimental feature.
	// The sidecar may legitimately be absent (a single-file copy of AnCiR), so a failure to
	// load is reported as such instead of surfacing as an opaque error.
	//
	// opts.split: helper file (full runtime) + short analysis script instead of one
	// self-contained file. opts.dataAsCsv: column data in session_data.csv, read
	// back with pandas.read_csv. Multi-file results download as one zip.
	export async function exportPython(opts) {
		try {
			const session = JSON.parse(outputCoreAsJson());
			const mod = await loadPythonExporter();
			const files = exportFilesFrom(
				mod,
				session,
				opts,
				'buildPythonScript',
				'buildPythonExportFiles',
				'session.py'
			);
			const delivered = deliverExportFiles(files, 'session_python.zip', 'text/x-python');
			const entry = opts?.split === true ? 'analysis.py' : 'session.py';
			addNotification(
				`Exported ${delivered}. Run ${entry} with Python (needs numpy, pandas, scipy).`,
				'info'
			);
		} catch (error) {
			console.error('Failed to export Python:', error?.message ?? error);
			addNotification('Error exporting Python: ' + (error?.message ?? error));
		}
	}

	/**
	 * EXPERIMENTAL: export the current session as a self-contained R script.
	 *
	 * Same sidecar arrangement as the Python export, plus one thing the Python export does not
	 * need: a COVERAGE CHECK before anything is downloaded.
	 *
	 * The R runtime is strict — an analysis it does not implement aborts the generated script
	 * rather than being skipped, because a script that quietly drops a step still writes a
	 * plausible columns.csv. That protects whoever RUNS the script. Checking here protects
	 * whoever EXPORTS it: the refusal arrives while they are still looking at the session that
	 * caused it, naming the nodes, instead of later in a terminal.
	 */
	export async function exportR(opts) {
		try {
			const session = JSON.parse(outputCoreAsJson());
			const report = checkRSupport(session);
			if (!report.ok) {
				addNotification(`Cannot export this session as R. ${explainRSupport(report)}`);
				return;
			}
			const mod = await loadRExporter();
			const files = exportFilesFrom(
				mod,
				session,
				opts,
				'buildRScript',
				'buildRExportFiles',
				'session.R'
			);
			const delivered = deliverExportFiles(files, 'session_R.zip', 'text/x-r-source');
			const entry = opts?.split === true ? 'analysis.R' : 'session.R';
			addNotification(
				`Exported ${delivered}. Run ${entry} with Rscript (needs no extra packages).`,
				'info'
			);
		} catch (error) {
			console.error('Failed to export R:', error?.message ?? error);
			addNotification('Error exporting R: ' + (error?.message ?? error));
		}
	}

	/**
	 * Canvas node ids are STRINGS (`note_3`, `group_2`, composite ids), and every
	 * selection predicate on the canvas calls `.startsWith` on them. The app itself
	 * always mints strings, but a session written outside the app (script- or
	 * AI-built) can carry a bare number here — and a numeric note id in a canvas
	 * selection crashed the first click after load ("ue.startsWith is not a
	 * function", WorkflowEditor's COMPOSABLE predicate). Coerce at the load
	 * boundary, once, so `1` loads as the string "1" instead of being dropped or
	 * left to crash every call site: same pattern as normaliseFigureStyle below.
	 * `fallback` covers an id that is missing entirely (also foreign-file-only).
	 */
	function asNodeId(v, fallback) {
		return v == null ? fallback : String(v);
	}

	/** Yield once: flush Svelte updates AND give the browser a frame to
	 *  repaint (so the spinner stays visually responsive). */
	async function yieldFrame() {
		await tick();
		await new Promise((r) => requestAnimationFrame(() => r()));
	}

	// One load at a time: two interleaved builds would each empty `core` under the other.
	let loadInFlight = false;

	/** Let the effects a load (or a rollback) set off run, so their writes land inside it. */
	async function settle() {
		await tick();
		await new Promise((r) => setTimeout(r, 0));
		await tick();
	}

	/**
	 * Load a parsed session into `core`, replacing the open one. The ONLY session-load entry
	 * point: the URL load, the start screen, the load modal, the classroom tours and drag-drop
	 * all call it, so the guarantees below hold everywhere.
	 *
	 * All or nothing (review ROB-1). A value that is not a session throws NotASessionError before
	 * anything changes. A session that fails half way through its build is rolled back: the
	 * previous session's objects are put back by identity, so the user keeps exactly what they
	 * had. Nothing here asks the user; entry points confirm first (confirmReplaceSession).
	 *
	 * History (ROB-2, ROB-17). The open session's undo stack cannot apply to the incoming one (ids
	 * restart, so its ops would hit unrelated nodes), so it is cleared when the load succeeds, and
	 * undo, redo and recording are off while the load runs, which also keeps the load's own writes
	 * off the stack. A failed load leaves the stack as it was, matching the restored session.
	 *
	 * Plots that cannot be rebuilt (ROB-10) are reported, and their saved JSON is kept in
	 * `core.unrestoredPlots`, which is saved with the session, so a re-save cannot delete them
	 * and a later version that understands them restores them.
	 */
	export async function importJson(jsonData, onProgress) {
		const problem = sessionShapeProblem(jsonData);
		if (problem) throw new NotASessionError(problem);
		if (loadInFlight) {
			throw new Error('Another session is still loading. Wait for it to finish, then try again.');
		}
		loadInFlight = true;
		history.beginLoad();
		const snap = snapshotSession();
		try {
			const report = await buildSession(jsonData, onProgress);
			await settle();
			// A note never opens on top of a plot (UI-7): notes that cover one get a lane above the
			// plots. After the settle, so facet panels (derived from loaded columns) count too.
			clearNotesFromPlots();
			paramDiffWatcher.rebaseSnapshot();
			history.clear();
			// What is open now is exactly a file the user has: not unsaved work (ROB-5).
			markSessionSaved();
			reportLoad(jsonData, report);
		} catch (err) {
			restoreSession(snap);
			// The build may have bumped the id counters past the incoming session's ids; re-sync to
			// what is actually open. Cached results were cleared for the incoming session, and the
			// restored nodes recompute into a fresh memo.
			syncNodeIdCounters();
			memoClear();
			await settle();
			paramDiffWatcher.rebaseSnapshot();
			throw err;
		} finally {
			history.endLoad();
			loadInFlight = false;
		}
	}

	/** The warnings a successful load owes the user. */
	function reportLoad(jsonData, report) {
		const failed = report.unrestoredPlots;
		if (failed.length > 0) {
			const types = [...new Set(failed.map((p) => p?.type ?? 'unknown'))].join(', ');
			const n = failed.length;
			addNotification(
				`${n} plot${n === 1 ? '' : 's'} could not be restored (type: ${types}). ` +
					`${n === 1 ? 'It is' : 'They are'} kept in the session and will be saved with it, ` +
					`so nothing is lost if you save.`,
				'warning',
				0
			);
		}
		if (compareAppVersions(jsonData.version, appConsts.version) > 0) {
			addNotification(
				`This session was saved by a newer version of AnCiR (${jsonData.version}; this is ` +
					`${appConsts.version}). Parts of it may not load, and re-saving here may drop ` +
					`settings this version does not know about.`,
				'warning',
				0
			);
		}
	}

	async function buildSession(jsonData, onProgress) {
		// Legacy facet CHILD plots (sessions saved before facets became views) fold into their
		// generator here, before anything is built: axis limits become per-panel overrides,
		// actogram markers move onto the generator's series, anything else is reported. The
		// ONLY session-load entry point is this function (the URL load, the start screen, the
		// load modal, the classroom tours and drag-drop all call it), so every path migrates.
		// One warning per generator, so a session with 12 panels raises one toast, not 12.
		{
			const migrated = migrateFacetChildren(jsonData, {
				childDefaults: childDefaultsFromRegistry(appConsts.plotMap)
			});
			jsonData = migrated.json;
			for (const w of migrated.warnings) addNotification(w, 'warning', 0);
		}
		// Stored values that came from actogram marker blocks (plan 2026-09-30 marker rules,
		// 5.2): the blocks no longer publish them. One that a formula or another consumer
		// USES is re-pointed at its marker rule's output column where one exists, or kept as
		// its saved number and reported; unused ones (registered just by opening a block) go.
		// After the facet migration, which may move blocks onto a generator's series.
		{
			const migrated = migratePhaseMarkerStoredValues(jsonData);
			jsonData = migrated.json;
			for (const w of migrated.warnings) addNotification(w, 'warning', 0);
		}
		// Enright Periodogram series from before v81, whose Bin Size control was hidden, sat at a
		// 0.25 h nobody chose: they now follow their x (the median sampling interval), as a new
		// series does (enrightBinMigration.js). After the facet migration, which may move series.
		jsonData = migrateLegacyEnrightBins(jsonData).json;
		// A free-period fit saved while following a time x at the old 1 to 48 h keeps that range
		// (new nodes on a time x start at 1 to 30 h from v82.30; periodRangeAuto.svelte.js).
		jsonData = migrateLegacyAutoPeriodRange(jsonData).json;
		// Data View plots (removed in v82.0) become the Table the same button opens today: a
		// "Plot's computed data" Table, or a "Node results" Table on the node's result table
		// (dataViewMigration.js). Same ids, so layout and reference edges carry over; a view
		// whose table cannot be identified keeps its rows as a frozen snapshot, one toast each.
		{
			const migrated = migrateDataViews(jsonData);
			jsonData = migrated.json;
			for (const w of migrated.warnings) addNotification(w, 'warning', 0);
		}
		// Empty the open session: every core slice and the compute memo (node ids restart from 1
		// in the incoming session, so a cached result from the previous one would be served to an
		// unrelated node). Must happen before the new nodes mount. Everything below then RESTORES
		// slices from the JSON; a slice the file lacks stays at its fresh value (nodeLayout empty
		// means nodes fall back to default/topo layout).
		resetSession();
		// Plots whose saved JSON could not be rebuilt; kept verbatim (see importJson).
		core.unrestoredPlots = [];
		// From here on the session's top level is read through a tracking view: whatever this
		// load never reads is a field this version does not know, kept on core.unknownFields and
		// written back by outputCoreAsJson (ROB-22, unknownFields.js). After the migrations
		// above, which rewrite what they migrate.
		const topLevel = trackReads(jsonData);
		jsonData = topLevel.view;
		// Provenance travels with the session: carried onto core so a re-export keeps it, which
		// is what makes an AI-built session a user sends back traceable to the request that
		// built it. Reset first — otherwise importing a human session over an AI one would
		// leave the previous session's fingerprint attached to it.
		core.generatedBy =
			jsonData.generatedBy && typeof jsonData.generatedBy === 'object'
				? { ...jsonData.generatedBy }
				: null;
		// Chained wires: cleared by resetSession above; restored AFTER the plots are rebuilt
		// below. reconcileChainRefs prunes entries whose via-plot is missing, so restoring
		// while core.plots is still empty would wipe them mid-import.
		// Per-column series colours. Cleared before the new plots are built so a series
		// cannot inherit the previous session's colour for an unrelated column id, then
		// restored below (absent in sessions saved before this existed, which simply
		// claim fresh colours as their plots are constructed).
		// Migrated, not spread: entries used to be a plain '#rrggbb' and are now
		// { slot } (follows the palette) or { hex } (locked). migrateSeriesColourMap
		// converts a legacy hex to a slot only when that hex is actually in the active
		// palette, and locks it otherwise — a hex it cannot place was either
		// user-chosen or assigned under a different palette, and re-mapping it would
		// change a saved figure's colours.
		// One merged appearance record per column, folding the three v72.1 maps. The
		// legacy fields are still read so a v72.1 session loads, but are no longer
		// written; see plots/appearanceIdentity.js.
		core.seriesAppearance = migrateAppearanceMaps(
			jsonData.seriesAppearance,
			jsonData.seriesColours,
			jsonData.seriesShapes,
			jsonData.seriesDashes
		);
		// The three v72.1 maps are READ above, to migrate, and then dropped: they are no
		// longer part of core. Keeping them would mean two sources of truth for what a
		// column looks like, which is exactly how monochrome came to be one-way.
		// Per-category colours, same shape and same reason to migrate rather than spread.
		core.categoryColours = migrateCategoryColourMap(jsonData.categoryColours);
		// Each colormap plot's pre-monochrome colour map, keyed by plot id (seriesAppearance.js).
		// Saved with the session but was never read back, so a reloaded monochrome session forgot
		// what to restore, and the previous session's entries stayed attached to whichever new
		// plots reused their ids. Replaced, not merged, for that reason; only string values count.
		core.plotColormaps = Object.fromEntries(
			Object.entries(
				jsonData.plotColormaps && typeof jsonData.plotColormaps === 'object'
					? jsonData.plotColormaps
					: {}
			).filter(([, v]) => typeof v === 'string')
		);
		// Figure style template. Normalised rather than spread: a session file is data
		// from outside the app, and one saved by an older version is missing whatever
		// fields did not exist yet. normaliseFigureStyle fills those from the registry
		// defaults and rejects any value of the wrong type or outside its enum, so a
		// hand-edited or stale session cannot put the style into a state the plots
		// cannot render.
		//
		// Absent entirely (every session saved before this existed) gets the
		// transitional default rather than the registry default, so an old session's
		// figures look exactly as they did instead of shrinking to the journal step.
		// See TRANSITIONAL_PT. Must be set BEFORE the plots are rebuilt below, because
		// each Plot copies this template in its constructor.
		core.figureStyle = jsonData.figureStyle
			? normaliseFigureStyle(jsonData.figureStyle)
			: transitionalFigureStyle();
		// The NAME of the figure-style preset this session was styled with. Reset
		// explicitly, exactly as figureStyle is above: importing a session that carries no
		// name must not leave the previous session's name attached to it.
		//
		// Displayed, never applied. Applying the named style here would override what this
		// session actually saved, which is the one trap the style-config spec calls out.
		core.activeStyleName =
			typeof jsonData.activeStyleName === 'string' && jsonData.activeStyleName
				? jsonData.activeStyleName
				: null;
		// Stored values: the previous session's registry was cleared by resetSession; restore
		// from the JSON. Ref entries (metric-port refs) come back live; getter-based
		// entries (StoreValueButton) resolve to their exported static snapshot;
		// the live getter re-registers when its node's editor next mounts.
		if (jsonData.storedValues && typeof jsonData.storedValues === 'object') {
			for (const [name, entry] of Object.entries(jsonData.storedValues)) {
				if (!entry || typeof entry !== 'object') continue;
				core.storedValues[name] = {
					source: entry.source ?? '',
					...(entry.ref && typeof entry.ref === 'object' ? { ref: { ...entry.ref } } : {}),
					// Identity key: the value's button claims this snapshot back on mount.
					...(typeof entry.key === 'string' && entry.key ? { key: entry.key } : {}),
					staticValue: entry.staticValue
				};
			}
		}

		const dataEntries = Array.isArray(jsonData?.data) ? jsonData.data : [];
		const columnCount = jsonData?.rawData
			? Object.keys(jsonData.rawData).length
			: dataEntries.length;

		if (onProgress) onProgress(`Loading ${columnCount} columns…`);
		await yieldFrame();

		// Build the rawData Map once, then push all columns in one synchronous
		// sweep. Yielding inside the loop just causes per-column re-renders.
		if (!jsonData.rawData) {
			//legacy support for rawData as array
			core.rawData = new Map(
				Object.entries($state.snapshot(jsonData.data)).map(([, data]) => [
					Number(data.id),
					data.data
				])
			);
			for (const cd of dataEntries) pushObj(Column.fromJSON(cd));
			for (let i = 0; i < core.data.length; i++) {
				core.data[i].data = Array.isArray(core.data[i].data) ? core.data[i].id : -1;
			}
		} else {
			core.rawData = new Map(
				Object.entries($state.snapshot(jsonData.rawData)).map(([key, value]) => [+key, value])
			);
			for (const cd of dataEntries) pushObj(Column.fromJSON(cd));
		}

		// Re-link shared args for linked processes after deserialization
		relinkLinkedProcessArgs();

		// New sessions persist groups + free TPs directly. Rehydrate those
		// before processing any legacy tables.
		if (Array.isArray(jsonData.groups)) {
			// Groups, composites and notes keep the fields this version does not read (ROB-22).
			for (const saved of jsonData.groups) {
				core.groups.push(
					loadKeepingUnknown(saved, (g) => ({
						id: asNodeId(g.id, `group_${core.groups.length}`),
						name: g.name ?? 'Group',
						x: g.x ?? 80,
						y: g.y ?? 80,
						width: g.width ?? 240,
						height: g.height ?? 180,
						sourceColumnIds: Array.isArray(g.sourceColumnIds) ? [...g.sourceColumnIds] : [],
						allColumnIds: Array.isArray(g.allColumnIds) ? [...g.allColumnIds] : null,
						collapsed: g.collapsed === true,
						rowState: g.rowState ?? {}
					}))
				);
			}
		}
		if (Array.isArray(jsonData.composites)) {
			for (const saved of jsonData.composites) {
				core.composites.push(
					loadKeepingUnknown(saved, (c) => {
						const compId = asNodeId(c.id, `composite_${core.composites.length}`);
						return {
							id: compId,
							name: c.name ?? 'Composite',
							x: c.x ?? 80,
							y: c.y ?? 80,
							collapsed: c.collapsed !== false,
							originId: asNodeId(c.originId, compId),
							memberIds: Array.isArray(c.memberIds) ? [...c.memberIds] : [],
							interface: {
								inputs: Array.isArray(c.interface?.inputs) ? [...c.interface.inputs] : [],
								outputs: Array.isArray(c.interface?.outputs) ? [...c.interface.outputs] : []
							}
						};
					})
				);
			}
		}
		if (Array.isArray(jsonData.notes)) {
			for (const saved of jsonData.notes) {
				core.notes.push(
					loadKeepingUnknown(saved, (n) => ({
						id: asNodeId(n.id, `note_${core.notes.length}`),
						text: n.text ?? '',
						x: n.x ?? 80,
						y: n.y ?? 80,
						width: n.width ?? 200,
						height: n.height ?? 120
					}))
				);
			}
		}
		if (jsonData.nodeNotes && typeof jsonData.nodeNotes === 'object') {
			core.nodeNotes = { ...jsonData.nodeNotes };
		}
		// Workflow-canvas layout (positions + collapsed). A fresh object identity
		// signals WorkflowEditor to adopt it (overriding any stale per-browser
		// localStorage positions for the same node ids).
		if (jsonData.nodeLayout && typeof jsonData.nodeLayout === 'object') {
			core.nodeLayout = { ...jsonData.nodeLayout };
		}
		if (Array.isArray(jsonData.tableProcesses)) {
			for (const tp of jsonData.tableProcesses) {
				core.tableProcesses.push(TableProcess.fromJSON(tp));
			}
		}

		// Legacy: convert each saved `tables[]` into a Group node + free TPs.
		// The Group's sources = columns from columnRefs that AREN'T outputs of
		// any of this table's processes (i.e. the original sources only).
		// TableProcesses migrate to core.tableProcesses with parent = null.
		// Table.svelte is gone (Phase D), so we parse the legacy shape inline.
		const totalTables = jsonData.tables?.length ?? 0;
		for (let i = 0; i < totalTables; i++) {
			if (onProgress) onProgress(`Migrating legacy table ${i + 1} of ${totalTables}…`);
			await yieldFrame();
			const legacy = jsonData.tables[i];
			const tableId = legacy.id ?? legacy.tableid ?? i;
			const tableName = legacy.name ?? `Table ${tableId}`;
			const columnRefs = Array.isArray(legacy.columnRefs) ? legacy.columnRefs : [];

			// 1. Reconstitute each TableProcess as free-standing.
			const newTPs = [];
			for (const procJson of legacy.processes ?? []) {
				try {
					newTPs.push(new TableProcess(procJson, null, procJson.id));
				} catch (e) {
					console.warn('Failed to migrate legacy TableProcess', procJson, e);
				}
			}

			// 2. Collect TP-output column ids (these are NOT sources).
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local lookup of TP output column ids, built and consumed inside this import function; never read reactively
			const tpOutIds = new Set();
			for (const tp of newTPs) {
				for (const cid of Object.values(tp.args?.out ?? {})) {
					if (typeof cid === 'number' && cid >= 0) tpOutIds.add(cid);
				}
			}

			// 3. Build a Group with the table's original source columns.
			const sources = columnRefs.filter((cid) => !tpOutIds.has(cid));
			if (sources.length > 0 || newTPs.length === 0) {
				core.groups.push({
					id: `group_legacy_${tableId}`,
					name: tableName,
					x: 80 + i * 40,
					y: 80 + i * 40,
					width: 240,
					height: 180,
					sourceColumnIds: sources,
					allColumnIds: null,
					collapsed: false,
					rowState: {}
				});
			}

			// 4. Push the migrated TPs into the free store.
			for (const tp of newTPs) core.tableProcesses.push(tp);
		}

		// Loaded notes/groups/composites were pushed directly (not via create*),
		// so bump the id counters past them; otherwise the next created node can
		// mint a colliding id and overwrite a loaded one.
		syncNodeIdCounters();

		// Plots: yield between each push so the canvas re-render is split
		// across frames. A single batched push freezes the compositor (and the
		// spinner) for the entire build, which is what we want to avoid here.
		//
		// That yield lets Svelte effects run mid-loop, so the whole id space is claimed FIRST:
		// anything that mints a plot mid-load (nothing does today; facet panels are derived, not
		// minted) cannot take an id belonging to a plot further down the file.
		// Plots an earlier load could not rebuild ride along in `unrestoredPlots`; they are tried
		// again here, so a version that understands them brings them back.
		const plotJsons = [
			...(jsonData.plots ?? []),
			...(Array.isArray(jsonData.unrestoredPlots) ? jsonData.unrestoredPlots : [])
		];
		const totalPlots = plotJsons.length;
		reservePlotIds(plotJsons.map((p) => p?.id));
		for (let i = 0; i < totalPlots; i++) {
			if (onProgress) onProgress(`Rebuilding plot ${i + 1} of ${totalPlots}…`);
			await yieldFrame();
			// Isolate each plot: a single malformed plot must not hang or abort the
			// whole load. It is skipped, reported, and its JSON kept so a save preserves it.
			try {
				pushObj(Plot.fromJSON(plotJsons[i]), false);
			} catch (e) {
				console.error(`Failed to rebuild plot ${i + 1} of ${totalPlots}; skipping.`, e);
				core.unrestoredPlots.push(JSON.parse(JSON.stringify(plotJsons[i] ?? null)));
			}
		}

		// Chained wires (plot passthrough → consumer): restore now that both the
		// plots and the table processes exist, so the reconcile keeps the entries.
		core.chainRefs = Array.isArray(jsonData.chainRefs)
			? jsonData.chainRefs.map((e) => ({ ...e }))
			: [];

		// Prewarm wrapper-column customName so reading `name` later (e.g. inside
		// `_safeJson` while building the workflow graph cache key) doesn't enter
		// the mutating branch of the $derived. Without this, dev-mode trips
		// state_unsafe_mutation inside `getProcessNodeGraph` and the canvas
		// silently shows no edges. Mirrors generateDemos.svelte.test.js.
		for (const plot of core.plots) {
			const entry = appConsts.plotMap.get(plot.type);
			const fields = ['x', 'y', 'z', ...(entry?.defaultInputs ?? [])];
			for (const series of plot.plot?.data ?? []) {
				for (const f of fields) {
					const w = series?.[f];
					if (w && typeof w === 'object' && 'refId' in w && w.customName == null) {
						const real = core.data.find((c) => c.id === w.refId);
						w.customName =
							(real ? `${real.name}` : 'col') +
							(typeof w.refId === 'number' && w.refId >= 0 ? '' : '');
					}
				}
			}
		}

		// Orphan column-processes (unconnected, spawned via palette/paste).
		// Rehydrated as Process instances with parentCol = null so the canvas
		// re-renders them; the user re-wires after load.
		const orphanSnapshots = Array.isArray(jsonData.orphanProcesses) ? jsonData.orphanProcesses : [];
		if (orphanSnapshots.length > 0) {
			core.orphanProcesses = orphanSnapshots
				.map((p) => {
					try {
						return Process.fromJSON(p, null);
					} catch (e) {
						console.warn('Failed to rehydrate orphan process', p, e);
						return null;
					}
				})
				.filter(Boolean);
		}

		// Phase 4: migrate any legacy inline column processes into the dataflow
		// model (free nodes + producer columns). Idempotent — a no-op for sessions
		// already in the node model; conservative for TP-output / tap columns.
		try {
			const { migrated } = migrateAllInlineProcesses();
			if (migrated > 0 && onProgress) {
				onProgress(`Migrating ${migrated} column pipeline${migrated === 1 ? '' : 's'} to nodes…`);
			}
		} catch (e) {
			console.warn('Inline-process migration failed', e);
		}

		if (jsonData.appState) {
			if (onProgress) onProgress('Restoring settings…');
			await yieldFrame();
			loadAppState(jsonData.appState);
		}
		// Signal both canvases to adopt the session's restored viewport, even if a
		// component is already mounted (e.g. loading while on the workflow view).
		// Bumped unconditionally: a legacy session with no saved viewport restores
		// the appState defaults, which is the correct "reset" behaviour.
		appState.viewportEpoch = (appState.viewportEpoch ?? 0) + 1;
		// Once its nodes have rendered, the workflow canvas moves apart any that overlap
		// (a saved or baked layout cannot know how tall an expanded node will draw).
		appState.settleLayoutRequest = (appState.settleLayoutRequest ?? 0) + 1;

		// The top-level fields this load never read (ROB-22). `version` is read by the save,
		// which writes the running version, so it is never kept.
		// Only a session that has some gets the key (resetSession removed any earlier one).
		void jsonData.version;
		const unknownTopLevel = topLevel.unread();
		if (unknownTopLevel.length > 0) core.unknownFields = Object.fromEntries(unknownTopLevel);

		// hoursSinceStart is already pre-computed in pushObj; no second pass.
		if (onProgress) onProgress('Finalising…');
		await yieldFrame();
		return { unrestoredPlots: [...core.unrestoredPlots] };
	}
</script>

<script>
	// @ts-nocheck
	import { core, pushObj, loadAppState, syncNodeIdCounters } from '$lib/core/core.svelte';
	import { Column, relinkLinkedProcessArgs } from '$lib/core/Column.svelte';
	import { TableProcess } from '$lib/core/TableProcess.svelte';
	import { Plot, reservePlotIds } from '$lib/core/Plot.svelte';
	import { Process } from '$lib/core/Process.svelte';
	import { migrateAllInlineProcesses } from '$lib/core/dataflowMigration.js';
	import { memoClear } from '$lib/core/computeMemo.js';
	import { tick } from 'svelte';

	import Dropdown from '$lib/components/reusables/Dropdown.svelte';
	import Settings from '../views/modals/Settings.svelte';

	let showSettingsModal = $state(false);

	let { showDropdown = $bindable(false), dropdownTop = 0, dropdownLeft = 0 } = $props();
</script>

<Dropdown bind:showDropdown top={dropdownTop} left={dropdownLeft}>
	{#snippet groups()}
		<div class="action">
			<button type="button" onclick={() => exportJson()}>Save session</button>
		</div>

		<div class="action">
			<button type="button" onclick={() => (showSettingsModal = true)}>Settings</button>
		</div>
	{/snippet}
</Dropdown>

<Settings bind:showModal={showSettingsModal} />

<style>
	.action button {
		margin: 0.6em;
		font-size: var(--font-lg);
	}

	.action:hover {
		background-color: var(--color-lightness-95);
	}

	button {
		background-color: transparent;
		border: none;
		text-align: inherit;
		font: inherit;
		border-radius: 0;
		appearance: none;
		cursor: pointer;
	}
</style>
