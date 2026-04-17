<!-- @ts-nocheck -->
<!--
	ChainedPanel.svelte
	Shared pre-process + chained table-process panel, used by any
	chainable TP (BinnedData, Cosinor, SmoothedData, TrendFit, etc.).

	Props
	-----
	p           – (bindable) the parent TableProcess instance
	xOutColId   – column ID of the parent's x-output (-1 if none)
	yOutColIds  – reactive array of the parent's current y-output column IDs
-->
<script>
	import { appConsts, core } from '$lib/core/core.svelte';
	import { getColumnById, Column, removeColumn } from '$lib/core/Column.svelte';
	import { Process } from '$lib/core/Process.svelte';
	import Processcomponent from '$lib/core/Process.svelte';
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable(), xOutColId = -1, yOutColIds = [], parentRef = undefined } = $props();

	// ─── Sorted process list for pre-process selects ───────────────────────────
	let sortedProcesses = $derived.by(() => {
		return Array.from(appConsts.processMap.entries()).sort((a, b) => {
			const nameA = a[1].displayName || a[0];
			const nameB = b[1].displayName || b[0];
			return nameA.localeCompare(nameB);
		});
	});

	// ─── Pre-process management ────────────────────────────────────────────────
	// Local Process instances so components can bind to args reactively
	let preProcessProcs = $state([]);

	// Sync preProcess args back to p.args for session persistence
	$effect(() => {
		const snapshots = preProcessProcs.map((proc) => JSON.stringify(proc?.args ?? {}));
		untrack(() => {
			for (let i = 0; i < snapshots.length; i++) {
				if (p.args.preProcesses[i]) {
					p.args.preProcesses[i].processArgs = JSON.parse(snapshots[i]);
				}
			}
		});
	});

	const _dummyParentCol = { id: -1, type: 'number', removeProcess() {} };

	function addPreProcess() {
		p.args.preProcesses = [...p.args.preProcesses, { processName: '', processArgs: {} }];
		preProcessProcs = [...preProcessProcs, null];
	}

	function setPreProcess(idx, processName) {
		if (!processName) {
			p.args.preProcesses[idx] = { processName: '', processArgs: {} };
			preProcessProcs[idx] = null;
		} else {
			const proc = new Process({ name: processName }, _dummyParentCol);
			p.args.preProcesses[idx] = { processName, processArgs: proc.args };
			preProcessProcs[idx] = proc;
		}
		p.args.preProcesses = [...p.args.preProcesses];
		preProcessProcs = [...preProcessProcs];
	}

	function removePreProcess(idx) {
		p.args.preProcesses = p.args.preProcesses.filter((_, i) => i !== idx);
		preProcessProcs = preProcessProcs.filter((_, i) => i !== idx);
	}

	// ─── Sub-TP (chained table process) management ────────────────────────────

	// Keys in TP defaults that are infrastructure, not user-facing parameters
	const _TP_INFRA_KEYS = new Set([
		'xIN',
		'yIN',
		'out',
		'valid',
		'forcollected',
		'collectedType',
		'outputX'
	]);

	// Overrides applied on top of TP defaults when used in chained mode
	const _CHAINED_OVERRIDES = {
		cosinor: { useFixedPeriod: false, Ncurves: 1 },
		bin: { binSize: 1, stepSize: 1 }
	};

	/** Map from collectedType → { component, displayName, paramDefaults } */
	let chainedTPMap = $derived.by(() => {
		const map = {};
		for (const [, entry] of appConsts.tableProcessMap) {
			const defs = entry.defaults;
			if (!defs?.get?.('forcollected')?.val) continue;
			const cType = defs.get('collectedType')?.val;
			if (!cType) continue;
			const params = {};
			for (const [key, def] of defs) {
				if (_TP_INFRA_KEYS.has(key)) continue;
				params[key] = def.val ?? def;
			}
			const overrides = _CHAINED_OVERRIDES[cType] ?? {};
			map[cType] = {
				component: entry.component,
				displayName: entry.displayName,
				paramDefaults: { ...params, ...overrides }
			};
		}
		return map;
	});

	function addTableProcess(type) {
		if (!type || !chainedTPMap[type]) return;
		const tp = {
			id: crypto.randomUUID(),
			type,
			xColId: xOutColId, // seed from parent's x-output
			excludedColIds: [],
			args: {
				...chainedTPMap[type].paramDefaults,
				xIN: xOutColId >= 0 ? xOutColId : -1,
				yIN: [...yOutColIds],
				out: {},
				valid: false
			}
		};
		p.args.tableProcesses = [...p.args.tableProcesses, tp];
	}

	function removeTableProcess(idx) {
		const tp = p.args.tableProcesses[idx];
		for (const colId of Object.values(tp.args?.out ?? {})) {
			if (colId != null && colId >= 0) {
				core.rawData.delete(colId);
				removeColumn(colId);
			}
		}
		p.args.tableProcesses = p.args.tableProcesses.filter((_, i) => i !== idx);
	}

	function toggleExcludeForTp(tpIdx, colId) {
		const tp = p.args.tableProcesses[tpIdx];
		const excluded = tp.excludedColIds ?? [];
		const newExcluded = excluded.includes(colId)
			? excluded.filter((id) => id !== colId)
			: [...excluded, colId];
		tp.excludedColIds = newExcluded;
		tp.args.yIN = yOutColIds.filter((id) => !newExcluded.includes(id));
		p.args.tableProcesses = [...p.args.tableProcesses];
	}

	// Keep sub-TP yINs in sync when the parent's output column list changes
	// (e.g. when the user adds/removes a y-input from the parent TP).
	$effect(() => {
		const currentYOuts = [...yOutColIds]; // track as reactive dep
		untrack(() => {
			for (const tp of p.args.tableProcesses ?? []) {
				const excluded = tp.excludedColIds ?? [];
				tp.args.yIN = currentYOuts.filter((id) => !excluded.includes(id));
				// Update xIN from current xColId (may have been user-overridden)
				tp.args.xIN = tp.xColId >= 0 ? tp.xColId : -1;
			}
			if ((p.args.tableProcesses ?? []).length > 0) {
				p.args.tableProcesses = [...p.args.tableProcesses];
			}
		});
	});

	onMount(() => {
		if (!p.args.preProcesses) p.args.preProcesses = [];
		if (!p.args.tableProcesses) p.args.tableProcesses = [];

		preProcessProcs = p.args.preProcesses.map((pp) =>
			pp.processName
				? new Process({ name: pp.processName, args: pp.processArgs }, _dummyParentCol)
				: null
		);
	});
