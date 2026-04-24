<script module>
	// @ts-nocheck
	import { core, appConsts } from '$lib/core/core.svelte';

	const displayName = 'Long To Wide';
	const defaults = new Map([
		['categoryIN', { val: -1 }],
		['timeIN', { val: -1 }],
		['valueIN', { val: -1 }],
		['categories', { val: [] }],
		['tableProcesses', { val: [] }],
		['preProcesses', { val: [] }],
		['out', { time: { val: -1 } }],
		['valid', { val: false }]
	]);

	export function longtowide(argsIN) {
		const categoryIN = argsIN.categoryIN;
		const timeIN = argsIN.timeIN;
		const valueIN = argsIN.valueIN;

		if (
			categoryIN == undefined ||
			timeIN == undefined ||
			valueIN == undefined ||
			categoryIN == -1 ||
			timeIN == -1 ||
			valueIN == -1
		) {
			return [{}, false];
		}

		const categoryData = getColumnById(categoryIN).getData();
		const timeData = getColumnById(timeIN).getData();
		const valueData = getColumnById(valueIN).getData();

		// Get the raw (unparsed) time strings from the input column for output column storage.
		// getData() on a 'time' column converts strings → UNIX ms; if we store those UNIX ms
		// back into a 'time' typed output column, getData() would try to re-parse them → NaN.
		// Accessing rawData directly gives us the original strings to store instead.
		const inputTimeCol = getColumnById(timeIN);
		const canUseRawStrings =
			inputTimeCol.type === 'time' &&
			!inputTimeCol.isReferencial() &&
			inputTimeCol.processes.length === 0 &&
			inputTimeCol.compression !== 'awd';
		const rawTimeInput = canUseRawStrings ? (core.rawData.get(inputTimeCol.data) ?? []) : null;

		// Build union of all time values (deduplicated, sorted by UNIX ms)
		const seenTimes = new Set();
		const unionEntries = []; // { unix: UNIX ms, raw: original string or UNIX ms }
		for (let i = 0; i < timeData.length; i++) {
			const t = timeData[i];
			if (!seenTimes.has(t)) {
				seenTimes.add(t);
				unionEntries.push({ unix: t, raw: rawTimeInput != null ? rawTimeInput[i] : t });
			}
		}
		unionEntries.sort((a, b) => a.unix - b.unix);

		const unionTimes = unionEntries.map((e) => e.unix);
		const unionTimesForStorage = unionEntries.map((e) => e.raw);

		// Get unique categories (preserving order of first appearance)
		// Skip null/undefined/empty-string values from sparse CSV data
		const seenCats = new Set();
		const categories = [];
		for (const c of categoryData) {
			if (c == null || c === '') continue;
			if (!seenCats.has(c)) {
				seenCats.add(c);
				categories.push(c);
			}
		}

		// Build a map: category -> (time -> value)
		const catTimeMap = new Map();
		for (const cat of categories) catTimeMap.set(cat, new Map());
		for (let i = 0; i < categoryData.length; i++) {
			catTimeMap.get(categoryData[i])?.set(timeData[i], valueData[i]);
		}

		// Build result object
		const result = { time: unionTimes };
		for (const cat of categories) {
			const vals = unionTimes.map((t) => {
				const v = catTimeMap.get(cat).get(t);
				return v !== undefined ? v : NaN;
			});
			result['value_' + cat] = vals;
		}

		// Write to output columns if committed
		if (argsIN.out.time !== -1) {
			// Apply pre-processes (in order) to each category's values before writing
			for (const pp of argsIN.preProcesses ?? []) {
				if (!pp.processName) continue;
				const proc = appConsts.processMap.get(pp.processName);
				if (proc?.func) {
					for (const cat of categories) {
						result['value_' + cat] = proc.func(result['value_' + cat], pp.processArgs ?? {});
					}
				}
			}

			const timeColId = argsIN.out.time;
			// Store raw strings when available so that getData() (which re-parses via getUNIXDate)
			// produces correct UNIX ms. When raw strings are unavailable, store UNIX ms directly
			// and clear timeFormat so getUNIXDate short-circuits and returns them unchanged.
			core.rawData.set(timeColId, unionTimesForStorage);
			getColumnById(timeColId).data = timeColId;
			getColumnById(timeColId).type = getColumnById(timeIN).type;
			if (rawTimeInput != null && getColumnById(timeIN).timeFormat) {
				getColumnById(timeColId).timeFormat = getColumnById(timeIN).timeFormat;
			} else if (rawTimeInput == null) {
				getColumnById(timeColId).timeFormat = '';
			}

			const processHash = crypto.randomUUID();
			getColumnById(timeColId).tableProcessGUId = processHash;

			for (const cat of categories) {
				const outKey = 'value_' + cat;
				const outColId = argsIN.out[outKey];
				if (outColId !== undefined && outColId !== -1) {
					core.rawData.set(outColId, result[outKey]);
					getColumnById(outColId).data = outColId;
					getColumnById(outColId).type = getColumnById(valueIN).type;
					getColumnById(outColId).tableProcessGUId = processHash;
				}
			}
		}

		return [result, unionTimes.length > 0];
	}

	export const definition = {
		displayName,
		defaults,
		func: longtowide,
		columnIdFields: { scalar: ['categoryIN', 'timeIN', 'valueIN'] }
	};
