<script module>
	// @ts-nocheck
	// Crossing — when does a rule over one or more series first (and next) become
	// sustainedly true? One node = one rule = one set of outputs. The rule is a
	// filter-style condition list in OR-of-AND groups; each condition compares a
	// wired series (or x) against a typed value or a wired scalar threshold.
	// Persistence demands the rule hold continuously (in x units when x is wired,
	// else a number of samples) before a crossing fires; after firing, the rule
	// must go FALSE again before the next crossing can fire (re-arming), so one
	// long excursion is one crossing. Design: docs/plans/
	// 2026-09-13-detection-node-and-scatterplot-lines.md.
	import { core } from '$lib/core/core.svelte';
	import { writeOutputColumn } from '$lib/tableProcesses/outputColumns.js';
	import { nodeMemo } from '$lib/core/computeMemo.js';
	import { getColumnById } from '$lib/core/Column.svelte';
	import { normalizeYInputs, migrateLegacyYIN } from '$lib/tableProcesses/tpArgHelpers.js';

	const displayName = 'Crossing';

	const defaults = new Map([
		['xIN', { val: -1 }], // optional time/index axis
		['yIN', { val: [] }], // series the rule's conditions can reference
		['thresholdIN', { val: [] }], // wired scalar thresholds (length-1 columns)
		// OR of AND-groups. Condition: { target: <yIN col id>|'x', isOperator,
		// source: <thresholdIN col id>|-1 (typed), value: <typed number> }.
		['groups', { val: [[{ target: -1, isOperator: '<', source: -1, value: 0 }]] }],
		['persistence', { val: 0 }], // x units if xIN wired, else samples; 0 = single sample
		['out', { breach: { val: -1 }, crossing: { val: -1 }, count: { val: -1 } }],
		['valid', { val: false }],
		['forcollected', { val: true }],
		['collectedType', { val: 'crossing' }],
		['preProcesses', { val: [] }],
		['tableProcesses', { val: [] }]
	]);

	const COMPARATORS = {
		'>': (v, t) => v > t,
		'>=': (v, t) => v >= t,
		'<': (v, t) => v < t,
		'<=': (v, t) => v <= t
	};

	const isMissing = (v) => v == null || v === '' || Number.isNaN(Number(v));

	/** First finite value of a wired scalar-threshold column, or null. */
	function scalarFrom(colId) {
		const col = getColumnById(colId);
		if (!col) return null;
		const data = col.getData() ?? [];
		for (const v of data) if (!isMissing(v)) return Number(v);
		return null;
	}

	/** Median spacing of a numeric x series (for persistence in x units). */
	function medianSpacing(x) {
		const d = [];
		for (let i = 1; i < x.length; i++) {
			const a = Number(x[i - 1]);
			const b = Number(x[i]);
			if (!isMissing(x[i - 1]) && !isMissing(x[i]) && b > a) d.push(b - a);
		}
		if (d.length === 0) return null;
		d.sort((p, q) => p - q);
		return d[Math.floor(d.length / 2)];
	}

	/**
	 * Evaluate the rule and find crossings.
	 * Returns [{ breach, crossings, count }, valid]. `breach` is 0/1 per sample
	 * (null when any series the rule references is missing there — a gap never
	 * silently completes an alert). `crossings` holds, per newly begun sustained
	 * satisfaction of the rule, the x value (x wired) or sample index at which
	 * the persistence requirement completes.
	 * @returns {[{breach:any[], crossings:any[], count:number}, boolean]}
	 */
	export function crossingdata(argsIN) {
		const empty = () => ({ breach: [], crossings: [], count: 0 });
		const yINs = normalizeYInputs(argsIN.yIN).filter((id) => id != null && id !== -1);
		const thINs = normalizeYInputs(argsIN.thresholdIN).filter((id) => id != null && id !== -1);
		const groups = (argsIN.groups ?? [])
			.map((g) => (Array.isArray(g) ? g : []))
			.filter((g) => g.length > 0);
		if (groups.length === 0) return [empty(), false];

		const xWired = argsIN.xIN != null && argsIN.xIN !== -1;
		const xCol = xWired ? getColumnById(argsIN.xIN) : null;
		if (xWired && !xCol) return [empty(), false];
		const xData = xCol ? (xCol.getData() ?? []) : null;

		// Resolve every condition up front; collect the series it reads.
		let n = xData ? xData.length : -1;
		const resolved = [];
		for (const g of groups) {
			const rg = [];
			for (const c of g) {
				const cmp = COMPARATORS[c.isOperator];
				if (!cmp) return [empty(), false];
				let series;
				if (c.target === 'x') {
					if (!xData) return [empty(), false];
					series = xData;
				} else {
					if (!yINs.includes(c.target)) return [empty(), false];
					const col = getColumnById(c.target);
					if (!col) return [empty(), false];
					series = col.getData() ?? [];
				}
				let t;
				if (c.source != null && c.source !== -1) {
					if (!thINs.includes(c.source)) return [empty(), false];
					t = scalarFrom(c.source);
					if (t == null) return [empty(), false];
				} else {
					t = Number(c.value);
					if (Number.isNaN(t)) return [empty(), false];
				}
				if (n === -1) n = series.length;
				if (series.length !== n) return [empty(), false];
				rg.push({ series, cmp, t });
			}
			resolved.push(rg);
		}
		if (n <= 0) return [empty(), false];

		// Persistence → required consecutive samples.
		let required = 1;
		const persistence = Number(argsIN.persistence) || 0;
		if (persistence > 0) {
			if (xData) {
				const dx = medianSpacing(xData);
				if (dx == null) return [empty(), false];
				required = Math.max(1, Math.round(persistence / dx));
			} else {
				required = Math.max(1, Math.round(persistence));
			}
		}

		// Evaluate breach per sample: OR over groups of AND over conditions;
		// null when anything referenced is missing at that sample.
		const breach = new Array(n);
		for (let i = 0; i < n; i++) {
			let missing = false;
			for (const g of resolved) {
				for (const c of g) if (isMissing(c.series[i])) missing = true;
			}
			if (missing) {
				breach[i] = null;
				continue;
			}
			let any = false;
			for (const g of resolved) {
				let all = true;
				for (const c of g) {
					if (!c.cmp(Number(c.series[i]), c.t)) {
						all = false;
						break;
					}
				}
				if (all) {
					any = true;
					break;
				}
			}
			breach[i] = any ? 1 : 0;
		}

		// Crossings: run of consecutive 1s reaching `required` fires once; the
		// rule must go explicitly FALSE (0) to re-arm; nulls reset the run but
		// never re-arm.
		const crossings = [];
		let run = 0;
		let armed = true;
		for (let i = 0; i < n; i++) {
			const b = breach[i];
			if (b === null) {
				run = 0;
			} else if (b === 1) {
				run++;
				if (armed && run >= required) {
					crossings.push(xData ? xData[i] : i);
					armed = false;
				}
			} else {
				run = 0;
				armed = true;
			}
		}

		const processHash = crypto.randomUUID();
		writeOutputColumn(argsIN.out?.breach, breach, { processHash });
		writeOutputColumn(argsIN.out?.crossing, crossings, { processHash });
		writeOutputColumn(argsIN.out?.count, [crossings.length], { processHash });

		return [{ breach, crossings, count: crossings.length }, true];
	}

	export const definition = {
		displayName,
		defaults,
		func: crossingdata,
		columnIdFields: { scalar: ['xIN'], array: ['yIN', 'thresholdIN'] },
		nodeSpec: {
			id: 'tableprocess.crossing',
			inputs: [
				{ name: 'xIN', kind: 'column', cardinality: 'one' },
				{ name: 'yIN', kind: 'column', cardinality: 'many' },
				{ name: 'thresholdIN', kind: 'column', cardinality: 'many' }
			],
			outputs: [
				{ name: 'breach', kind: 'column', cardinality: 'one' },
				{ name: 'crossing', kind: 'column', cardinality: 'one' },
				{ name: 'count', kind: 'column', cardinality: 'one' }
			]
		}
	};
