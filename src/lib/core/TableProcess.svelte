<script module>
	import { appState, appConsts, pushObj, core } from '$lib/core/core.svelte.js';
	import { getTableById } from '$lib/core/Table.svelte';
	import { removeColumnFromPlots } from '$lib/core/Plot.svelte';
	import { Column, removeColumn, getColumnById } from '$lib/core/Column.svelte';
	let _tableprocessidCounter = 0;

	function doDeleteTableProcess(p) {
		appState.AYStext = `Are you sure you want to delete process ${p.name}? This will also delete any output columns created by this process.`;
		appState.AYScallback = function handleAYS(option) {
			if (option === 'Yes') {
				deleteTableProcess(p);
			}
		};
		appState.showAYSModal = true;
	}

	export function deleteTableProcess(tableProcess) {
		if (!tableProcess || !tableProcess.parent) {
			return {
				success: false,
				message: 'Invalid table process provided'
			};
		}

		const removedColumns = [];
		const affectedProcesses = [];

		// Step 1: Collect all output columns to remove
		const outputColumnIds = Object.keys(tableProcess.args.out)
			.map((outKey) => tableProcess.args.out[outKey])
			.filter((id) => id >= 0);

		// Step 2: Remove each output column and its dependencies
		outputColumnIds.forEach((colID) => {
			removedColumns.push(colID);

			// Step 2a: Remove from plots/tables that display them
			removeColumnFromPlots(colID);

			// Step 2b: Remove from input references in other table processes
			core.tables.forEach((table, tableIdx) => {
				table.processes.forEach((process, processIdx) => {
					// Check all argument keys for references to this column
					Object.keys(process.args).forEach((argKey) => {
						// Only process input arguments (ending with 'IN')
						if (argKey.slice(-2) === 'IN') {
							if (typeof process.args[argKey] === 'object') {
								// Array input (e.g., xsIN) - filter out the column
								const before = process.args[argKey].length;
								process.args[argKey] = process.args[argKey].filter((id) => id !== colID);
								if (before !== process.args[argKey].length) {
									affectedProcesses.push({
										processId: process.id,
										processName: process.name,
										argument: argKey
									});
								}
							} else if (process.args[argKey] === colID) {
								// Single input (e.g., xIN, yIN) - set to -1
								process.args[argKey] = -1;
								affectedProcesses.push({
									processId: process.id,
									processName: process.name,
									argument: argKey
								});
							}
						}
					});
				});
			});

			// Step 2c: Remove from table's column references
			const tableIdx = core.tables.findIndex((t) => t.id === tableProcess.parent.id);
			if (tableIdx >= 0) {
				core.tables[tableIdx].columnRefs = core.tables[tableIdx].columnRefs.filter(
					(cr) => cr !== colID
				);
			}

			// Step 2d: Remove columns that reference this column (break dependency chain)
			const dependentColumns = core.data.filter((col) => col.refId === colID);
			dependentColumns.forEach((depCol) => {
				depCol.refId = -1; // Break the reference
			});

			// Step 2e: Remove from internal column reference system
			removeColumn(colID);

			// Step 2f: Remove from core data completely
			core.data = core.data.filter((c) => c.id !== colID);
		});

		// Step 2g: Remove output columns from any sub-TPs in args.tableProcesses
		for (const subTP of tableProcess.args?.tableProcesses ?? []) {
			for (const colId of Object.values(subTP.args?.out ?? {})) {
				if (colId != null && colId >= 0) {
					removeColumnFromPlots(colId);
					const tableIdx = core.tables.findIndex((t) => t.id === tableProcess.parent.id);
					if (tableIdx >= 0) {
						core.tables[tableIdx].columnRefs = core.tables[tableIdx].columnRefs.filter(
							(cr) => cr !== colId
						);
					}
					removeColumn(colId);
					core.data = core.data.filter((c) => c.id !== colId);
				}
			}
		}

		// Step 3: Remove the table process itself from the parent table
		const parentTable = getTableById(tableProcess.parent.id);
		parentTable.processes = parentTable.processes.filter((tp) => tp.id !== tableProcess.id);

		// Step 4: Clear refTPId on any TP that chained from the deleted one
		core.tables.forEach((table) => {
			table.processes.forEach((tp) => {
				if (tp.refTPId === tableProcess.id) {
					tp.refTPId = null;
				}
			});
		});

		return {
			success: true,
			processId: tableProcess.id,
			processName: tableProcess.name,
			removedOutputColumns: removedColumns.length,
			affectedInputReferences: affectedProcesses.length,
			affectedProcesses: affectedProcesses,
			message: `Table process "${tableProcess.name}" safely removed. ${removedColumns.length} output column(s) deleted. ${affectedProcesses.length} other process(es) had input references cleaned up.`
		};
	}

	export class TableProcess {
		id; //Unique Id
		name = '';
		displayName = $state('');
		args = $state({});
		refTPId = $state(null);

		constructor({ ...dataIN }, parent, id = null) {
			if (id === null) {
				this.id = id ?? _tableprocessidCounter;
				_tableprocessidCounter++;
			} else {
				this.id = id;
				_tableprocessidCounter = Math.max(id + 1, _tableprocessidCounter + 1);
			}

			this.parent = parent;

			this.name = dataIN.name;
			this.refTPId = dataIN.refTPId ?? null;

			// Honor a persisted/user-edited displayName when present; otherwise fall
			// back to the default from tableProcessMap.
			const tableProcessInfo = appConsts.tableProcessMap.get(this.name);
			this.displayName =
				dataIN.displayName || tableProcessInfo?.displayName || this.name;

			//If there is a column out ref set (i.e. reading from JSON)
			if (dataIN.args.out[Object.keys(dataIN.args.out)[0]] >= 0) {
				this.args = dataIN.args;
			}
			//If the out refs are not yet defined (i.e. creating new)
			else if (dataIN.args) {
				this.args = dataIN.args;
				//MAKE THE OUTPUTS (defined in the defaults with 'OUT') AND ASSOCIATE THEM
				// Use this.parent directly — getTableById fails when loading from JSON
				// because the table isn't yet in core.tables at construction time.
				const theTable = this.parent ?? getTableById(this.parent.id);
				const processHash = crypto.randomUUID();

				for (let i = 0; i < Object.keys(this.args.out).length; i++) {
					//Create a new column with the given name and assign it a tableProcessGUId
					const tempCol = new Column({});
					tempCol.name = Object.keys(this.args.out)[i] + '_' + this.id;
					//now put that column ID in the out
					this.args.out[Object.keys(this.args.out)[i]] = tempCol.id;
					pushObj(tempCol); // add the column to core
					theTable.columnRefs = [tempCol.id, ...theTable.columnRefs]; //add to table
				}

				//--------------------------
				// - now run the process
				appConsts.tableProcessMap.get(this.name).func(this.args);
				//--------------------------
			}
		}

		toJSON() {
			return {
				id: this.id,
				name: this.name,
				displayName: this.displayName,
				args: this.args,
				refTPId: this.refTPId
			};
		}
	}
