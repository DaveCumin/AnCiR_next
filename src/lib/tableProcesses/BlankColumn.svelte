<script module>
	import { core, getStoredValue } from '$lib/core/core.svelte';

	const displayName = 'Enter Data';
	const defaults = new Map([
		['N', { val: 10 }],
		['storedValueRefs', { val: {} }],
		['out', { result: { val: -1 } }],
		['valid', { val: false }]
	]);

	export function blankcolumn(argsIN) {
		const count = Math.max(0, Math.floor(Number(argsIN.N)));
		let result = new Array(count).fill(NaN);

		if (argsIN.out.result == null || argsIN.out.result < 0) {
			// preview only (output column not allocated yet)
		} else {
			// Preserve existing data if present and only resize
			const existing = core.rawData.get(argsIN.out.result);
			if (existing && Array.isArray(existing)) {
				if (existing.length < count) {
					result = [...existing, ...new Array(count - existing.length).fill('')];
				} else {
					result = existing.slice(0, count);
				}
			}
			// Apply stored value references
			const refs = argsIN.storedValueRefs || {};
			for (const [idx, key] of Object.entries(refs)) {
				const i = Number(idx);
				if (i < count && key in core.storedValues) {
					result[i] = getStoredValue(key);
				}
			}

			core.rawData.set(argsIN.out.result, result);
			getColumnById(argsIN.out.result).data = argsIN.out.result;
			getColumnById(argsIN.out.result).type = 'category';
			const processHash = crypto.randomUUID();
			getColumnById(argsIN.out.result).tableProcessGUId = processHash;
		}

		return [result, true];
	}

	export const definition = {
		displayName,
		defaults,
		func: blankcolumn,
		columnIdFields: {},
		nodeSpec: {
			id: 'tableprocess.blankcolumn',
			inputs: [],
			outputs: [{ name: 'result', kind: 'column', cardinality: 'one' }]
		}
	};
</script>

