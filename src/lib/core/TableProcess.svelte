<script module>
	import { appState, appConsts, pushObj, core } from '$lib/core/core.svelte.js';
	import { removeColumnFromPlots, detachColumnSetFromPlot } from '$lib/core/Plot.svelte';
	import { Column, removeColumn, getColumnById } from '$lib/core/Column.svelte';
	import { setSelection } from '$lib/tableProcesses/columnSet.js';
	let _tableprocessidCounter = 0;

	// --- Live Column Set → table-process inputs --------------------------------
	// A Column Set wired to a table-process many-in port (e.g. Split's yIN) is
	// recorded in `tp.args.setRefs = { [port]: [columnSetId] }` (parallel to the
	// port's id array). These helpers materialise the sets' selected columns INTO
	// that id array and keep them in sync — so the node's compute, its column
	// picker, AND its output-column reconcile all see real columns, while the
	// canvas shows a single bundle wire. Ownership is by candidate membership, so
	// user-added (non-candidate) ids on the same port are preserved.

	/** Materialise every Column Set wired to a table-process into its ports. */
	export function syncTPSets(tp) {
		const setRefs = tp?.args?.setRefs;
		if (!setRefs) return;
		for (const port of Object.keys(setRefs)) {
			const { candidates, selected } = setSelection(setRefs[port]);
			const cur = Array.isArray(tp.args[port]) ? tp.args[port] : [];
			// Keep user ids (not owned by any wired set), then append the selection.
			const next = cur.filter((id) => typeof id === 'number' && id >= 0 && !candidates.has(id));
			for (const id of selected) if (!next.includes(id)) next.push(id);
			if (next.length !== cur.length || next.some((id, i) => id !== cur[i])) tp.args[port] = next;
		}
	}

	/** Reconcile every table-process that has a Column Set wired in. Idempotent. */
	export function reconcileAllTPSets() {
		for (const tp of core.tableProcesses ?? []) {
			const refs = tp.args?.setRefs;
			if (refs && Object.values(refs).some((a) => (a ?? []).length > 0)) syncTPSets(tp);
		}
	}

	/**
	 * Detach a Column Set from a table-process: strip the columns it materialised
	 * (its candidate columns as the ownership domain) from every many-in port and
	 * drop it from setRefs. `fallbackCandidates` covers the already-deleted case.
	 */
	export function detachColumnSetFromTP(tp, colsetId, fallbackCandidates = []) {
		const refs = tp?.args?.setRefs;
		if (!refs) return;
		const set = (core.tableProcesses ?? []).find((t) => t.id === colsetId);
		const cands = new Set(
			(set?.args?.colsIN ?? fallbackCandidates).filter((id) => typeof id === 'number' && id >= 0)
		);
		for (const port of Object.keys(refs)) {
			if (!(refs[port] ?? []).includes(colsetId)) continue;
			refs[port] = refs[port].filter((id) => id !== colsetId);
			if (Array.isArray(tp.args[port]))
				tp.args[port] = tp.args[port].filter((id) => !cands.has(id));
		}
	}

	function doDeleteTableProcess(p) {
		appState.AYStext = `Are you sure you want to delete process ${p.name}? This will also delete any output columns created by this process.`;
		appState.AYScallback = function handleAYS(option) {
			if (option === 'Yes') {
				deleteTableProcess(p);
			}
		};
		appState.showAYSModal = true;
	}

	/**
	 * Sweep a single TP's args[*IN] entries, dropping any reference to colID.
	 * Records every touched (processId, argument) pair into `affected`.
	 */
	function _scrubTPInputRefs(tp, colID, affected) {
		Object.keys(tp.args).forEach((argKey) => {
			if (argKey.slice(-2) !== 'IN') return;
			if (Array.isArray(tp.args[argKey])) {
				const before = tp.args[argKey].length;
				tp.args[argKey] = tp.args[argKey].filter((id) => id !== colID);
				if (before !== tp.args[argKey].length) {
					affected.push({ processId: tp.id, processName: tp.name, argument: argKey });
				}
			} else if (tp.args[argKey] === colID) {
				tp.args[argKey] = -1;
				affected.push({ processId: tp.id, processName: tp.name, argument: argKey });
			}
		});
	}

	export function deleteTableProcess(tableProcess) {
		if (!tableProcess) {
			return { success: false, message: 'Invalid analysis provided' };
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

			// Step 2a: Remove from plots that display them
			removeColumnFromPlots(colID);

			// Step 2b: Remove input refs from every TP
			core.tableProcesses.forEach((tp) => _scrubTPInputRefs(tp, colID, affectedProcesses));

			// Step 2c: Drop from any Group that absorbed this column
			core.groups.forEach((g) => {
				if ((g.sourceColumnIds ?? []).includes(colID)) {
					g.sourceColumnIds = g.sourceColumnIds.filter((id) => id !== colID);
					if (Array.isArray(g.allColumnIds)) {
						g.allColumnIds = g.allColumnIds.filter((id) => id !== colID);
					}
				}
			});

			// Step 2d: Break refId dependency chain
			core.data
				.filter((col) => col.refId === colID)
				.forEach((depCol) => {
					depCol.refId = -1;
				});

			// Step 2e+f: Remove from internal column system and core.data
			removeColumn(colID);
			core.data = core.data.filter((c) => c.id !== colID);
		});

		// Step 3: Remove the TP itself from core.tableProcesses.
		core.tableProcesses = core.tableProcesses.filter((tp) => tp.id !== tableProcess.id);

		// Step 4: Clear refTPId on any TP that chained from this one
		core.tableProcesses.forEach((tp) => {
			if (tp.refTPId === tableProcess.id) tp.refTPId = null;
		});

		// Step 4.5: If this was a Column Set, detach it from every consumer it fed —
		// strip its materialised columns/series and drop it from their setRefs — so
		// nothing dangles (and, after a save/reload, it can't be re-bound to a
		// different node reusing this monotonic id). The node is already gone from
		// core.tableProcesses, so pass its candidate columns as the ownership
		// fallback.
		const deletedTpId = tableProcess.id;
		const deletedCandidates = Array.isArray(tableProcess.args?.colsIN)
			? tableProcess.args.colsIN
			: [];
		core.tableProcesses.forEach((tp) => {
			const refs = tp.args?.setRefs;
			if (refs && Object.values(refs).some((a) => (a ?? []).includes(deletedTpId)))
				detachColumnSetFromTP(tp, deletedTpId, deletedCandidates);
		});
		core.plots.forEach((plot) => {
			const refs = plot.setRefs ?? {};
			if (Object.values(refs).some((a) => (a ?? []).includes(deletedTpId)))
				detachColumnSetFromPlot(plot, deletedTpId, deletedCandidates);
		});

		// Drop any per-node note attached to this TP's canvas node.
		delete core.nodeNotes[`tableprocess_${tableProcess.id}`];

		return {
			success: true,
			processId: tableProcess.id,
			processName: tableProcess.name,
			removedOutputColumns: removedColumns.length,
			affectedInputReferences: affectedProcesses.length,
			affectedProcesses: affectedProcesses,
			message: `Analysis "${tableProcess.name}" safely removed. ${removedColumns.length} output column(s) deleted. ${affectedProcesses.length} other process(es) had input references cleaned up.`
		};
	}

	export class TableProcess {
		id; //Unique Id
		name = '';
		displayName = $state('');
		args = $state({});
		refTPId = $state(null);
		// Caution messages published by the TP's editor (e.g. GroupComparison's
		// normality/variance warnings). Surfaced on the node as a yellow triangle
		// (expanded) / yellow border (collapsed). Declared as $state so updates are
		// reactive even though the property is assigned after construction.
		warnings = $state([]);

		constructor({ ...dataIN }, _parent = null, id = null) {
			if (id === null) {
				this.id = id ?? _tableprocessidCounter;
				_tableprocessidCounter++;
			} else {
				this.id = id;
				_tableprocessidCounter = Math.max(id + 1, _tableprocessidCounter + 1);
			}

			this.name = dataIN.name;
			this.refTPId = dataIN.refTPId ?? null;

			// Honor a persisted/user-edited displayName when present; otherwise fall
			// back to the default from tableProcessMap.
			const tableProcessInfo = appConsts.tableProcessMap.get(this.name);
			this.displayName = dataIN.displayName || tableProcessInfo?.displayName || this.name;

			//If there is a column out ref set (i.e. reading from JSON)
			if (dataIN.args.out[Object.keys(dataIN.args.out)[0]] >= 0) {
				this.args = dataIN.args;
			}
			//If the out refs are not yet defined (i.e. creating new)
			else if (dataIN.args) {
				this.args = dataIN.args;
				// Outputs go straight to core.data (free-standing TPs).

				// Pre-seed dynamic per-Y output keys for multi-Y table processes
				// (BinnedData, Cosinor, SmoothedData, RhythmicityAnalysis, etc.) so
				// their per-Y output columns get materialised up-front instead of
				// waiting for the component's onMount → useMultiYTP.initYColumns.
				// Without this the workflow graph shows only the X output until the
				// user expands the node.
				const tpEntry = tableProcessInfo;
				const yPrefix = tpEntry?.yOutKeyPrefix;
				const yINs = Array.isArray(this.args.yIN)
					? this.args.yIN
					: this.args.yIN != null && this.args.yIN !== -1
						? [this.args.yIN]
						: [];
				if (yPrefix && yINs.length > 0) {
					for (const yId of yINs) {
						if (yId == null || yId < 0) continue;
						const outKey = yPrefix + yId;
						if (!(outKey in this.args.out)) this.args.out[outKey] = -1;
					}
				}

				for (let i = 0; i < Object.keys(this.args.out).length; i++) {
					const tempCol = new Column({});
					tempCol.name = Object.keys(this.args.out)[i] + '_' + this.id;
					this.args.out[Object.keys(this.args.out)[i]] = tempCol.id;
					pushObj(tempCol);
				}

				//--------------------------
				// - now run the process (fire-and-forget: result lands via Svelte reactivity)
				this.doProcess();
				//--------------------------
			}
		}

		async doProcess() {
			const entry = appConsts.tableProcessMap.get(this.name);
			if (!entry?.func) return null;
			return await entry.func(this.args);
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
	import TableProcessShell from '$lib/core/TableProcessShell.svelte';
	import { untrack } from 'svelte';
	let { p = $bindable() } = $props();

	// Derive the tableProcessMap entry for this TP
	const entry = $derived(appConsts.tableProcessMap.get(p?.name));

	// --- refTPId chaining ---

	// Find the upstream TP that this one chains from.
	const refTP = $derived.by(() => {
		if (p?.refTPId == null) return null;
		for (const tp of core.tableProcesses) if (tp.id === p.refTPId) return tp;
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

	// Chainable TPs: any TP other than self that emits an x output. The user
	// picks one from the dropdown to wire xIN/yIN from.
	const chainablePrecedingTPs = $derived.by(() => {
		if (!p) return [];
		const result = [];
		for (const tp of core.tableProcesses) {
			if (tp.id === p.id) continue;
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
	</TableProcessShell>
{/if}

<style>
	.chain-selector {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		padding: 0.2rem var(--space-4);
		color: var(--text-muted, #888);
	}
	.chain-selector select {
		font-size: 0.8rem;
		padding: 0.1rem var(--space-2);
	}
</style>