</script>

<script>
	// @ts-nocheck
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import ChainedPanel from '$lib/components/reusables/ChainedPanel.svelte';
	import Table from '$lib/components/plotbits/Table.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
	import { formatTimeFromUNIX } from '$lib/utils/time/TimeUtils.js';
	import { pushObj } from '$lib/core/core.svelte.js';
	import { Process } from '$lib/core/Process.svelte';
	import Processcomponent from '$lib/core/Process.svelte';
	import { onMount, untrack } from 'svelte';
	let { p = $bindable() } = $props();

	let longToWideResult = $state();
	let mounted = $state(false);
	let previewStart = $state(1);
	let errorMessage = $state('');

	// Local state bound to selectors
	let categoryIN_local = $state(p.args.categoryIN);
	let timeIN_local = $state(p.args.timeIN);
	let valueIN_local = $state(p.args.valueIN);

	// Process instances for pre-process UI
	let preProcessProcs = $state([]);

	let sortedProcesses = $derived.by(() => {
		return Array.from(appConsts.processMap.entries()).sort((a, b) => {
			const nameA = a[1].displayName || a[0];
			const nameB = b[1].displayName || b[0];
			return nameA.localeCompare(nameB);
		});
	});

	let categoryIN_col = $derived.by(() =>
		p.args.categoryIN >= 0 ? getColumnById(p.args.categoryIN) : null
	);
	let timeIN_col = $derived.by(() => (p.args.timeIN >= 0 ? getColumnById(p.args.timeIN) : null));
	let timeIsTime = $derived(timeIN_col?.type === 'time');
	let valueIN_col = $derived.by(() => (p.args.valueIN >= 0 ? getColumnById(p.args.valueIN) : null));

	let getHash = $derived.by(() => {
		let h = '';
		h += categoryIN_col?.getDataHash ?? '';
		h += timeIN_col?.getDataHash ?? '';
		h += valueIN_col?.getDataHash ?? '';
		// Track processes on output value columns
		for (const cat of p.args.categories ?? []) {
			const colId = p.args.out?.['value_' + cat];
			if (colId >= 0) {
				const col = getColumnById(colId);
				if (col) {
					h += col.processes
						.map((proc) => `${proc.id}:${proc.name}:${JSON.stringify(proc.args)}`)
						.join('|');
				}
			}
		}
		// Track preProcess changes
		h += preProcessProcs
			.map((proc) => `${proc?.name ?? ''}:${JSON.stringify(proc?.args ?? {})}`)
			.join('|');
		// Track table process args/exclusions
		h += (p.args.tableProcesses ?? [])
			.map((tp) => tp.type + JSON.stringify(tp.args) + (tp.excludedColIds ?? []).join(','))
			.join('|');
		return h;
	});
	let lastHash = '';

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

	$effect(() => {
		const dataHash = getHash;
		if (!mounted) return;
		if (dataHash !== lastHash) {
			untrack(() => {
				doLongToWide();
			});
			lastHash = dataHash;
		}
	});

	// ─── Input validation ──────────────────────────────────────────────────────

	function validateInput(newVal, excludeField) {
		const id = Number(newVal);
		if (id < 0) return null;
		const outputIds = new Set(
			Object.values(p.args.out)
				.map(Number)
				.filter((v) => v >= 0)
		);
		if (outputIds.has(id))
			return 'That column is an output of this transform and cannot be used as an input.';
		const inputs = { category: p.args.categoryIN, time: p.args.timeIN, value: p.args.valueIN };
		for (const [field, val] of Object.entries(inputs)) {
			if (field !== excludeField && Number(val) >= 0 && Number(val) === id) {
				return `That column is already used as the ${field} input.`;
			}
		}
		return null;
	}

	function onCategoryChange() {
		const err = validateInput(categoryIN_local, 'category');
		if (err) {
			errorMessage = err;
			categoryIN_local = p.args.categoryIN;
			return;
		}
		errorMessage = '';
		p.args.categoryIN = categoryIN_local;
		doLongToWide();
	}

	function onTimeChange() {
		const err = validateInput(timeIN_local, 'time');
		if (err) {
			errorMessage = err;
			timeIN_local = p.args.timeIN;
			return;
		}
		errorMessage = '';
		p.args.timeIN = timeIN_local;
		doLongToWide();
	}

	function onValueChange() {
		const err = validateInput(valueIN_local, 'value');
		if (err) {
			errorMessage = err;
			valueIN_local = p.args.valueIN;
			return;
		}
		errorMessage = '';
		p.args.valueIN = valueIN_local;
		doLongToWide();
	}

	// ─── Pre-process management ────────────────────────────────────────────────

	function addPreProcess() {
		p.args.preProcesses = [...p.args.preProcesses, { processName: '', processArgs: {} }];
		preProcessProcs = [...preProcessProcs, null];
	}

	// Minimal stand-in for a Column so process components that
	// access p.parentCol.id / .type / .removeProcess() don't crash.
	const _dummyParentCol = { id: -1, type: 'number', removeProcess() {} };

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
		doLongToWide();
	}

	function removePreProcess(idx) {
		p.args.preProcesses = p.args.preProcesses.filter((_, i) => i !== idx);
		preProcessProcs = preProcessProcs.filter((_, i) => i !== idx);
		doLongToWide();
	}

	// ─── Table process constants ───────────────────────────────────────────────

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

	// Overrides applied on top of TP defaults when used in collected mode
	const _COLLECTED_OVERRIDES = {
		cosinor: { useFixedPeriod: false, Ncurves: 1 },
		bin: { binSize: 1, stepSize: 1 }
	};

	/** Build a map from collectedType → { component, paramDefaults } from the global tableProcessMap */
	let collectedTPMap = $derived.by(() => {
		const map = {};
		for (const [, entry] of appConsts.tableProcessMap) {
			const defs = entry.defaults;
			if (!defs?.get?.('forcollected')?.val) continue;
			const cType = defs.get('collectedType')?.val;
			if (!cType) continue;
			// Extract parameter-only defaults
			const params = {};
			for (const [key, def] of defs) {
				if (_TP_INFRA_KEYS.has(key)) continue;
				params[key] = def.val ?? def;
			}
			// Apply collected-mode overrides
			const overrides = _COLLECTED_OVERRIDES[cType] ?? {};
			map[cType] = {
				component: entry.component,
				displayName: entry.displayName,
				paramDefaults: { ...params, ...overrides },
				xOutKey: entry.xOutKey ?? null,
				yOutKeyPrefix: entry.yOutKeyPrefix ?? null
			};
		}
		return map;
	});

	// ─── Table process management ──────────────────────────────────────────────

	function addTableProcess(type) {
		if (!type || !collectedTPMap[type]) return;
		const timeColId = p.args.out?.time ?? -1;
		const valueColIds = [...(p.args.valueColIds ?? [])];
		const tp = {
			id: crypto.randomUUID(),
			type,
			excludedColIds: [],
			args: {
				...collectedTPMap[type].paramDefaults,
				xIN: timeColId,
				yIN: valueColIds,
				out: {},
				valid: false
			}
		};
		p.args.tableProcesses = [...p.args.tableProcesses, tp];
	}

	function removeTableProcess(idx) {
		const tp = p.args.tableProcesses[idx];
		// Remove all output columns stored in tp.args.out
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
		const valueColIds = p.args.valueColIds ?? [];
		tp.args.yIN = valueColIds.filter((id) => !newExcluded.includes(id));
		p.args.tableProcesses = [...p.args.tableProcesses];
	}

	// ─── Main reshape ──────────────────────────────────────────────────────────

	function doLongToWide() {
		previewStart = 1;
		if (p.args.categoryIN >= 0 && p.args.timeIN >= 0 && p.args.valueIN >= 0) {
			const catData = getColumnById(p.args.categoryIN).getData();
			const seenCats = new Set();
			const categories = [];
			for (const c of catData) {
				if (c == null || c === '') continue;
				if (!seenCats.has(c)) {
					seenCats.add(c);
					categories.push(c);
				}
			}

			// Remove output columns for categories that no longer exist
			const newCatSet = new Set(categories);
			for (const oldCat of p.args.categories) {
				if (!newCatSet.has(oldCat)) {
					const outKey = 'value_' + oldCat;
					const colId = p.args.out[outKey];
					if (colId !== undefined && colId >= 0) removeColumn(colId);
					delete p.args.out[outKey];
				}
			}

			p.args.categories = categories;

			// Add output columns for new categories
			const committed = p.args.out.time >= 0 && p.parent;
			for (const cat of categories) {
				const outKey = 'value_' + cat;
				if (p.args.out[outKey] === undefined || p.args.out[outKey] === -1) {
					if (committed) {
						const tempCol = new Column({});
						tempCol.name = outKey + '_' + p.id;
						p.args.out[outKey] = tempCol.id;
						pushObj(tempCol);
						p.parent.columnRefs = [tempCol.id, ...p.parent.columnRefs];
					} else {
						p.args.out[outKey] = p.args.out[outKey] ?? -1;
					}
				}
			}

			p.args.valueColIds = categories
				.map((cat) => p.args.out['value_' + cat])
				.filter((id) => id !== undefined && id >= 0);
		}

		[longToWideResult, p.args.valid] = longtowide(p.args);

		// Update xIN / yIN for each table process after reshape
		const newTimeColId = p.args.out?.time ?? -1;
		const newValueColIds = [...(p.args.valueColIds ?? [])];
		for (const tp of p.args.tableProcesses ?? []) {
			tp.args.xIN = newTimeColId;
			const excluded = tp.excludedColIds ?? [];
			tp.args.yIN = newValueColIds.filter((id) => !excluded.includes(id));
		}
		if ((p.args.tableProcesses ?? []).length > 0) {
			p.args.tableProcesses = [...p.args.tableProcesses];
		}
	}

	onMount(() => {
		// Backfill tableProcesses for old sessions
		if (p.args.tableProcesses === undefined) p.args.tableProcesses = [];

		// Migrate: remove any null/empty-string phantom categories persisted from old sessions
		if (Array.isArray(p.args.categories)) {
			const nullCats = p.args.categories.filter((c) => c == null || c === '');
			for (const nullCat of nullCats) {
				const outKey = 'value_' + nullCat; // 'value_null' or 'value_'
				const colId = p.args.out?.[outKey];
				if (colId !== undefined && colId >= 0) {
					core.rawData.delete(colId);
					removeColumn(colId);
				}
				if (p.args.out) delete p.args.out[outKey];
			}
			p.args.categories = p.args.categories.filter((c) => c != null && c !== '');
		}

		// Migrate old tp structures to new format: { args: { ..., xIN, yIN, out, valid } }
		const _TP_X_KEY = {
			cosinor: 'cosinorx',
			bin: 'binnedx',
			smooth: 'smoothedx',
			trend: 'trendx',
			rectwave: 'rectwavex',
			dlog: 'dlogx'
		};
		const _TP_Y_PREFIX = {
			cosinor: 'cosinory_',
			bin: 'binnedy_',
			smooth: 'smoothedy_',
			trend: 'trendy_',
			rectwave: 'rectwavey_',
			dlog: 'dlogy_'
		};
		for (const tp of p.args.tableProcesses) {
			if (!tp.id) tp.id = crypto.randomUUID();
			if (!tp.args) tp.args = {};
			// Very-old format: out[colId] = { xOutId, yOutId }
			if (tp.xOutId === undefined && typeof Object.values(tp.out ?? {})[0] === 'object') {
				const firstPair = Object.values(tp.out ?? {}).find((v) => v && typeof v === 'object');
				tp.xOutId = firstPair?.xOutId ?? -1;
				const flatOut = {};
				let first = true;
				for (const [colIdStr, pair] of Object.entries(tp.out ?? {})) {
					if (pair && typeof pair === 'object') {
						if (!first && pair.xOutId >= 0) {
							core.rawData.delete(pair.xOutId);
							removeColumn(pair.xOutId);
						}
						flatOut[colIdStr] = pair.yOutId ?? -1;
						first = false;
					} else {
						flatOut[colIdStr] = pair;
					}
				}
				tp.out = flatOut;
			}
			// Mid-old format: xOutId at tp level, out[colId] = yId
			if ('xOutId' in tp) {
				const xKey = _TP_X_KEY[tp.type] ?? 'x_out';
				const yPrefix = _TP_Y_PREFIX[tp.type] ?? 'y_out_';
				const migrOut = {};
				migrOut[xKey] = tp.xOutId ?? -1;
				for (const [colId, yId] of Object.entries(tp.out ?? {})) {
					migrOut[yPrefix + colId] = yId;
				}
				tp.args.out = migrOut;
				tp.args.yIN = [];
				tp.args.xIN = p.args.out?.time ?? -1;
				tp.args.valid = false;
				delete tp.xOutId;
				delete tp.out;
			}
			// Ensure required fields exist
			if (!tp.args.out) tp.args.out = {};
			if (!tp.args.yIN) tp.args.yIN = [];
			if (tp.args.xIN === undefined) tp.args.xIN = p.args.out?.time ?? -1;
			if (tp.args.valid === undefined) tp.args.valid = false;
		}

		// Backfill preProcesses for old sessions
		if (p.args.preProcesses === undefined) {
			p.args.preProcesses = p.args.applyToAll?.processName ? [p.args.applyToAll] : [];
		}

		// Restore preProcess instances
		preProcessProcs = p.args.preProcesses.map((pp) =>
			pp.processName
				? new Process({ name: pp.processName, args: pp.processArgs }, _dummyParentCol)
				: null
		);

		// Sync local selector state
		categoryIN_local = p.args.categoryIN;
		timeIN_local = p.args.timeIN;
		valueIN_local = p.args.valueIN;

		// If saved column data exists, use it immediately
		const timeKey = p.args.out.time;
		if (timeKey >= 0 && core.rawData.has(timeKey) && core.rawData.get(timeKey).length > 0) {
			const time = core.rawData.get(timeKey);
			longToWideResult = { time };
			for (const cat of p.args.categories) {
				const outColId = p.args.out['value_' + cat];
				if (outColId >= 0 && core.rawData.has(outColId)) {
					longToWideResult['value_' + cat] = core.rawData.get(outColId);
				}
			}
			p.args.valid = true;
			if (!p.args.valueColIds) {
				p.args.valueColIds = p.args.categories
					.map((cat) => p.args.out['value_' + cat])
					.filter((id) => id !== undefined && id >= 0);
			}

			// Only skip recompute if none of the input columns have been re-imported since
			// this session was saved (rawDataVersion stays 0 from fromJSON until importData bumps it).
			// If any input was already replaced before this component mounted, force recompute.
			const inputsReimported =
				(getColumnById(p.args.categoryIN)?.rawDataVersion ?? 0) > 0 ||
				(getColumnById(p.args.timeIN)?.rawDataVersion ?? 0) > 0 ||
				(getColumnById(p.args.valueIN)?.rawDataVersion ?? 0) > 0;
			if (!inputsReimported) {
				lastHash = getHash;
			}
		}

		// Sync xIN/yIN for each table process from current state
		if (p.args.valid) {
			const initTimeColId = p.args.out?.time ?? -1;
			const initValueColIds = [...(p.args.valueColIds ?? [])];
			for (const tp of p.args.tableProcesses ?? []) {
				tp.args.xIN = initTimeColId;
				const excluded = tp.excludedColIds ?? [];
				tp.args.yIN = initValueColIds.filter((id) => !excluded.includes(id));
			}
			if ((p.args.tableProcesses ?? []).length > 0) {
				p.args.tableProcesses = [...p.args.tableProcesses];
			}
		}

		mounted = true;
	});
