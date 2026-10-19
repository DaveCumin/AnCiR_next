<script module>
	// @ts-nocheck
	// Join Data: every row of A and every row of B on one time column, sorted by time.
	// The maths is utils/joinData.js; which value columns are the same measurement (and the
	// output names) is utils/joinPairing.js. This file is the wiring: reading the inputs,
	// writing the outputs, reconciling which output columns exist, and the panel.
	//
	// Inputs end in `IN` (aTimeIN, aValuesIN, bTimeIN, bValuesIN) because the graph, the input
	// scrub on column delete and the orphan sweep all find a node's inputs by that suffix; the
	// ports SHOW as "time A", "values A", "time B", "values B" (nodeSpec `display`).
	//
	// No worker path, so no worker size gate: see utils/joinData.js.
	import { core } from '$lib/core/core.svelte';
	import { getColumnById as getColumnByIdForJoin } from '$lib/core/Column.svelte';
	import { nodeMemo } from '$lib/core/computeMemo.js';
	import { columnNamer } from '$lib/core/columnLabels.js';
	import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';
	import { joinPlan, normaliseColumnName } from '$lib/utils/joinPairing.js';
	import {
		joinData,
		timeKind,
		timeKindProblem,
		joinSummary,
		NUMERIC_NOTE
	} from '$lib/utils/joinData.js';

	const displayName = 'Join Data';

	const defaults = new Map([
		['aTimeIN', { val: -1 }],
		['aValuesIN', { val: [] }],
		['bTimeIN', { val: -1 }],
		['bValuesIN', { val: [] }],
		// Per B column: an A column id ("same as A: <col>") or -1 ("separate column").
		// No entry = by name (utils/joinPairing.js).
		['pairing', { val: {} }],
		// Hours for time columns, x units for numbers; added to B's times before joining.
		['shiftB', { val: 0 }],
		// Add a "Source" output: which dataset each row came from.
		['sourceColumn', { val: false }],
		['out', { jointime: { val: -1 } }],
		['valid', { val: false }]
	]);

	/** The name each column is compared and labelled by: what the user sees (UI-4). */
	export function joinNameOf() {
		const namer = columnNamer();
		return (id) => {
			const col = getColumnByIdForJoin(id);
			return col ? namer(col) : String(id);
		};
	}

	/**
	 * What the Source column says for each dataset: the names of the groups (datasets) the two
	 * time columns belong to, when both have one and they differ; else "A" and "B".
	 */
	export function joinSourceLabels(aTimeId, bTimeId) {
		const groupName = (id) =>
			(core.groups ?? [])
				.find((g) => (g.sourceColumnIds ?? []).includes(id) || (g.allColumnIds ?? []).includes(id))
				?.name?.trim();
		const a = groupName(aTimeId);
		const b = groupName(bTimeId);
		if (a && b && normaliseColumnName(a) !== normaliseColumnName(b)) return [a, b];
		return ['A', 'B'];
	}

	/**
	 * Empty every output column (a refused join must not leave an old result standing). The
	 * process hash matters: rawData.set alone does not change getDataHash, so getData() would
	 * keep serving its cached result.
	 */
	function clearOutputs(out) {
		const processHash = crypto.randomUUID();
		for (const id of Object.values(out ?? {})) {
			if (typeof id !== 'number' || id < 0) continue;
			const col = getColumnByIdForJoin(id);
			if (col) writeOutputColumn(id, [], { type: col.type, processHash });
		}
	}

	const sameJSON = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

	/**
	 * Join A and B into the output columns. Returns [result, valid].
	 * result: { error?, notes[], counts, rareShared, kind, outputs[], summary }
	 */
	export function joindata(argsIN) {
		const refuse = (error) => {
			clearOutputs(argsIN.out);
			return [{ error, notes: [], counts: null, rareShared: false, outputs: [] }, false];
		};
		const aT = Number(argsIN.aTimeIN); // Number-ok: a column id
		const bT = Number(argsIN.bTimeIN); // Number-ok: a column id
		if (!(aT >= 0) || !(bT >= 0)) {
			return [{ error: null, notes: [], counts: null, rareShared: false, outputs: [] }, false];
		}
		const colA = getColumnByIdForJoin(aT);
		const colB = getColumnByIdForJoin(bT);
		if (!colA || !colB) return refuse(null);
		const problem = timeKindProblem(colA.type, colB.type);
		if (problem) return refuse(problem);
		const kind = timeKind(colA.type);

		const nameOf = joinNameOf();
		const plan = joinPlan(argsIN, nameOf);
		const both = plan.aIds.filter((id) => plan.bIds.includes(id));
		if (both.length) {
			return refuse(
				`${nameOf(both[0])} is wired into both A and B. Wire each column into one side only.`
			);
		}

		const dataOf = {};
		const typeOf = {};
		for (const id of [...plan.aIds, ...plan.bIds]) {
			const col = getColumnByIdForJoin(id);
			dataOf[id] = col?.getData?.() ?? [];
			typeOf[id] = col?.type ?? 'number';
		}
		const sourceLabels = joinSourceLabels(aT, bT);
		const res = joinData({
			timeA: colA.getData(),
			timeB: colB.getData(),
			kind,
			dataOf,
			typeOf,
			outputs: plan.outputs,
			shiftB: argsIN.shiftB,
			sourceLabels
		});
		if (res.error) return refuse(res.error);

		// Bake what the result came from, so a saved session carries it: the ports and the
		// Python and R exports read these rather than re-deciding from names they may not see
		// the same way (a node output's display name). `_` = internal, never an undo step.
		if (!sameJSON(argsIN._resolvedPairs, plan.pairOf)) argsIN._resolvedPairs = plan.pairOf;
		if (!sameJSON(argsIN._sourceLabels, sourceLabels)) argsIN._sourceLabels = sourceLabels;

		const notes = [];
		if (kind === 'number') notes.push(NUMERIC_NOTE);
		for (const c of plan.conflicts) {
			notes.push(
				`${nameOf(c.bId)} (B) is a separate column: ${nameOf(c.aId)} (A) is already paired with another B column.`
			);
		}
		for (const o of plan.outputs) {
			if (o.aId == null || o.bId == null) continue;
			const ta = getColumnByIdForJoin(o.aId)?.type;
			const tb = getColumnByIdForJoin(o.bId)?.type;
			if (ta && tb && ta !== tb) {
				notes.push(
					`${o.label}: A is a ${ta} column and B a ${tb} column; the joined column is ${ta}.`
				);
			}
		}

		const processHash = crypto.randomUUID();
		const out = argsIN.out ?? {};
		const isTime = kind === 'time';
		writeOutputColumn(out.jointime, res.time, {
			type: isTime ? 'time' : 'number',
			timeFormat: isTime ? null : undefined,
			processHash
		});
		for (const o of plan.outputs) {
			const src = getColumnByIdForJoin(o.aId ?? o.bId);
			const type = src?.type ?? 'number';
			writeOutputColumn(out[o.key], res.columns[o.key], {
				type,
				timeFormat: type === 'time' ? null : undefined,
				processHash
			});
		}
		if (argsIN.sourceColumn) {
			writeOutputColumn(out.source, res.source, { type: 'category', processHash });
		}

		return [
			{
				error: null,
				notes,
				counts: res.counts,
				rareShared: res.rareShared,
				kind,
				outputs: plan.outputs,
				pairOf: plan.pairOf,
				summary: joinSummary(res.counts)
			},
			res.ok
		];
	}

	export const definition = {
		displayName,
		defaults,
		func: joindata,
		columnIdFields: { scalar: ['aTimeIN', 'bTimeIN'], array: ['aValuesIN', 'bValuesIN'] },
		nodeSpec: {
			id: 'tableprocess.joindata',
			inputs: [
				{ name: 'aTimeIN', display: 'time A', kind: 'column', cardinality: 'one' },
				{ name: 'aValuesIN', display: 'values A', kind: 'column', cardinality: 'many' },
				{ name: 'bTimeIN', display: 'time B', kind: 'column', cardinality: 'one' },
				{ name: 'bValuesIN', display: 'values B', kind: 'column', cardinality: 'many' }
			],
			outputs: [
				{ name: 'jointime', kind: 'column', cardinality: 'one' },
				{ name: 'joined_*', kind: 'column', cardinality: 'many', dynamicPrefix: 'joined_' },
				{ name: 'source', kind: 'column', cardinality: 'one' }
			]
		}
	};
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ColumnComponent, { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
	import { appConsts, appState, pushObj } from '$lib/core/core.svelte.js';
	import { mutationService } from '$lib/core/mutationService.js';
	import { buildTableProcessDefaults } from '$lib/core/tpDefaults.js';
	import { fillDefaults } from '$lib/tableProcesses/tpArgHelpers.js';
	import { joinOutKeys, joinValueIds } from '$lib/utils/joinPairing.js';
	import { suggestedBinSize } from '$lib/utils/joinData.js';
	import { medianSamplingInterval } from '$lib/utils/periodogram.js';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable(), hideInputs = false } = $props();

	fillDefaults(p.args, defaults);
	if (!p.args.out) p.args.out = { jointime: -1 };

	let result = $state();
	let mounted = $state(false);

	const memo = nodeMemo(p, 'tableprocess');

	// The names the plan reads (display names follow renames upstream), resolved reactively.
	let nameOf = $derived.by(() => {
		const namer = columnNamer();
		return (id) => {
			const col = getColumnById(id);
			return col ? namer(col) : String(id);
		};
	});
	let ids = $derived(joinValueIds(p.args));
	let colA = $derived(p.args.aTimeIN >= 0 ? getColumnById(p.args.aTimeIN) : null);
	let colB = $derived(p.args.bTimeIN >= 0 ? getColumnById(p.args.bTimeIN) : null);
	let isNumeric = $derived(colA?.type !== 'time' && colB?.type !== 'time' && (colA || colB));

	// The output keys this node should have right now (the reconcile target).
	let wantKeys = $derived(joinOutKeys(p.args, nameOf));

	let getHash = $derived.by(() => {
		let h = '';
		for (const id of [p.args.aTimeIN, p.args.bTimeIN, ...ids.aIds, ...ids.bIds]) {
			const col = id >= 0 ? getColumnById(id) : null;
			h += '|' + (col?.getDataHash ?? '') + ':' + (col?.type ?? '');
		}
		h += '|keys:' + wantKeys.join(',');
		h += '|pairing:' + JSON.stringify(p.args.pairing ?? {});
		h += '|shift:' + p.args.shiftB + '|src:' + !!p.args.sourceColumn;
		if (p.args.sourceColumn)
			h += '|labels:' + joinSourceLabels(p.args.aTimeIN, p.args.bTimeIN).join('/');
		return h;
	});

	$effect(() => {
		if (result !== undefined) memo.payload = result;
	});
	function restore(cached) {
		result = cached;
		p.warnings = cached?.error ? [cached.error] : [];
	}
	$effect(() => memo.follow(getHash, restore));

	function recompute() {
		[result, p.args.valid] = joindata(p.args);
		p.warnings = result?.error ? [result.error] : [];
		memo.hash = getHash;
	}

	$effect(() => {
		const h = getHash;
		if (!mounted) return;
		if (h !== memo.hash) {
			untrack(() => {
				[result, p.args.valid] = joindata(p.args);
				p.warnings = result?.error ? [result.error] : [];
			});
			memo.hash = h;
		}
	});

	// --- Output columns --------------------------------------------------------------------
	function isCommitted() {
		return p?.id != null && (core.tableProcesses ?? []).some((tp) => tp.id === p.id);
	}

	function makeColumn(key) {
		const col = new Column({});
		col.name = `${key}_${p.id}`; // the seeded shape: outputLabels shows the live label
		pushObj(col);
		return col.id;
	}

	function dropColumn(key) {
		const id = p.args.out[key];
		delete p.args.out[key];
		if (typeof id === 'number' && id >= 0) {
			core.rawData.delete(id);
			removeColumn(id);
		}
	}

	/**
	 * Make args.out hold exactly the wanted keys. A value column swapped in place (a node
	 * spliced upstream) hands its output column to the new key instead of minting a new one,
	 * so whatever is wired downstream stays wired (reuse-on-replace). Returns true on change.
	 */
	function reconcile() {
		if (!isCommitted()) return false;
		const want = joinOutKeys(p.args, nameOf);
		const have = Object.keys(p.args.out ?? {});
		const stale = have.filter((k) => !want.includes(k));
		const missing = want.filter((k) => !(p.args.out[k] >= 0));
		if (!stale.length && !missing.length) return false;
		const staleJoined = stale.filter((k) => k.startsWith('joined_') && p.args.out[k] >= 0);
		const missingJoined = missing.filter((k) => k.startsWith('joined_'));
		const reuse = Math.min(staleJoined.length, missingJoined.length);
		for (let i = 0; i < reuse; i++) {
			p.args.out[missingJoined[i]] = p.args.out[staleJoined[i]];
			delete p.args.out[staleJoined[i]];
		}
		for (const k of stale) if (k in p.args.out) dropColumn(k);
		for (const k of want) if (!(p.args.out[k] >= 0)) p.args.out[k] = makeColumn(k);
		return true;
	}

	$effect(() => {
		wantKeys; // track
		if (!mounted) return;
		// Deferred: new Column() under a live effect leaves its $derived fields inert.
		queueMicrotask(() =>
			untrack(() => {
				if (reconcile()) recompute();
			})
		);
	});

	onMount(() => {
		const restored = memo.has(getHash);
		if (restored) restore(memo.payload);
		const changed = reconcile();
		if (changed || !restored) recompute();
		mounted = true;
	});

	// --- Panel ------------------------------------------------------------------------------
	let ownOutputIds = $derived(
		Object.values(p.args.out ?? {}).filter((v) => typeof v === 'number' && v >= 0)
	);
	let excludeA = $derived([...ownOutputIds, ...ids.bIds]);
	let excludeB = $derived([...ownOutputIds, ...ids.aIds]);

	/** The panel select's value for a B column: 'auto', an A id, or -1. */
	function pairValue(bId) {
		const v = p.args.pairing?.[String(bId)];
		return v == null ? 'auto' : String(v);
	}
	function setPair(bId, value) {
		const next = { ...(p.args.pairing ?? {}) };
		if (value === 'auto') delete next[String(bId)];
		else next[String(bId)] = Number(value); // Number-ok: a select value (a column id or -1)
		p.args.pairing = next;
	}
	/** What "by name" decides for this B column (its own override set aside). */
	function autoText(bId) {
		const pairing = { ...(p.args.pairing ?? {}) };
		delete pairing[String(bId)];
		const a = joinPlan({ ...p.args, pairing }, nameOf).pairOf[bId];
		return a != null ? `By name: ${nameOf(a)}` : 'By name: separate';
	}

	let outputRows = $derived.by(() => {
		const rows = [];
		const out = p.args.out ?? {};
		if (out.jointime >= 0) rows.push(out.jointime);
		for (const o of result?.outputs ?? []) if (out[o.key] >= 0) rows.push(out[o.key]);
		if (p.args.sourceColumn && out.source >= 0) rows.push(out.source);
		return rows;
	});

	/** One click: a Bin Data node on the joined time and every joined value column. */
	function addBinData() {
		const out = p.args.out ?? {};
		const yIN = (result?.outputs ?? [])
			.map((o) => out[o.key])
			.filter((id) => typeof id === 'number' && id >= 0);
		if (!(out.jointime >= 0) || yIN.length === 0) return;
		const hours = (col) =>
			!col
				? NaN
				: medianSamplingInterval(col.type === 'time' ? col.hoursSinceStart : col.getData());
		const size = suggestedBinSize(hours(colA), hours(colB));
		const entry = appConsts.tableProcessMap.get('BinnedData');
		if (!entry) return;
		const args = {
			...buildTableProcessDefaults(entry),
			xIN: out.jointime,
			yIN,
			binSize: size,
			stepSize: size
		};
		const tp = mutationService.addFreeTableProcess('BinnedData', args);
		// Select it and bring it into view on the canvas (the Data panel's find uses the same).
		if (tp) {
			appState.focusNodeRequest = {
				id: `tableprocess_${tp.id}`,
				n: (appState.focusNodeRequest?.n ?? 0) + 1
			};
		}
	}