</script>

<script>
	import ChainedPanel from '$lib/components/reusables/ChainedPanel.svelte';
	import TableProcessShell from '$lib/core/TableProcessShell.svelte';
	import { untrack } from 'svelte';
	let { p = $bindable() } = $props();

	// Derive the tableProcessMap entry for this TP
	const entry = $derived(appConsts.tableProcessMap.get(p?.name));

	// A TP is chainable when it exports xOutKey (BinnedData, Cosinor, etc.)
	// CollectColumns and LongToWide manage sub-TPs internally, so they are excluded.
	const isChainable = $derived(entry?.xOutKey != null);

	// The parent's x-output column ID (seeded into child sub-TP xIN)
	const xOutColId = $derived.by(() => {
		if (!isChainable) return -1;
		return p.args?.out?.[entry.xOutKey] ?? -1;
	});

	// All of the parent's y-output column IDs (seeded into child sub-TP yIN)
	const yOutColIds = $derived.by(() => {
		if (!isChainable || !entry.yOutKeyPrefix) return [];
		return Object.entries(p.args?.out ?? {})
			.filter(([key]) => key.startsWith(entry.yOutKeyPrefix))
			.map(([, colId]) => colId)
			.filter((id) => typeof id === 'number' && id >= 0);
	});

	// --- refTPId chaining ---

	// Find the upstream TP that this one chains from
	const refTP = $derived.by(() => {
		if (p?.refTPId == null) return null;
		for (const table of core.tables) {
			for (const tp of table.processes) {
				if (tp.id === p.refTPId) return tp;
			}
		}
		return null;
	});

	const refTPEntry = $derived.by(() => (refTP ? appConsts.tableProcessMap.get(refTP.name) : null));

	// Sync this TP's xIN/yIN from the upstream TP's outputs whenever they change
	$effect(() => {
		if (!refTP || !refTPEntry) return;
		const xOutKey = refTPEntry.xOutKey;
		const yPrefix = refTPEntry.yOutKeyPrefix ?? '';
		const xId = refTP.args?.out?.[xOutKey] ?? -1;
		const yIds = Object.entries(refTP.args?.out ?? {})
			.filter(([k]) => k.startsWith(yPrefix))
			.map(([, id]) => id)
			.filter((id) => typeof id === 'number' && id >= 0);
		untrack(() => {
			p.args.xIN = xId;
			p.args.yIN = yIds;
		});
	});

	// Chainable TPs that appear BEFORE this TP in the same table
	const chainablePrecedingTPs = $derived.by(() => {
		if (!p?.parent) return [];
		const result = [];
		for (const tp of p.parent.processes) {
			if (tp.id === p.id) break;
			const tpEntry = appConsts.tableProcessMap.get(tp.name);
			if (tpEntry?.xOutKey) result.push(tp);
		}
		return result;
	});

	// Show chain selector only for TPs that have xIN/yIN inputs
	const showChainSelector = $derived('xIN' in (p?.args ?? {}));
</script>

{#if p}
	{@const TheTableProcess = appConsts.tableProcessMap.get(p.name)?.component}
	<TableProcessShell {p} onDelete={doDeleteTableProcess}>
		{#if showChainSelector && chainablePrecedingTPs.length > 0}
			<div class="chain-selector">
				<label for="chain-{p.id}">Chain from:</label>
				<select
					id="chain-{p.id}"
					value={p.refTPId ?? ''}
					onchange={(e) => {
						const val = e.target.value;
						p.refTPId = val === '' ? null : Number(val);
					}}
				>
					<option value="">— none —</option>
					{#each chainablePrecedingTPs as upstream}
						<option value={upstream.id}>{upstream.displayName} #{upstream.id}</option>
					{/each}
				</select>
			</div>
		{/if}
		<TheTableProcess bind:p hideInputs={p.refTPId != null} />
		{#if isChainable && p.args?.valid}
			<ChainedPanel bind:p {xOutColId} {yOutColIds} />
		{/if}
	</TableProcessShell>
{/if}

<style>
	.chain-selector {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		padding: 0.2rem 0.5rem;
		color: var(--text-muted, #888);
	}
	.chain-selector select {
		font-size: 0.8rem;
		padding: 0.1rem 0.25rem;
	}
</style>