</script>

<!-- Input Section -->
<div class="section-row">
	<div class="tableProcess-label"><span>Input</span></div>
	<div class="control-input-vertical">
		<div class="control-input">
			<p>Category column</p>
			<ColumnSelector bind:value={categoryIN_local} onChange={onCategoryChange} />
		</div>
		<div class="control-input">
			<p>Time column</p>
			<ColumnSelector
				bind:value={timeIN_local}
				excludeColIds={[p.args.categoryIN]}
				onChange={onTimeChange}
			/>
		</div>
		<div class="control-input">
			<p>Value column</p>
			<ColumnSelector
				bind:value={valueIN_local}
				excludeColIds={[p.args.categoryIN, p.args.timeIN]}
				onChange={onValueChange}
			/>
		</div>
		{#if errorMessage}
			<p class="error-message">{errorMessage}</p>
		{/if}
	</div>
</div>

<!-- Output / Preview -->
<details open>
	<summary class="section-details-summary">Output</summary>
	<div class="section-row">
		<div class="section-content">
			{#key longToWideResult}
				{#if p.args.valid && p.args.out.time >= 0}
					<div class="tableProcess-label"><span>Output</span></div>
					<ColumnComponent col={getColumnById(p.args.out.time)} />
					{#each p.args.categories as cat}
						{#if p.args.out['value_' + cat] >= 0}
							<ColumnComponent col={getColumnById(p.args.out['value_' + cat])} />
						{/if}
					{/each}
				{:else if p.args.valid && longToWideResult?.time?.length}
					{@const totalRows = longToWideResult.time.length}
					<Table
						headers={['time', ...p.args.categories]}
						data={[
							timeIsTime
								? longToWideResult.time.slice(previewStart - 1, previewStart + 5).map((t) => ({
										isTime: true,
										raw: formatTimeFromUNIX(t),
										computed: ((t - longToWideResult.time[0]) / 3600000).toFixed(2)
									}))
								: longToWideResult.time.slice(previewStart - 1, previewStart + 5),
							...p.args.categories.map((cat) =>
								longToWideResult['value_' + cat].slice(previewStart - 1, previewStart + 5)
							)
						]}
					/>
					<p>
						Row <NumberWithUnits
							min={1}
							max={Math.max(1, totalRows - 5)}
							step={1}
							bind:value={previewStart}
						/> to {Math.min(previewStart + 5, totalRows)} of {totalRows}
					</p>
				{:else}
					<p>Select valid input columns to see preview.</p>
				{/if}
			{/key}
		</div>
	</div>
</details>

<!-- Pre-process Section -->
{#if p.args.valid}
	<div class="section-row">
		<div class="tableProcess-label"><span>Pre-process</span></div>
		<div class="control-input-vertical">
			{#each p.args.preProcesses as pp, idx (idx)}
				<div class="tp-block">
					<div class="tp-header">
						<span class="tp-title">Step {idx + 1}</span>
						<button class="remove-btn" onclick={() => removePreProcess(idx)} title="Remove"
							>×</button
						>
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
{/if}

<!-- Table Processes Section -->
{#if p.args.valid}
	<div class="section-row">
		<div class="tableProcess-label"><span>Table processes</span></div>
		<div class="control-input-vertical">
			{#each p.args.tableProcesses as tp, tpIdx (tpIdx)}
				<div class="tp-block">
					<div class="tp-header">
						<span class="tp-title">{collectedTPMap[tp.type]?.displayName ?? tp.type}</span>
						<button class="remove-btn" onclick={() => removeTableProcess(tpIdx)} title="Remove"
							>×</button
						>
					</div>

					<!-- Column checklist (include/exclude) -->
					{#if true}
						{@const checklistItems =
							(p.args.valueColIds?.length ?? 0) > 0
								? p.args.valueColIds.map((id) => ({
										id,
										label: getColumnById(id)?.name ?? `col ${id}`
									}))
								: (p.args.categories ?? []).map((cat) => ({ id: cat, label: cat }))}
						{#if checklistItems.length > 0}
							{@const excluded = tp.excludedColIds ?? []}
							{@const nActive = checklistItems.length - excluded.length}
							<div class="control-input-vertical">
								<p>Columns ({nActive} of {checklistItems.length} included)</p>
								<div class="col-checklist">
									{#each checklistItems as item (item.id)}
										{@const included = !excluded.includes(item.id)}
										<label class="col-check-item">
											<input
												type="checkbox"
												checked={included}
												onchange={() => toggleExcludeForTp(tpIdx, item.id)}
											/>
											{item.label}
										</label>
									{/each}
								</div>
							</div>
						{/if}
					{/if}

					<!-- Type-specific parameters (rendered by the TP component) -->
					{#if collectedTPMap[tp.type]?.component}
						{@const DynamicTP = collectedTPMap[tp.type].component}
						<DynamicTP p={{ id: tp.id, args: tp.args, parent: p.parent }} hideInputs={true} />
					{/if}

					<!-- ChainedPanel for chainable sub-TPs -->
					{#if collectedTPMap[tp.type]?.xOutKey && tp.args?.valid}
						{@const _tpEntry = collectedTPMap[tp.type]}
						{@const _subXOut = tp.args?.out?.[_tpEntry.xOutKey] ?? -1}
						{@const _subYOuts = Object.entries(tp.args?.out ?? {})
							.filter(([k]) => k.startsWith(_tpEntry.yOutKeyPrefix))
							.map(([, id]) => id)
							.filter((id) => typeof id === 'number' && id >= 0)}
						<ChainedPanel
							bind:p={p.args.tableProcesses[tpIdx]}
							xOutColId={_subXOut}
							yOutColIds={_subYOuts}
							parentRef={p.parent}
						/>
					{/if}
				</div>
			{/each}

			<!-- Add table process dropdown -->
			<select
				class="add-tp-select"
				onchange={(e) => {
					addTableProcess(e.target.value);
					e.target.value = '';
				}}
			>
				<option value="">+ Add table process…</option>
				{#each Object.entries(collectedTPMap) as [cType, entry] (cType)}
					<option value={cType}>{entry.displayName}</option>
				{/each}
			</select>
		</div>
	</div>
{/if}

<style>
	.error-message {
		color: #c0392b;
		font-size: 12px;
		margin: 0.25rem 0;
	}

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
		background: none;
		border: 1px dashed var(--color-lightness-75, #aaa);
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
		padding: 0.3rem 0.6rem;
		color: var(--color-lightness-45, #666);
		width: 100%;
	}

	.add-tp-select:hover {
		border-color: var(--color-lightness-55, #888);
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