</script>

<!-- Pre-process Section -->
<div class="section-row">
	<div class="tableProcess-label"><span>Pre-process outputs</span></div>
	<div class="control-input-vertical">
		{#each p.args.preProcesses ?? [] as pp, idx (idx)}
			<div class="tp-block">
				<div class="tp-header">
					<span class="tp-title">Step {idx + 1}</span>
					<button class="remove-btn" onclick={() => removePreProcess(idx)} title="Remove">×</button>
				</div>
				<div class="control-input">
					<p>Process</p>
					<select value={pp.processName} onchange={(e) => setPreProcess(idx, e.target.value)}>
						<option value="">Select…</option>
						{#each sortedProcesses as [key, value] (key)}
							<option value={key}>{value.displayName || key}</option>
						{/each}
					</select>
				</div>
				{#if preProcessProcs[idx]}
					<Processcomponent p={preProcessProcs[idx]} />
				{/if}
			</div>
		{/each}
		<button class="add-tp-btn" onclick={addPreProcess}>+ Add pre-process step</button>
	</div>
</div>

<!-- Chained Table Processes Section -->
<div class="section-row">
	<div class="tableProcess-label"><span>Table processes</span></div>
	<div class="control-input-vertical">
		{#each p.args.tableProcesses ?? [] as tp, tpIdx (tpIdx)}
			{@const DynamicTP = chainedTPMap[tp.type]?.component}
			<div class="tp-block">
				<div class="tp-header">
					<span class="tp-title">{chainedTPMap[tp.type]?.displayName ?? tp.type}</span>
					<button class="remove-btn" onclick={() => removeTableProcess(tpIdx)} title="Remove"
						>×</button
					>
				</div>

				<!-- X-axis column selector (seeded to parent's x-output, user can override) -->
				<div class="control-input">
					<p>X column</p>
					<ColumnSelector
						bind:value={tp.xColId}
						allowNone={true}
						onChange={() => {
							tp.args.xIN = tp.xColId >= 0 ? tp.xColId : -1;
							p.args.tableProcesses = [...p.args.tableProcesses];
						}}
					/>
				</div>

				<!-- Type-specific parameters (rendered by the TP component, inputs hidden) -->
				{#if DynamicTP}
					<DynamicTP
						p={{ id: tp.id, args: tp.args, parent: parentRef ?? p.parent }}
						hideInputs={true}
					/>
				{/if}

				<!-- Column inclusion checklist -->
				{#if yOutColIds.length > 0}
					{@const excluded = tp.excludedColIds ?? []}
					{@const nActive = yOutColIds.length - excluded.length}
					<div class="control-input-vertical">
						<p>Columns ({nActive} of {yOutColIds.length} included)</p>
						<div class="col-checklist">
							{#each yOutColIds as colId (colId)}
								{@const col = getColumnById(colId)}
								{@const included = !excluded.includes(colId)}
								<label class="col-check-item">
									<input
										type="checkbox"
										checked={included}
										onchange={() => toggleExcludeForTp(tpIdx, colId)}
									/>
									{col?.name ?? `col ${colId}`}
								</label>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/each}

		<select
			class="add-tp-select"
			onchange={(e) => {
				addTableProcess(e.target.value);
				e.target.value = '';
			}}
		>
			<option value="">+ Add table process…</option>
			{#each Object.entries(chainedTPMap) as [cType, entry] (cType)}
				<option value={cType}>{entry.displayName}</option>
			{/each}
		</select>
	</div>
</div>

<style>
	.tp-block {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		border: 1px solid var(--color-lightness-85);
		border-radius: 4px;
		padding: 0.5rem 0.6rem;
		width: 100%;
	}

	.tp-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.tp-title {
		font-size: 12px;
		font-weight: 600;
	}

	.remove-btn {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 16px;
		line-height: 1;
		color: var(--color-lightness-55, #888);
		padding: 0 0.2rem;
	}

	.remove-btn:hover {
		color: #c0392b;
	}

	.add-tp-btn {
		background: none;
		border: 1px dashed var(--color-lightness-75, #aaa);
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
		padding: 0.3rem 0.6rem;
		color: var(--color-lightness-45, #666);
		width: 100%;
		text-align: center;
	}

	.add-tp-btn:hover {
		border-color: var(--color-lightness-55, #888);
		color: var(--color-lightness-25, #333);
	}

	.add-tp-select {
		font-size: 12px;
		padding: 0.3rem 0.4rem;
		border: 1px dashed var(--color-lightness-75, #aaa);
		border-radius: 4px;
		background: none;
		cursor: pointer;
		color: var(--color-lightness-45, #666);
		width: 100%;
	}

	.col-checklist {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		max-height: 150px;
		overflow-y: auto;
		border: 1px solid var(--color-lightness-85);
		border-radius: 4px;
		padding: 0.25rem 0.4rem;
	}

	.col-check-item {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 12px;
		cursor: pointer;
		padding: 0.1rem 0;
	}
</style>