</script>

<script>
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import AttributeSelect from '$lib/components/inputs/AttributeSelect.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	let mounted = $state(false);

	migrateLegacyYIN(p.args);
	if (!Array.isArray(p.args.thresholdIN)) p.args.thresholdIN = [];
	if (!Array.isArray(p.args.groups) || p.args.groups.length === 0) {
		p.args.groups = [[{ target: -1, isOperator: '<', source: -1, value: 0 }]];
	}

	let ownOutputIds = $derived(
		['breach', 'crossing', 'count'].map((k) => p.args.out?.[k]).filter((id) => id >= 0)
	);

	let yOptions = $derived(
		normalizeYInputs(p.args.yIN)
			.filter((id) => id != null && id !== -1)
			.map((id) => ({ id, name: getColumnById(id)?.name ?? String(id) }))
	);
	let thresholdOptions = $derived(
		normalizeYInputs(p.args.thresholdIN)
			.filter((id) => id != null && id !== -1)
			.map((id) => ({ id, name: getColumnById(id)?.name ?? String(id) }))
	);

	// Recompute when any referenced column's DATA changes, not just the refs.
	let getHash = $derived.by(() => {
		let h = JSON.stringify(p.args.groups) + '|p:' + p.args.persistence;
		const ids = [
			p.args.xIN,
			...normalizeYInputs(p.args.yIN),
			...normalizeYInputs(p.args.thresholdIN)
		];
		for (const id of ids) {
			if (id != null && id !== -1) h += ':' + (getColumnById(id)?.getDataHash ?? '');
		}
		return h;
	});

	const memo = nodeMemo(p, 'tableprocess');

	function recompute() {
		p.args.valid = crossingdata(p.args)[1];
	}

	$effect(() => {
		const h = getHash;
		if (!mounted) return;
		if (h !== memo.hash) {
			untrack(() => recompute());
			memo.hash = h;
		}
	});

	function addGroup() {
		p.args.groups = [...p.args.groups, [{ target: -1, isOperator: '<', source: -1, value: 0 }]];
		recompute();
	}
	function addCondition(g) {
		p.args.groups[g] = [
			...p.args.groups[g],
			{ target: -1, isOperator: '<', source: -1, value: 0 }
		];
		p.args.groups = [...p.args.groups];
		recompute();
	}
	function removeCondition(g, c) {
		p.args.groups[g] = p.args.groups[g].filter((_, i) => i !== c);
		p.args.groups = p.args.groups.filter((grp) => grp.length > 0);
		if (p.args.groups.length === 0) {
			p.args.groups = [[{ target: -1, isOperator: '<', source: -1, value: 0 }]];
		}
		recompute();
	}

	onMount(() => {
		if (!p.args.out) p.args.out = {};
		const baked = ['breach', 'crossing', 'count'].every(
			(k) => p.args.out[k] >= 0 && core.rawData.has(p.args.out[k])
		);
		if (baked) {
			p.args.valid = true;
			memo.hash = getHash;
		} else {
			recompute();
		}
		mounted = true;
	});
