<script module>
	import { appConsts, appState, outputCoreAsJson } from '$lib/core/core.svelte';
	import { addNotification } from '$lib/core/notifications.svelte.js';
	import { loadPythonExporter, loadRExporter } from '$lib/utils/pythonExportLoader.js';
	import { checkRSupport, explainRSupport } from '$lib/utils/rExportSupport.js';
	import { normaliseFigureStyle, transitionalFigureStyle } from '$lib/plots/figureStyle.js';
	import {
		migrateSeriesColourMap,
		migrateCategoryColourMap
	} from '$lib/plots/seriesColour.js';
	export function exportJson() {
		try {
			// Get JSON string and validate
			const jsonStr = outputCoreAsJson();
			if (typeof jsonStr !== 'string' || !jsonStr) {
				throw new Error('Invalid or empty JSON string returned by outputCoreAsJson');
			}

			// Validate JSON content
			try {
				JSON.parse(jsonStr); // Ensure it's valid JSON
			} catch (e) {
				throw new Error('Invalid JSON format: ' + e.message);
			}

			// Create Blob with JSON content
			const blob = new Blob([jsonStr], { type: 'application/json' });
			const url = URL.createObjectURL(blob);

			// Create temporary <a> element
			const a = document.createElement('a');
			a.innerText = 'download';
			a.href = url;
			a.download = 'session.json'; // File name for download
			document.body.appendChild(a);

			// Programmatically trigger click
			a.click();

			// Clean up
			setTimeout(() => {
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
			}, 10); // Delay cleanup to ensure download starts
		} catch (error) {
			console.error('Failed to export JSON:', error.message);
			addNotification('Error exporting JSON: ' + error.message);
		}
	}

	// EXPERIMENTAL: export the current session as a self-contained Python script
	// (ports tools/ancir_to_python.py).
	//
	// The exporter and its ~198 KB Python runtime live in a SIDECAR file rather than in the
	// bundle. A `?raw` import used to look lazy but was not: the app inlines everything into
	// one index.html, so every visitor downloaded the runtime whether or not they ever
	// exported Python — about 7% of the page, raw and gzipped, for an experimental feature.
	// The sidecar may legitimately be absent (a single-file copy of AnCiR), so a failure to
	// load is reported as such instead of surfacing as an opaque error.
	export async function exportPython() {
		try {
			const session = JSON.parse(outputCoreAsJson());
			const { buildPythonScript } = await loadPythonExporter();
			const pySrc = buildPythonScript(session);

			const blob = new Blob([pySrc], { type: 'text/x-python' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'session.py';
			document.body.appendChild(a);
			a.click();
			setTimeout(() => {
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
			}, 10);
			addNotification(
				'Exported session.py — run it with Python (needs numpy, pandas, scipy).',
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
	export async function exportR() {
		try {
			const session = JSON.parse(outputCoreAsJson());
			const report = checkRSupport(session);
			if (!report.ok) {
				addNotification(`Cannot export this session as R. ${explainRSupport(report)}`);
				return;
			}
			const { buildRScript } = await loadRExporter();
			const rSrc = buildRScript(session);

			const blob = new Blob([rSrc], { type: 'text/x-r-source' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'session.R';
			document.body.appendChild(a);
			a.click();
			setTimeout(() => {
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
			}, 10);
			addNotification('Exported session.R — run it with Rscript (needs no extra packages).', 'info');
		} catch (error) {
			console.error('Failed to export R:', error?.message ?? error);
			addNotification('Error exporting R: ' + (error?.message ?? error));
		}
	}

	/** Yield once: flush Svelte updates AND give the browser a frame to
	 *  repaint (so the spinner stays visually responsive). */
	async function yieldFrame() {
		await tick();
		await new Promise((r) => requestAnimationFrame(() => r()));
	}

	export async function importJson(jsonData, onProgress) {
		//reset existing workflow
		// Node ids restart from 1 in the incoming session, so any cached compute
		// result from the previous one would be served to a completely unrelated
		// node. Must happen before the new nodes mount.
		memoClear();
		core.data = [];
		core.tableProcesses = [];
		core.plots = [];
		core.groups = [];
		core.composites = [];
		core.notes = [];
		core.nodeNotes = {};
		// Cleared here; restored from the JSON below (or left empty for legacy
		// sessions, in which case nodes fall back to default/topo layout).
		core.nodeLayout = {};
		// Orphan processes are session-only; clear on import so the next
		// block can rehydrate them from the JSON if present.
		core.orphanProcesses = [];
		// Provenance travels with the session: carried onto core so a re-export keeps it, which
		// is what makes an AI-built session a user sends back traceable to the request that
		// built it. Reset first — otherwise importing a human session over an AI one would
		// leave the previous session's fingerprint attached to it.
		core.generatedBy =
			jsonData.generatedBy && typeof jsonData.generatedBy === 'object'
				? { ...jsonData.generatedBy }
				: null;
		// Chained wires: cleared here; restored AFTER the plots are rebuilt below —
		// reconcileChainRefs prunes entries whose via-plot is missing, so restoring
		// while core.plots is still empty would wipe them mid-import.
		core.chainRefs = [];
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
		core.seriesColours = migrateSeriesColourMap(jsonData.seriesColours);
		// Per-category colours, same shape and same reason to migrate rather than spread.
		core.categoryColours = migrateCategoryColourMap(jsonData.categoryColours);
		// Pinned marker shapes and dashes. Plain string maps, so a shallow copy is
		// enough; absent in any session saved before they existed, which simply claim
		// fresh pins the first time a figure varies its markers.
		core.seriesShapes =
			jsonData.seriesShapes && typeof jsonData.seriesShapes === 'object'
				? { ...jsonData.seriesShapes }
				: {};
		core.seriesDashes =
			jsonData.seriesDashes && typeof jsonData.seriesDashes === 'object'
				? { ...jsonData.seriesDashes }
				: {};
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
		// Stored values: clear the previous session's registry, then restore from
		// the JSON. Ref entries (metric-port refs) come back live; getter-based
		// entries (StoreValueButton) resolve to their exported static snapshot —
		// the live getter re-registers when its node's editor next mounts.
		core.storedValues = {};
		if (jsonData.storedValues && typeof jsonData.storedValues === 'object') {
			for (const [name, entry] of Object.entries(jsonData.storedValues)) {
				if (!entry || typeof entry !== 'object') continue;
				core.storedValues[name] = {
					source: entry.source ?? '',
					...(entry.ref && typeof entry.ref === 'object' ? { ref: { ...entry.ref } } : {}),
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
				Object.entries($state.snapshot(jsonData.data)).map(([id, data]) => [
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
			for (const g of jsonData.groups) {
				core.groups.push({
					id: g.id,
					name: g.name ?? 'Group',
					x: g.x ?? 80,
					y: g.y ?? 80,
					width: g.width ?? 240,
					height: g.height ?? 180,
					sourceColumnIds: Array.isArray(g.sourceColumnIds) ? [...g.sourceColumnIds] : [],
					allColumnIds: Array.isArray(g.allColumnIds) ? [...g.allColumnIds] : null,
					collapsed: g.collapsed === true,
					rowState: g.rowState ?? {}
				});
			}
		}
		if (Array.isArray(jsonData.composites)) {
			for (const c of jsonData.composites) {
				core.composites.push({
					id: c.id,
					name: c.name ?? 'Composite',
					x: c.x ?? 80,
					y: c.y ?? 80,
					collapsed: c.collapsed !== false,
					originId: c.originId ?? c.id,
					memberIds: Array.isArray(c.memberIds) ? [...c.memberIds] : [],
					interface: {
						inputs: Array.isArray(c.interface?.inputs) ? [...c.interface.inputs] : [],
						outputs: Array.isArray(c.interface?.outputs) ? [...c.interface.outputs] : []
					}
				});
			}
		}
		if (Array.isArray(jsonData.notes)) {
			for (const n of jsonData.notes) {
				core.notes.push({
					id: n.id,
					text: n.text ?? '',
					x: n.x ?? 80,
					y: n.y ?? 80,
					width: n.width ?? 200,
					height: n.height ?? 120
				});
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
				core.tableProcesses.push(new TableProcess(tp, null, tp.id));
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
		// That yield is also why the whole id space has to be claimed FIRST: it lets Svelte
		// effects run mid-loop, and a faceted plot's reconcile mints children through the same
		// allocator. Without this, a child could take an id belonging to a plot further down the
		// file, leaving the workspace keying an {#each} on two plots with the same id.
		const totalPlots = jsonData.plots?.length ?? 0;
		reservePlotIds((jsonData.plots ?? []).map((p) => p?.id));
		for (let i = 0; i < totalPlots; i++) {
			if (onProgress) onProgress(`Rebuilding plot ${i + 1} of ${totalPlots}…`);
			await yieldFrame();
			// Isolate each plot: a single malformed plot must not hang or abort the
			// whole load — log and skip it so the rest of the session still opens.
			try {
				pushObj(Plot.fromJSON(jsonData.plots[i]), false);
			} catch (e) {
				console.error(`Failed to rebuild plot ${i + 1} of ${totalPlots}; skipping.`, e);
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

		// hoursSinceStart is already pre-computed in pushObj; no second pass.
		if (onProgress) onProgress('Finalising…');
		await yieldFrame();
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
		<div class="action" onclick={() => exportJson()}>
			<button>Save session</button>
		</div>

		<div
			class="action"
			onclick={() => {
				showSettingsModal = true;
			}}
		>
			<button>Settings</button>
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
