<script module>
	import { appConsts, outputCoreAsJson } from '$lib/core/core.svelte';
	import { addNotification } from '$lib/core/notifications.svelte.js';
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

	/** Yield once: flush Svelte updates AND give the browser a frame to
	 *  repaint (so the spinner stays visually responsive). */
	async function yieldFrame() {
		await tick();
		await new Promise((r) => requestAnimationFrame(() => r()));
	}

	export async function importJson(jsonData, onProgress) {
		//reset existing workflow
		core.data = [];
		core.tableProcesses = [];
		core.plots = [];
		core.groups = [];
		core.composites = [];
		core.notes = [];
		core.nodeNotes = {};
		// Orphan processes are session-only; clear on import so the next
		// block can rehydrate them from the JSON if present.
		core.orphanProcesses = [];

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

		// Plots: yield between each push so the canvas re-render is split
		// across frames. A single batched push freezes the compositor (and the
		// spinner) for the entire build, which is what we want to avoid here.
		const totalPlots = jsonData.plots?.length ?? 0;
		for (let i = 0; i < totalPlots; i++) {
			if (onProgress) onProgress(`Rebuilding plot ${i + 1} of ${totalPlots}…`);
			await yieldFrame();
			pushObj(Plot.fromJSON(jsonData.plots[i]), false);
		}

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

		if (jsonData.appState) {
			if (onProgress) onProgress('Restoring settings…');
			await yieldFrame();
			loadAppState(jsonData.appState);
		}

		// hoursSinceStart is already pre-computed in pushObj; no second pass.
		if (onProgress) onProgress('Finalising…');
		await yieldFrame();
	}
</script>

<script>
	// @ts-nocheck
	import { core, pushObj, loadAppState } from '$lib/core/core.svelte';
	import { Column, relinkLinkedProcessArgs } from '$lib/core/Column.svelte';
	import { TableProcess } from '$lib/core/TableProcess.svelte';
	import { Plot } from '$lib/core/Plot.svelte';
	import { Process } from '$lib/core/Process.svelte';
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
		font-size: 14px;
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