</script>

<div class="section-row">
	<div class="tableProcess-label"><span>Inputs</span></div>
	<div class="control-input-vertical">
		<div class="control-input">
			<p>Time / index (x, optional)</p>
			<ColumnSelector bind:value={p.args.xIN} onChange={recompute} excludeColIds={ownOutputIds} />
		</div>
		<div class="control-input">
			<p>Series</p>
			<ColumnSelector
				bind:value={p.args.yIN}
				multiple={true}
				excludeColIds={ownOutputIds}
				onChange={recompute}
			/>
		</div>
		<div class="control-input">
			<p>Thresholds (scalar columns, optional)</p>
			<ColumnSelector
				bind:value={p.args.thresholdIN}
				multiple={true}
				excludeColIds={ownOutputIds}
				onChange={recompute}
			/>
		</div>
	</div>
</div>

<div class="section-row">
	<div class="tableProcess-label"><span>Rule</span></div>
	<div class="control-input-vertical">
		{#each p.args.groups as group, g}
			{#if g > 0}
				<p class="crossing-or-label">— OR —</p>
			{/if}
			{#each group as cond, c}
				<div class="control-input crossing-condition">
					{#if c > 0}<span class="crossing-and-label">and</span>{/if}
					<select bind:value={cond.target} onchange={recompute}>
						<option value={-1}>— series —</option>
						{#each yOptions as opt}
							<option value={opt.id}>{opt.name}</option>
						{/each}
						{#if p.args.xIN >= 0}
							<option value="x">x</option>
						{/if}
					</select>
					<AttributeSelect
						bind:value={cond.isOperator}
						options={['>', '>=', '<', '<=']}
						optionsDisplay={['above (>)', 'at or above (≥)', 'below (<)', 'at or below (≤)']}
					/>
					<select bind:value={cond.source} onchange={recompute}>
						<option value={-1}>typed value</option>
						{#each thresholdOptions as opt}
							<option value={opt.id}>{opt.name}</option>
						{/each}
					</select>
					{#if cond.source === -1}
						<NumberWithUnits bind:value={cond.value} onInput={recompute} step="0.1" />
					{/if}
					<button
						class="icon control-block-remove"
						title="Remove condition"
						onclick={() => removeCondition(g, c)}>×</button
					>
				</div>
			{/each}
			<button class="icon control-block-add" onclick={() => addCondition(g)}>+ and</button>
		{/each}
		<button class="icon control-block-add" onclick={addGroup}>+ or group</button>
	</div>
</div>

<div class="section-row">
	<div class="tableProcess-label"><span>Persistence</span></div>
	<ControlInput label={p.args.xIN >= 0 ? 'Sustained for (x units)' : 'Consecutive values'}>
		<NumberWithUnits bind:value={p.args.persistence} onInput={recompute} step="1" />
	</ControlInput>
</div>

{#if p.args.valid && p.args.out.crossing >= 0}
	<details open>
		<summary class="section-details-summary">Outputs</summary>
		<div class="tp-outputs">
			<div class="tp-output-row">
				<span class="tp-output-label">Crossings</span>
				<ColumnComponent col={getColumnById(p.args.out.crossing)} />
			</div>
			<div class="tp-output-row">
				<span class="tp-output-label">Count</span>
				<ColumnComponent col={getColumnById(p.args.out.count)} />
			</div>
			<div class="tp-output-row">
				<span class="tp-output-label">Breach (0/1)</span>
				<ColumnComponent col={getColumnById(p.args.out.breach)} />
			</div>
		</div>
	</details>
{:else}
	<p>Wire series and define a rule.</p>
{/if}

<style>
	.crossing-condition {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
	}
	.crossing-or-label {
		font-weight: 600;
		opacity: 0.7;
		margin: 0.2rem 0 0;
	}
	.crossing-and-label {
		opacity: 0.7;
		font-size: 0.85em;
	}
</style>