</script>

{#if !hideInputs}
	<div class="section-row">
		<div class="tableProcess-label"><span>Dataset A</span></div>
		<div class="control-input-vertical">
			<div class="control-input">
				<p>Time A</p>
				<ColumnSelector bind:value={p.args.aTimeIN} excludeColIds={ownOutputIds} />
			</div>
			<div class="control-input">
				<p>Values A</p>
				<ColumnSelector bind:value={p.args.aValuesIN} excludeColIds={excludeA} multiple={true} />
			</div>
		</div>
	</div>
	<div class="section-row">
		<div class="tableProcess-label"><span>Dataset B</span></div>
		<div class="control-input-vertical">
			<div class="control-input">
				<p>Time B</p>
				<ColumnSelector bind:value={p.args.bTimeIN} excludeColIds={ownOutputIds} />
			</div>
			<div class="control-input">
				<p>Values B</p>
				<ColumnSelector bind:value={p.args.bValuesIN} excludeColIds={excludeB} multiple={true} />
			</div>
		</div>
	</div>
{/if}

<div class="section-row">
	<div class="tableProcess-label"><span>Options</span></div>
	<div class="control-input-vertical">
		<ControlInput label={isNumeric ? "Shift B's x by (x units)" : "Shift B's clock by (h)"}>
			<NumberWithUnits step="0.25" bind:value={p.args.shiftB} />
		</ControlInput>
		<div class="control-input">
			<label>
				<input type="checkbox" bind:checked={p.args.sourceColumn} />
				Add a Source column
			</label>
		</div>
	</div>
</div>

{#if ids.bIds.length > 0 && ids.aIds.length > 0}
	<div class="section-row">
		<div class="tableProcess-label"><span>Same measurement?</span></div>
		<div class="control-input-vertical">
			{#each ids.bIds as bId (bId)}
				<ControlInput label={`${nameOf(bId)} (B)`}>
					<select value={pairValue(bId)} onchange={(e) => setPair(bId, e.currentTarget.value)}>
						<option value="auto">{autoText(bId)}</option>
						{#each ids.aIds as aId (aId)}
							<option value={String(aId)}>Same as A: {nameOf(aId)}</option>
						{/each}
						<option value="-1">Separate column</option>
					</select>
				</ControlInput>
			{/each}
		</div>
	</div>
{/if}

{#if result?.error}
	<p class="warn">{result.error}</p>
{/if}
{#each result?.notes ?? [] as note (note)}
	<p class="note">{note}</p>
{/each}
{#if result?.summary}
	<p class="summary">{result.summary}</p>
{/if}
{#if result?.rareShared}
	<div class="bin-hint">
		<p>A and B rarely share a time. To compare them row by row, add Bin Data after this node.</p>
		<button class="btn-add" onclick={addBinData} disabled={!isCommitted()}>+ Add Bin Data</button>
	</div>
{/if}

<details open>
	<summary class="section-details-summary">Output</summary>
	<div class="section-row">
		<div class="control-input-vertical">
			{#if p.args.valid}
				{#each outputRows as id (id)}
					{@const col = getColumnById(id)}
					{#if col}<ColumnComponent {col} />{/if}
				{/each}
			{:else if !result?.error}
				<p class="hint">Wire a time column into time A and time B to join them.</p>
			{/if}
		</div>
	</div>
</details>

<style>
	.hint,
	.note,
	.summary {
		font-size: var(--font-sm);
		margin: var(--space-1) 0 0;
	}
	.hint,
	.note {
		color: var(--color-text-muted);
	}
	.warn {
		font-size: var(--font-xs);
		color: var(--color-warning-text);
		background: var(--color-warning-bg);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		margin: var(--space-1) 0 0;
	}
	.bin-hint {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: var(--space-2) 0 0;
		padding: var(--space-2);
		background: var(--color-warning-bg);
		border-radius: var(--radius-sm);
	}
	.bin-hint p {
		margin: 0;
		font-size: var(--font-sm);
		color: var(--color-warning-text);
	}
</style>