<script>
	import ColumnComponent from '$lib/core/Column.svelte';
	import { getColumnById, removeColumn, Column } from '$lib/core/Column.svelte';
	import { pushObj } from '$lib/core/core.svelte.js';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import VirtualList from '$lib/components/reusables/VirtualList.svelte';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	if (!p.args.storedValueRefs) p.args.storedValueRefs = {};

	let result = $state([]);
	let editableData = $state([]);

	// Fixed row height for the virtualised table (must match .vrow CSS height).
	const ROW_H = 26;

	// Resizable table viewport — drag the handle to see more rows in the node.
	// Persisted on p.args so it survives save/load (args is a freeform bag).
	let tableHeight = $state(Math.max(120, Number(p.args.editorHeight) || 300));
	let resizing = false;
	function onResizeDown(e) {
		e.preventDefault();
		e.stopPropagation();
		resizing = true;
		const startY = e.clientY;
		const startH = tableHeight;
		const move = (ev) => {
			if (!resizing) return;
			tableHeight = Math.max(120, startH + (ev.clientY - startY));
		};
		const up = () => {
			resizing = false;
			p.args.editorHeight = tableHeight;
			window.removeEventListener('mousemove', move);
			window.removeEventListener('mouseup', up);
		};
		window.addEventListener('mousemove', move);
		window.addEventListener('mouseup', up);
	}

	function doBlank() {
		// Clean up stored value refs for rows beyond the new count
		const count = Math.max(0, Math.floor(Number(p.args.N)));
		for (const idx of Object.keys(p.args.storedValueRefs)) {
			if (Number(idx) >= count) delete p.args.storedValueRefs[idx];
		}
		[result, p.args.valid] = blankcolumn(p.args);
		editableData = [...result];
		// Re-commit so the result column gets the same numeric detection as the
		// extras (blank cells become NaN for a numeric column, not '').
		commitData();
		// Keep any extra (pasted) columns the same length as the row count.
		for (const c of extraCols) {
			const arr = extraData[c.colId] ?? [];
			if (arr.length < count)
				extraData[c.colId] = [...arr, ...new Array(count - arr.length).fill('')];
			else if (arr.length > count) extraData[c.colId] = arr.slice(0, count);
			commitExtra(c.colId);
		}
	}

	onMount(() => {
		const outKey = p.args.out.result;
		if (outKey >= 0 && core.rawData.has(outKey) && core.rawData.get(outKey).length > 0) {
			result = core.rawData.get(outKey);
			editableData = [...result];
			p.args.valid = true;
		} else {
			doBlank();
		}
	});

	// ── Multi-column support ──────────────────────────────────────────────────
	// All output columns: the default `result` column first, then any `col_<n>`
	// columns created by a multi-column paste. The result column keeps the full
	// stored-value editor; the extras render as plain editable text columns.
	let outputCols = $derived.by(() => {
		const o = p.args.out || {};
		const list = [];
		if (typeof o.result === 'number' && o.result >= 0)
			list.push({ key: 'result', colId: o.result });
		for (const k of Object.keys(o)
			.filter((k) => /^col_\d+$/.test(k))
			.sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))) {
			if (typeof o[k] === 'number' && o[k] >= 0) list.push({ key: k, colId: o[k] });
		}
		return list.map((e) => ({ ...e, col: getColumnById(e.colId) })).filter((e) => e.col);
	});
	let extraCols = $derived(outputCols.filter((c) => c.key !== 'result'));
	const COL_MIN_W = 90; // px per data column (keep in sync with the grid minmax below)
	let gridTemplate = $derived(
		`44px repeat(${Math.max(1, outputCols.length)}, minmax(${COL_MIN_W}px, 1fr))`
	);
	// Min content width so the table scrolls horizontally (instead of squashing
	// columns) once there are more than fit. Row-number gutter + N data columns.
	let etMinWidth = $derived(44 + Math.max(1, outputCols.length) * COL_MIN_W);

	// Editable string buffers for the extra columns, keyed by colId (mirrors
	// `editableData` for the result column so partially-typed numbers aren't
	// clobbered by the numeric coercion on commit). Adds buffers for new columns
	// and drops them for removed ones, without discarding in-progress edits.
	let extraData = $state({});
	$effect(() => {
		const ids = extraCols.map((c) => c.colId);
		untrack(() => {
			const next = {};
			for (const id of ids) {
				next[id] =
					extraData[id] ?? (core.rawData.get(id) ?? []).map((v) => (v == null ? '' : String(v)));
			}
			extraData = next;
		});
	});

	function commitExtra(colId) {
		const col = getColumnById(colId);
		if (!col) return;
		const vals = extraData[colId] ?? [];
		const allNumeric = vals.every((v) => v === '' || !isNaN(Number(v)));
		if (allNumeric && vals.some((v) => v !== '')) {
			core.rawData.set(
				colId,
				vals.map((v) => (v === '' ? NaN : Number(v)))
			);
			col.type = 'number';
		} else {
			core.rawData.set(
				colId,
				vals.map((v) => String(v))
			);
			col.type = 'category';
		}
		col.data = colId;
		col.tableProcessGUId = crypto.randomUUID();
	}

	function handleExtraInput(colId, i, val) {
		if (!extraData[colId]) extraData[colId] = [];
		extraData[colId][i] = val;
		commitExtra(colId);
	}

	function updateCell(index, value) {
		editableData[index] = value;
		commitData();
	}

	// ── Stored value reactivity ──────────────────────────────────────────────
	let svHash = $derived.by(() => {
		const refs = p.args.storedValueRefs || {};
		const keys = [...new Set(Object.values(refs))];
		return keys.map((k) => `${k}:${getStoredValue(k)}`).join(',');
	});

	let lastSvHash = '';
	$effect(() => {
		const h = svHash;
		if (lastSvHash === h) return;
		lastSvHash = h;
		untrack(() => {
			const refs = p.args.storedValueRefs || {};
			let changed = false;
			for (const [idx, key] of Object.entries(refs)) {
				const i = Number(idx);
				if (key in core.storedValues) {
					const val = getStoredValue(key);
					if (editableData[i] !== val) {
						editableData[i] = val;
						changed = true;
					}
				}
			}
			if (changed) {
				editableData = [...editableData];
				commitData();
			}
		});
	});

	// ── Autocomplete state ───────────────────────────────────────────────────
	let ac = $state({ show: false, cellIndex: -1, filter: '', selIdx: 0 });
	let acPos = $state({ left: 0, top: 0 });

	let allStoredValues = $derived(
		Object.entries(core.storedValues).map(([key, entry]) => ({
			key,
			value: getStoredValue(key),
			source: entry.source
		}))
	);

	let filteredStoredValues = $derived.by(() => {
		if (!ac.show) return [];
		if (!ac.filter) return allStoredValues;
		const f = ac.filter.toLowerCase();
		return allStoredValues.filter((sv) => sv.key.toLowerCase().includes(f));
	});

	function closeAc() {
		ac = { show: false, cellIndex: -1, filter: '', selIdx: 0 };
	}

	function handleCellInput(e, index) {
		const val = e.target.value;
		editableData[index] = val;

		const cursor = e.target.selectionStart ?? val.length;
		let triggerPos = -1;
		for (let i = cursor - 1; i >= 0; i--) {
			if (val[i] === '#') {
				triggerPos = i;
				break;
			}
			if (val[i] === ' ') break;
		}

		if (triggerPos >= 0) {
			const filter = val.slice(triggerPos + 1, cursor);
			const rect = e.target.getBoundingClientRect();
			acPos = { left: rect.left, top: rect.bottom + 2 };
			ac = { show: true, cellIndex: index, filter, selIdx: 0 };
		} else {
			closeAc();
			commitData();
		}
	}

	function handleCellKeydown(e, index) {
		if (!ac.show) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			ac.selIdx = Math.min(ac.selIdx + 1, filteredStoredValues.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			ac.selIdx = Math.max(ac.selIdx - 1, 0);
		} else if (e.key === 'Enter' || e.key === 'Tab') {
			if (filteredStoredValues.length > 0) {
				e.preventDefault();
				assignStoredValue(filteredStoredValues[ac.selIdx].key, index);
			} else {
				closeAc();
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			closeAc();
			commitData();
		}
	}

	function assignStoredValue(key, index) {
		p.args.storedValueRefs[index] = key;
		editableData[index] = getStoredValue(key);
		editableData = [...editableData];
		closeAc();
		commitData();
	}

	function removeStoredValueRef(index) {
		delete p.args.storedValueRefs[index];
		editableData[index] = '';
		editableData = [...editableData];
		commitData();
	}

	function commitData() {
		if (p.args.out.result >= 0) {
			// Apply stored value refs before committing
			const refs = p.args.storedValueRefs || {};
			for (const [idx, key] of Object.entries(refs)) {
				const i = Number(idx);
				if (key in core.storedValues) {
					editableData[i] = getStoredValue(key);
				}
			}

			// Try to detect numeric data
			const allNumeric = editableData.every((v) => v === '' || !isNaN(Number(v)));
			const col = getColumnById(p.args.out.result);
			if (allNumeric && editableData.some((v) => v !== '')) {
				const numData = editableData.map((v) => (v === '' ? NaN : Number(v)));
				core.rawData.set(p.args.out.result, numData);
				col.type = 'number';
			} else {
				core.rawData.set(p.args.out.result, [...editableData]);
				col.type = 'category';
			}
			const processHash = crypto.randomUUID();
			col.tableProcessGUId = processHash;
			result = [...editableData];
		}
	}

	// ── Multi-column CSV / JSON paste ─────────────────────────────────────────
	// Parses pasted tabular text into N columns and materialises them as the
	// node's output columns: column 0 reuses the default `result` column (so the
	// manual row editor keeps working on it); columns 1..N-1 become extra
	// `col_<j>` outputs created on the fly. Stale extras from a previous, wider
	// paste are removed.
	let pasteText = $state('');
	let parseStatus = $state(null); // { ok: boolean, msg: string } | null

	function splitCsvLine(line, delim) {
		const out = [];
		let cur = '';
		let inQ = false;
		for (let i = 0; i < line.length; i++) {
			const c = line[i];
			if (inQ) {
				if (c === '"') {
					if (line[i + 1] === '"') {
						cur += '"';
						i++;
					} else inQ = false;
				} else cur += c;
			} else if (c === '"') inQ = true;
			else if (c === delim) {
				out.push(cur);
				cur = '';
			} else cur += c;
		}
		out.push(cur);
		return out.map((s) => s.trim());
	}

	function parseJsonTable(j) {
		if (Array.isArray(j)) {
			if (j.length === 0) return null;
			if (Array.isArray(j[0])) {
				const ncol = Math.max(...j.map((r) => r.length));
				const first = j[0].map((v) => String(v));
				const headerLike = first.every((c) => c === '' || isNaN(Number(c)));
				const headers = headerLike
					? first
					: Array.from({ length: ncol }, (_, i) => `column_${i + 1}`);
				const dataRows = headerLike ? j.slice(1) : j;
				return {
					columns: Array.from({ length: ncol }, (_, i) => ({
						name: headers[i] || `column_${i + 1}`,
						values: dataRows.map((r) => r[i] ?? '')
					})),
					rows: dataRows.length
				};
			}
			if (typeof j[0] === 'object' && j[0] !== null) {
				const keys = [];
				for (const o of j) for (const k of Object.keys(o)) if (!keys.includes(k)) keys.push(k);
				return {
					columns: keys.map((k) => ({ name: k, values: j.map((o) => o[k] ?? '') })),
					rows: j.length
				};
			}
			return { columns: [{ name: 'value', values: j }], rows: j.length };
		}
		if (j && typeof j === 'object') {
			const keys = Object.keys(j).filter((k) => Array.isArray(j[k]));
			if (keys.length === 0) return null;
			const rows = Math.max(...keys.map((k) => j[k].length));
			return { columns: keys.map((k) => ({ name: k, values: j[k] })), rows };
		}
		return null;
	}

	function parseTabular(text) {
		const t = (text ?? '').trim();
		if (!t) return null;
		if (t[0] === '[' || t[0] === '{') {
			try {
				return parseJsonTable(JSON.parse(t));
			} catch {
				// not JSON — fall through to delimited parsing
			}
		}
		const lines = t.split(/\r?\n/).filter((l, i, a) => !(i === a.length - 1 && l === ''));
		if (lines.length === 0) return null;
		const delim = lines[0].includes('\t') ? '\t' : ',';
		const rows = lines.map((l) => splitCsvLine(l, delim));
		const ncol = Math.max(...rows.map((r) => r.length));
		const first = rows[0];
		const headerLike =
			first.every((c) => c === '' || isNaN(Number(c))) && first.some((c) => c !== '');
		const headers = headerLike ? first : Array.from({ length: ncol }, (_, i) => `column_${i + 1}`);
		const dataRows = headerLike ? rows.slice(1) : rows;
		return {
			columns: Array.from({ length: ncol }, (_, i) => ({
				name: (headers[i] ?? `column_${i + 1}`) || `column_${i + 1}`,
				values: dataRows.map((r) => (r[i] === undefined ? '' : r[i]))
			})),
			rows: dataRows.length
		};
	}

	// Write a column's data + type (numeric detection mirrors commitData()).
	function setColData(colId, values) {
		const col = getColumnById(colId);
		if (!col) return;
		const vals = values.map((v) => (v == null ? '' : v));
		const allNumeric = vals.every((v) => v === '' || !isNaN(Number(v)));
		if (allNumeric && vals.some((v) => v !== '')) {
			core.rawData.set(
				colId,
				vals.map((v) => (v === '' ? NaN : Number(v)))
			);
			col.type = 'number';
		} else {
			core.rawData.set(
				colId,
				vals.map((v) => String(v))
			);
			col.type = 'category';
		}
		col.data = colId;
		col.tableProcessGUId = crypto.randomUUID();
	}

	// Materialise parsed tabular data as the node's output columns: column 0 reuses
	// the default `result` column (keeping the manual editor in sync); columns 1..N-1
	// become `col_<j>` outputs created on the fly; stale wider-paste extras removed.
	function applyParsed(parsed) {
		const cols = parsed.columns;

		// Column 0 → reuse the default `result` column and keep the manual editor in sync.
		p.args.storedValueRefs = {}; // a paste overrides any stored-value cells
		setColData(p.args.out.result, cols[0].values);
		const c0 = getColumnById(p.args.out.result);
		if (c0) c0.customName = cols[0].name;
		editableData = cols[0].values.map((v) => (v == null ? '' : String(v)));
		p.args.N = editableData.length;

		// Columns 1..N-1 → create/reuse `col_<j>` outputs.
		for (let j = 1; j < cols.length; j++) {
			const key = `col_${j}`;
			let id = p.args.out[key];
			let col = typeof id === 'number' && id >= 0 ? getColumnById(id) : null;
			if (!col) {
				col = new Column({});
				col.tableProcessGUId = crypto.randomUUID();
				pushObj(col);
				id = col.id;
				p.args.out[key] = id;
			}
			setColData(id, cols[j].values);
			col.customName = cols[j].name;
			// Refresh the editable buffer (re-pasting the same columns keeps the
			// colId, so the sync effect wouldn't reload it on its own).
			extraData[id] = cols[j].values.map((v) => (v == null ? '' : String(v)));
		}

		// Drop any extra columns left over from a previous, wider paste.
		for (const key of Object.keys(p.args.out)) {
			const m = /^col_(\d+)$/.exec(key);
			if (m && Number(m[1]) >= cols.length) {
				const id = p.args.out[key];
				if (typeof id === 'number' && id >= 0) {
					core.rawData.delete(id);
					try {
						removeColumn(id);
					} catch {
						/* column may already be gone */
					}
				}
				delete p.args.out[key];
			}
		}

		p.args.valid = true;
		result = [...editableData];
		parseStatus = {
			ok: true,
			msg: `Created ${cols.length} column${cols.length === 1 ? '' : 's'} × ${parsed.rows} row${parsed.rows === 1 ? '' : 's'}.`
		};
	}

	// "Paste CSV or JSON" box → button.
	function createColumnsFromPaste() {
		const parsed = parseTabular(pasteText);
		if (!parsed || parsed.columns.length === 0) {
			parseStatus = { ok: false, msg: 'Could not read any columns from that text.' };
			return;
		}
		if (p.args.out.result < 0) {
			parseStatus = { ok: false, msg: 'Output column not ready yet — try again.' };
			return;
		}
		applyParsed(parsed);
		pasteText = '';
	}

	function handlePaste(event) {
		event.preventDefault();
		const text = event.clipboardData.getData('text/plain');
		if (!text) return;

		// Multi-column paste (CSV with commas, or Excel/Sheets tab-separated, or JSON)
		// → create one output column per pasted column instead of keeping only the
		// first. Single-column pastes fall through to the focused-cell fill below.
		const parsedMulti = parseTabular(text);
		if (parsedMulti && parsedMulti.columns.length > 1 && p.args.out.result >= 0) {
			applyParsed(parsedMulti);
			return;
		}

		// Split by newlines (handles both \n and \r\n from spreadsheets)
		const lines = text.split(/\r?\n/).filter((line, i, arr) => {
			// Remove trailing empty line that spreadsheets often add
			if (i === arr.length - 1 && line === '') return false;
			return true;
		});

		// Get the index of the currently focused cell
		const target = event.target;
		let startIndex = 0;
		if (target && target.dataset && target.dataset.index !== undefined) {
			startIndex = Number(target.dataset.index);
		}

		// Expand editableData if needed
		const needed = startIndex + lines.length;
		if (needed > editableData.length) {
			const extra = new Array(needed - editableData.length).fill('');
			editableData = [...editableData, ...extra];
			p.args.N = needed;
		}

		// Fill in pasted values
		for (let i = 0; i < lines.length; i++) {
			// Handle tab-separated values: take only the first column,
			// since this is a single-column process
			const cellValue = lines[i].split('\t')[0].trim();
			editableData[startIndex + i] = cellValue;
			// Clear any stored value ref for this cell
			delete p.args.storedValueRefs[startIndex + i];
		}

		editableData = [...editableData]; // trigger reactivity
		commitData();
	}
</script>

<!-- Close autocomplete on outside click -->
<svelte:window
	onclick={(e) => {
		if (ac.show && !e.target.closest('.editable-table')) {
			closeAc();
			commitData();
		}
	}}
/>

<div class="section-row">
	<div class="tableProcess-label">
		<span>Data entry settings</span>
	</div>

	<div class="control-input">
		<p>Number of rows</p>
		<NumberWithUnits bind:value={p.args.N} onInput={doBlank} min={1} step={1} />
	</div>
</div>

<details class="paste-section">
	<summary class="section-details-summary">Paste CSV or JSON</summary>
	<p class="hint">
		Paste a table (CSV/TSV, optional header row) or JSON (array of objects, array of arrays, or
		object of arrays). The first column fills this node; any extra columns are added as outputs.
	</p>
	<textarea
		class="paste-box"
		bind:value={pasteText}
		rows="5"
		placeholder={'name,age\nAda,36\nAlan,41'}
	></textarea>
	<div class="paste-actions">
		<button
			type="button"
			class="paste-btn"
			onclick={createColumnsFromPaste}
			disabled={!pasteText.trim()}>Create columns</button
		>
		{#if parseStatus}
			<span class="paste-status" class:err={!parseStatus.ok}>{parseStatus.msg}</span>
		{/if}
	</div>
</details>

{#if p.args.out.result >= 0}
	<details open>
		<summary class="section-details-summary">Output</summary>
		{#each outputCols as oc (oc.colId)}
			<ColumnComponent col={oc.col} />
		{/each}

		<div class="section-row">
			<div class="tableProcess-label">
				<span>Edit data</span>
			</div>
		</div>
		<p class="hint">
			Click cells to edit. Paste a spreadsheet/CSV into any cell to fill multiple columns. Type
			<kbd>#</kbd> for stored values (first column). Drag the handle below to resize.
		</p>
		<div class="editable-table" onpaste={handlePaste}>
			<div class="et-inner" style="min-width:{etMinWidth}px;">
				<div class="vt-head" style="grid-template-columns:{gridTemplate};">
					<span class="vt-h-row">Row</span>
					{#each outputCols as oc (oc.colId)}
						<span class="vt-h-val" title={oc.col?.name}>{oc.col?.name ?? ''}</span>
					{/each}
				</div>
				<VirtualList items={editableData} height={tableHeight} itemHeight={ROW_H}>
					{#snippet row(cell, i)}
						<div class="vrow" style="grid-template-columns:{gridTemplate};">
							<span class="row-num">{i + 1}</span>
							<!-- result column: keeps the stored-value (#) editor -->
							<span class="vcell">
								{#if p.args.storedValueRefs[i]}
									{@const key = p.args.storedValueRefs[i]}
									{@const exists = key in core.storedValues}
									<span class="chip chip-stored" class:chip-invalid={!exists}>
										<span class="sv-name">{key}</span>
										{#if exists}
											<span class="sv-value">= {getStoredValue(key)}</span>
										{:else}
											<span class="sv-value">(removed)</span>
										{/if}
										<button
											class="chip-remove"
											onclick={() => removeStoredValueRef(i)}
											title="Remove">×</button
										>
									</span>
								{:else}
									<input
										type="text"
										value={cell}
										data-index={i}
										oninput={(e) => handleCellInput(e, i)}
										onkeydown={(e) => handleCellKeydown(e, i)}
									/>
								{/if}
							</span>
							<!-- extra (pasted) columns: plain editable text -->
							{#each extraCols as ec (ec.colId)}
								<span class="vcell">
									<input
										type="text"
										value={extraData[ec.colId]?.[i] ?? ''}
										oninput={(e) => handleExtraInput(ec.colId, i, e.currentTarget.value)}
									/>
								</span>
							{/each}
						</div>
					{/snippet}
				</VirtualList>
				<div
					class="vt-resize"
					role="separator"
					aria-label="Resize table"
					title="Drag to resize"
					onmousedown={onResizeDown}
				></div>
			</div>
		</div>

		{#if ac.show}
			<div class="ac-dropdown" style="left: {acPos.left}px; top: {acPos.top}px;" role="listbox">
				{#if filteredStoredValues.length === 0}
					<div class="ac-empty">No matching stored values</div>
				{:else}
					{#each filteredStoredValues as sv, j (sv.key)}
						<div
							class="ac-item"
							class:ac-selected={j === ac.selIdx}
							role="option"
							tabindex="-1"
							aria-selected={j === ac.selIdx}
							onmousedown={(e) => {
								e.preventDefault();
								assignStoredValue(sv.key, ac.cellIndex);
							}}
							onmouseenter={() => (ac.selIdx = j)}
						>
							<span class="ac-sv-name">{sv.key}</span>
							<span class="ac-sv-value">= {sv.value}</span>
						</div>
					{/each}
				{/if}
			</div>
		{/if}
	</details>
{:else}
	<p>Column will be created with {p.args.N} blank rows.</p>
{/if}

<style>
	.hint {
		font-size: var(--font-sm);
		color: var(--color-lightness-50, #888);
		margin: 0.25rem 0;
	}

	.paste-section {
		margin: 0.4rem 0;
	}
	.paste-box {
		width: 100%;
		box-sizing: border-box;
		font-family: var(--font-mono, ui-monospace, SF Mono, monospace);
		font-size: var(--font-sm);
		padding: 0.4rem;
		border: 1px solid var(--color-lightness-85, #ddd);
		border-radius: 3px;
		resize: vertical;
	}
	.paste-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.3rem;
	}
	.paste-btn {
		padding: 0.25rem 0.6rem;
		font-size: var(--font-sm);
		border: 1px solid var(--color-lightness-70, #b0b0b0);
		border-radius: 3px;
		background: var(--color-lightness-97, #f8f8f8);
		cursor: pointer;
	}
	.paste-btn:hover:not(:disabled) {
		background: var(--color-lightness-90, #e8e8e8);
	}
	.paste-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.paste-status {
		font-size: var(--font-xs);
		color: var(--color-lightness-45, #2a7a2a);
	}
	.paste-status.err {
		color: #b03030;
	}

	.hint kbd {
		background: var(--color-lightness-85, #ddd);
		border-radius: 3px;
		padding: 0.05rem 0.3rem;
		font-size: var(--font-xs);
		font-family: monospace;
	}

	.editable-table {
		margin: 0.25rem 0;
		border: 1px solid var(--color-lightness-85, #ddd);
		border-radius: 3px;
		font-size: var(--font-md);
		overflow-x: auto; /* scroll horizontally when columns exceed the width */
	}
	/* Holds the header + virtual body at a min content width so the wrapper above
	   scrolls horizontally instead of squashing the columns. */
	.et-inner {
		display: flex;
		flex-direction: column;
	}

	.vt-head {
		display: grid;
		align-items: center;
		background: var(--color-lightness-95, #f5f5f5);
		border-bottom: 1px solid var(--color-lightness-85, #ddd);
		font-weight: 600;
		height: 24px;
	}
	.vt-h-row {
		text-align: center;
		font-size: var(--font-xs);
		border-right: 1px solid var(--color-lightness-85, #ddd);
		align-self: stretch;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.vt-h-val {
		padding-left: 4px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		border-right: 1px solid var(--color-lightness-90, #eee);
	}

	.vrow {
		display: grid;
		align-items: center;
		height: 26px; /* must match ROW_H */
		border-bottom: 1px solid var(--color-lightness-90, #eee);
	}
	.vrow .row-num {
		text-align: center;
		color: var(--color-lightness-50, #888);
		font-size: var(--font-xs);
		border-right: 1px solid var(--color-lightness-85, #ddd);
		align-self: stretch;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.vcell {
		min-width: 0;
		display: flex;
		align-items: center;
		padding: 0 4px;
		border-right: 1px solid var(--color-lightness-90, #eee);
	}
	.vcell:last-child {
		border-right: none;
	}

	.editable-table input {
		width: 100%;
		border: none;
		background: transparent;
		padding: 2px;
		font-size: var(--font-md);
		box-sizing: border-box;
	}

	.editable-table input:focus {
		outline: 2px solid var(--color-primary, #007bff);
		outline-offset: -1px;
		background: var(--color-lightness-97, #fafafa);
	}

	/* Bottom drag strip to resize the table viewport (see more rows). */
	.vt-resize {
		height: 10px;
		cursor: ns-resize;
		background: linear-gradient(
			180deg,
			transparent 0 40%,
			var(--color-lightness-60, #8a8a8a) 40% 50%,
			transparent 50% 60%,
			var(--color-lightness-60, #8a8a8a) 60% 70%,
			transparent 70%
		);
		background-size: 100% 100%;
		border-top: 1px solid var(--color-lightness-85, #ddd);
		opacity: 0.5;
	}
	.vt-resize:hover {
		opacity: 1;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.15rem 0.4rem 0.15rem 0.55rem;
		border-radius: 999px;
		font-size: var(--font-sm);
		font-weight: 600;
		white-space: nowrap;
		user-select: none;
		max-width: 100%;
		overflow: hidden;
	}

	.chip-stored {
		background-color: #90d94a66;
		color: #2a5c1a;
	}

	.chip-invalid {
		background-color: #d94a4a33;
		color: #8b1a1a;
	}

	.sv-name {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.sv-value {
		font-weight: 400;
		font-size: var(--font-xs);
		opacity: 0.75;
	}

	.chip-remove {
		background: none;
		border: none;
		cursor: pointer;
		font-size: var(--font-lg);
		line-height: 1;
		padding: 0;
		color: inherit;
		opacity: 0.6;
		flex-shrink: 0;
	}

	.chip-remove:hover {
		opacity: 1;
	}

	.ac-dropdown {
		position: fixed;
		width: 220px;
		max-height: 180px;
		overflow-y: auto;
		background: var(--color-lightness-97, #f8f8f8);
		border: 1px solid var(--color-lightness-85, #ccc);
		border-radius: var(--radius-sm);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		z-index: 200;
	}

	.ac-item {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0.35rem 0.6rem;
		cursor: pointer;
		font-size: var(--font-md);
	}

	.ac-item:hover,
	.ac-selected {
		background-color: var(--color-lightness-85, #e0e0e0);
	}

	.ac-sv-name {
		font-weight: 600;
	}

	.ac-sv-value {
		font-size: var(--font-xs);
		color: var(--color-lightness-55, #777);
	}

	.ac-empty {
		padding: 0.4rem 0.6rem;
		font-size: var(--font-md);
		color: var(--color-lightness-55, #777);
		font-style: italic;
	}
</style>
