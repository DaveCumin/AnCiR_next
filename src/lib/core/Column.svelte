<script module>
	// @ts-nocheck

	import { Process, nextLinkedGroupId, getLinkedProcesses } from '$lib/core/Process.svelte';
	import { core, appConsts, appState } from '$lib/core/core.svelte.js';
	import {
		resolveProducer,
		touchProducerDeps,
		getProducerProcess,
		producerInputColId
	} from '$lib/core/producerRuntime.js';
	import { getUNIXDate } from '$lib/utils/time/TimeUtils.js';
	import { min } from '$lib/components/plotbits/helpers/wrangleData';

	// Monotonic counter bumped whenever any Column's getDataHash $derived re-runs.
	// Returning a fresh integer gives us cheap !== equality for cache invalidation
	// without having to serialise the args tree on every read.
	let _hashCounter = 0;

	// Walk a reactive tree to register Svelte dependencies on every leaf, without
	// allocating a string. Any mutation inside the tree signals the $derived to
	// re-run and bump _hashCounter, so the cached data on the Column is busted.
	function _touchTree(v) {
		if (v == null || typeof v !== 'object') return;
		if (Array.isArray(v)) {
			for (let i = 0; i < v.length; i++) _touchTree(v[i]);
			return;
		}
		for (const k in v) _touchTree(v[k]);
	}

	/**
	 * Add the same process to multiple columns at once.
	 * If more than one column is provided, the processes are linked
	 * so that changing args on one updates all the others.
	 * All linked processes share the same args object.
	 */
	export function addProcessToColumns(columns, processName) {
		const groupId = columns.length > 1 ? nextLinkedGroupId() : null;
		let sharedArgs = null;
		for (const col of columns) {
			const newProcess = new Process({ name: processName, linkedGroupId: groupId }, col);
			if (groupId != null) {
				if (sharedArgs === null) {
					sharedArgs = newProcess.args;
				} else {
					newProcess.args = sharedArgs;
				}
			}
			col.processes.push(newProcess);
		}
	}

	/**
	 * After deserializing from JSON, linked processes each have their own
	 * args copy. This function re-links them so they share the same object.
	 */
	export function relinkLinkedProcessArgs() {
		const seen = new Map();
		for (const col of core.data) {
			for (const p of col.processes) {
				if (p.linkedGroupId == null) continue;
				if (seen.has(p.linkedGroupId)) {
					p.args = seen.get(p.linkedGroupId);
				} else {
					seen.set(p.linkedGroupId, p.args);
				}
			}
		}
	}

	export function getColumnById(id) {
		const theColumn = core.data.find((column) => column.id === id);
		return theColumn;
	}

	// --- Producer-column naming (dataflow model) -------------------------------
	// A produced column's default name describes its provenance: the input column
	// followed by the steps applied, e.g. "HR → Add" or "HR → Add → Normalize".
	// This keeps names informative and, after the uniqueness pass in the `name`
	// getter, unique. A user-set customName always wins (names stay editable).
	const _nameInFlight = new Set();

	// The label shown for a step (producing op or an owned process).
	function _stepLabel(proc) {
		return proc?.displayName || proc?.name || 'node';
	}

	// A column's base name without the uniqueness suffix. Recurses up the input
	// chain to name producer inputs; cycle-guarded so a malformed graph can't hang.
	function columnBaseName(col) {
		if (!col) return '?';
		if (col.customName != null) return col.customName;
		if (col.producerNodeId != null && col.refId == null) {
			if (_nameInFlight.has(col.id)) return 'output';
			_nameInFlight.add(col.id);
			try {
				return producerBaseName(col);
			} finally {
				_nameInFlight.delete(col.id);
			}
		}
		// Fall back to the column's own derived name for non-producer columns.
		return col.name ?? 'Unnamed';
	}

	// "<input> → <producing op> [→ <owned process>]..." for a producer column.
	// The input is this column's specific slot (producerPort), so a fan-out node's
	// outputs read "A → Add", "B → Add", … rather than all naming the first input.
	function producerBaseName(col) {
		const proc = getProducerProcess(col.producerNodeId);
		if (!proc) return 'output';
		const inId = producerInputColId(col.producerNodeId, col.producerPort);
		const inName = columnBaseName(getColumnById(inId));
		let info = `${inName} → ${_stepLabel(proc)}`;
		for (const p of col.processes ?? []) info += ` → ${_stepLabel(p)}`;
		return info;
	}

	function doRemoveColumn(columnId) {
		appState.AYStext = `Are you sure you want to delete ${getColumnById(columnId).name}?`;
		appState.AYScallback = function handleAYS(option) {
			if (option === 'Yes') {
				removeColumn(columnId);
			}
		};
		appState.showAYSModal = true;
	}
	export function removeColumn(columnId) {
		// Step 1: Find all columns that reference the column being removed
		const dependentColumns = core.data.filter((col) => col.refId === columnId);

		// Step 2: Recursively handle dependent columns
		// Set their refId to -1 to break the reference chain
		dependentColumns.forEach((col) => {
			col.refId = -1;
		});

		// Step 3: Scrub refs from every table process.
		function scrubTP(process) {
			const args = process.args;
			if (args.xIN === columnId) args.xIN = -1;
			if (args.yIN === columnId) args.yIN = -1;
			if (Array.isArray(args.xsIN)) {
				args.xsIN = args.xsIN.filter((id) => id !== columnId);
			}
			if (Array.isArray(args.yIN)) {
				args.yIN = args.yIN.filter((id) => id !== columnId);
			}
			if (args.out) {
				Object.keys(args.out).forEach((outKey) => {
					if (args.out[outKey] === columnId) args.out[outKey] = -1;
				});
			}
		}
		core.tableProcesses.forEach(scrubTP);

		// Step 3b: Drop from any group's source list
		core.groups.forEach((g) => {
			if ((g.sourceColumnIds ?? []).includes(columnId)) {
				g.sourceColumnIds = g.sourceColumnIds.filter((id) => id !== columnId);
				if (Array.isArray(g.allColumnIds)) {
					g.allColumnIds = g.allColumnIds.filter((id) => id !== columnId);
				}
			}
		});

		// Step 4: Remove from all plots/tables
		core.plots.forEach((plot) => {
			// Table plots: drop the column id from the ref list.
			if (plot.plot?.columnRefs) {
				plot.plot.columnRefs = plot.plot.columnRefs.filter((colId) => colId !== columnId);
			}

			// x/y plots: scrub the removed column from each data point so it can't
			// linger as an orphan series. Clearing a field to -1 (in place, to keep
			// the Column instance) leaves a data point's shared x as a re-usable
			// seed; drop points that end up with neither a valid x nor y.
			if (Array.isArray(plot.plot?.data)) {
				for (const dp of plot.plot.data) {
					if (dp?.x?.refId === columnId) dp.x.refId = -1;
					if (dp?.y?.refId === columnId) dp.y.refId = -1;
				}
				plot.plot.data = plot.plot.data.filter(
					(dp) => (dp?.x?.refId ?? -1) >= 0 || (dp?.y?.refId ?? -1) >= 0
				);
			}
		});

		// Step 5: Remove the column itself from core.data
		core.rawData.delete(columnId);
		core.data = core.data.filter((col) => col.id !== columnId);

		return {
			success: true,
			removedColumnId: columnId,
			dependentColumnsAffected: dependentColumns.length,
			message: `Column ${columnId} safely removed. ${dependentColumns.length} dependent column(s) had their references cleared.`
		};
	}

	let _columnIdCounter = 0;

	export class Column {
		id; //Unique Id for the column
		refId = $state(null); //if it is a column that is based on another
		// Tap point: when set, getData() pulls refColumn's chain truncated AFTER
		// this process id (inclusive), exposing the intermediate state of refColumn
		// at that step. -1 marks a broken tap (the referenced process was deleted).
		// null means "no tap" (normal full-chain ref behaviour).
		refUpToProcessId = $state(null);
		// Synthetic tap marker: set true for columns created internally to scope
		// a single-edge process-splice. The canvas adapter hides these columns
		// (no data_X node) and routes their chain wire from the original
		// source. Distinguishes a user-created ref column from one we made.
		isTap = $state(false);
		refColumn = $derived(getColumnById(this.refId)); // Direct reference to the referenced column
		tableProcessGUId = $state('');
		producerNodeId = $state(null);
		producerPort = $state(null);
		producerArtifactKind = $state(null);
		data = null; //if it has raw data, store the id here
		compression = $state(null); //if any compression is used, store the info here
		binWidth = $derived.by(() => {
			if (this.isReferencial()) return this.refColumn?.binWidth;
		});
		originTime_ms = $derived.by(() => {
			if (this.isReferencial()) return this.refColumn?.originTime_ms;
		});
		//Where the data are from (references all the way to the primary source [importd (file) or simulated (params)])
		provenance = $derived.by(() => {
			if (this.isReferencial()) {
				return `refers to ${this.refColumn?.name} which is ${this.refColumn?.provenance}`;
			}
			return ''; // Define default provenance for non-referential columns
		});
		//Name for the column - make it the referenced one if it is referencial
		name = $derived.by(() => {
			if (this.customName !== null) return this.customName;
			if (this.isReferencial()) {
				// Pure derived: do NOT cache into customName here. Mutating state inside
				// a $derived is forbidden in Svelte 5 (state_unsafe_mutation) and throws
				// when the first read happens inside another derived (e.g. the graph
				// signature serialising a fresh column). Returning the computed name also
				// keeps it tracking the referenced column if that gets renamed.
				return (this.refColumn?.name ?? '') + '*';
			}
			// Producer-sourced columns: descriptive name that shows the steps taken,
			// disambiguated with a "(n)" suffix when an earlier column has the same
			// base. Editable — setting customName overrides this entirely.
			if (this.producerNodeId != null && this.refId == null) {
				const base = columnBaseName(this);
				let n = 0;
				for (const c of core.data) {
					if (c === this) break;
					if (
						c.producerNodeId != null &&
						c.refId == null &&
						c.customName == null &&
						columnBaseName(c) === base
					)
						n++;
				}
				return n === 0 ? base : `${base} (${n + 1})`;
			}
			return this.customName || 'Unnamed';
		});
		customName = $state(null);
		//Type of data - if it is referencial, then get the type from the reference
		type = $derived.by(() => {
			if (this.isReferencial()) return this.refColumn?.type;
		});
		//time format for converting time data
		timeFormat = $state([]);

		//The associated processes that are applied to the data
		processes = $state([]);

		// Bump this to bust the getData() cache when rawData is mutated directly (e.g. time cell edits)
		rawDataVersion = $state(0);

		hoursSinceStart = $derived.by(() => {
			// Only delegate to the ref column when this column has no processes
			// of its own; otherwise getData() differs from the ref's data and
			// we'd return offsets that don't match our own (filtered) values.
			if (this.isReferencial() && this.processes.length === 0) {
				return this.refColumn?.hoursSinceStart;
			}

			if (!this.isReferencial() && this.compression === 'awd' && this.processes.length === 0) {
				const raw = core.rawData.get(this.data);
				// A missing rawData entry (id diverged after a legacy-session migration,
				// or the stored array was never written) must degrade to an empty series
				// rather than throw — a throw here aborts importJson mid-load and blanks
				// the Data Sources panel.
				if (raw == null) return [];
				const length = raw.length;
				const step = raw.step;
				const out = new Array(length);

				if (this.type === 'number') {
					for (let i = 0; i < length; i++) {
						out[i] = i * step;
					}
					return out;
				}
				if (this.type === 'bin') {
					for (let i = 0; i < length; i++) {
						out[i] = i * step;
					}
					return out;
				}
				if (this.type === 'time') {
					for (let i = 0; i < length; i++) {
						out[i] = (i * step) / 3600000;
					}
					return out;
				}
			}
			//Other cases
			const thedata = this.getData();
			// Use the minimum valid value as the baseline; thedata[0] may be null
			// after a filter process, which would coerce to 0 and yield huge offsets.
			const baseline = min(thedata);
			if (baseline == null) return [];
			// Preserve null/NaN so downstream null-checks still catch filtered rows;
			// without this, (null - baseline) coerces to -baseline and leaks through.
			const isInvalid = (v) => v == null || isNaN(v);
			if (this.type == 'number') {
				let out = Array(thedata.length);
				for (let i = 0; i < thedata.length; i++) {
					out[i] = isInvalid(thedata[i]) ? null : thedata[i] - baseline;
				}
				return out;
			}
			if (this.type == 'bin') {
				let out = Array(thedata.length);
				for (let i = 0; i < thedata.length; i++) {
					out[i] = isInvalid(thedata[i]) ? null : thedata[i] - baseline;
				}
				return out;
			}
			if (this.type == 'time') {
				let out = Array(thedata.length);
				for (let i = 0; i < thedata.length; i++) {
					out[i] = isInvalid(thedata[i]) ? null : (thedata[i] - baseline) / 3600000;
				}
				return out;
			}
		});

		constructor(columnData = null, id = null) {
			if (id === null) {
				this.id = _columnIdCounter;
				_columnIdCounter++;
			} else {
				this.id = id;
				_columnIdCounter = Math.max(id + 1, _columnIdCounter + 1);
			}

			//Assign the other data
			if (columnData) {
				Object.assign(this, columnData);
			}

			// Object.assign(this, JSON.parse(JSON.stringify(columnData)));
		}

		//To add and remove processes
		addProcess(processName) {
			const newProcess = new Process({ name: processName }, this);
			this.processes.push(newProcess);
			return newProcess.id;
		}

		removeProcess(id) {
			// Break any tap columns that reference this specific process step.
			// Mirrors the broken-ref convention from removeColumn: set the marker
			// to -1 so getData() returns [] and the user can clean up the tap.
			for (const col of core.data) {
				if (col.refId === this.id && col.refUpToProcessId === id) {
					col.refUpToProcessId = -1;
				}
			}
			this.processes = this.processes.filter((p) => p.id !== id);
		}

		//Helper function to see if the column is referencial
		isReferencial() {
			return this.refId != null;
		}

		//For caching of the data - important for efficiency
		#cachedData = null;
		#lastDataHash = null;

		// getDataHash is a monotonic integer that changes iff any reactive source
		// below changes. Svelte's $derived memoises, so repeated reads inside one
		// tick return the same value; only a dependency change re-runs the body
		// and bumps the counter. Avoids JSON.stringify-per-read of process args.
		getDataHash = $derived.by(() => {
			this.refId;
			this.refUpToProcessId;
			this.compression;
			this.type;
			this.timeFormat;
			this.binWidth;
			this.tableProcessGUId;
			this.rawDataVersion;
			this.producerNodeId;
			this.producerPort;

			for (const p of this.processes) {
				p.id;
				p.name;
				_touchTree(p.args);
			}

			if (this.isReferencial()) this.refColumn?.getDataHash;

			// Producer-sourced columns (dataflow model): depend on the producing
			// node and its input so the cache busts when either changes.
			if (this.producerNodeId != null && this.refId == null) {
				touchProducerDeps(this.producerNodeId, this.producerPort);
			}

			return ++_hashCounter;
		});

		//--- FUNCTION TO GET THE DATA
		getData() {
			const dataHash = this.getDataHash;
			if (this.#lastDataHash === dataHash && this.#cachedData) {
				return this.#cachedData;
			}
			const out = this.#computePipeline(null);
			this.#cachedData = out;
			this.#lastDataHash = dataHash;
			return out;
		}

		// Tap accessor: run the pipeline but stop AFTER the named process (inclusive).
		// Used by tap columns (refUpToProcessId set) so consumers see the intermediate
		// state. Not cached here — callers that wrap this in getData() get the cache.
		getDataUpToProcess(stopAfterProcessId) {
			if (stopAfterProcessId == null) return this.getData();
			return this.#computePipeline(stopAfterProcessId);
		}

		#computePipeline(stopAfterProcessId) {
			if (this.refId === -1) {
				console.warn('Column ', this.id, this.name, ' has a broken reference.');
				return [];
			}
			// Broken tap (the referenced process was deleted). Match the broken-ref
			// convention: warn + return empty so downstream consumers degrade safely.
			if (this.refUpToProcessId === -1) {
				console.warn('Column ', this.id, this.name, ' has a broken tap reference.');
				return [];
			}

			// Dataflow model: this column is a handle onto a node's output rather
			// than an owner of raw data. Source its value from the producing node,
			// then still run any processes the column carries of its own (normally
			// none). Legacy ref/rawData columns fall through to the branches below.
			if (this.producerNodeId != null && this.refId == null && this.data == null) {
				let out = resolveProducer(this.producerNodeId, this.producerPort) ?? [];
				for (const p of this.processes) {
					out = p.doProcess(out);
					if (p.id === stopAfterProcessId) return out;
				}
				return out;
			}

			let out = [];
			if (this.refId != null) {
				const ref = getColumnById(this.refId);
				out =
					this.refUpToProcessId != null
						? (ref?.getDataUpToProcess(this.refUpToProcessId) ?? [])
						: (ref?.getData() ?? []);
			} else {
				if (this.compression === 'awd') {
					const raw = core.rawData.get(this.data);
					// Missing rawData entry: degrade to empty rather than throw on
					// raw.length (see hoursSinceStart for the same guard and rationale).
					if (raw == null) {
						out = [];
					} else {
						out = new Array(raw.length);
						for (let i = 0; i < raw.length; i++) {
							out[i] = raw.start + i * raw.step;
						}
					}
				} else {
					out = core.rawData.get(this.data) ?? [];
				}
			}

			if (this.type === 'time' && !this.isReferencial() && this.compression !== 'awd') {
				try {
					out = out.map((x) => Number(getUNIXDate(x, this.timeFormat)));
				} catch {
					console.warn('Error parsing time data for column ', this.id, this.name);
				}
			}

			if (this.type === 'bin') {
				out = out.map((x) => (x != null && Number.isFinite(x) ? x + this.binWidth / 2 : x));
			}

			if (out == []) return [];

			for (const p of this.processes) {
				out = p.doProcess(out);
				if (p.id === stopAfterProcessId) return out;
			}
			return out;
		}

		//Save and load the column to and from JSON
		toJSON() {
			let jsonOut = { id: this.id, name: this.name };
			if (this.refId != null) {
				jsonOut.refId = this.refId;
				if (this.refUpToProcessId != null) {
					jsonOut.refUpToProcessId = this.refUpToProcessId;
				}
				if (this.isTap) jsonOut.isTap = true;
			} else {
				jsonOut.data = this.data;
			}
			jsonOut.type = this.type;
			if (this.type == 'time') {
				jsonOut.timeFormat = this.timeFormat;
			}
			if (this.type == 'bin') {
				jsonOut.binWidth = this.binWidth;
			}
			if (this.originTime_ms != null) {
				jsonOut.originTime_ms = this.originTime_ms;
			}
			if (this.compression != null) {
				jsonOut.compression = this.compression;
			}
			jsonOut.tableProcessGUId = this.tableProcessGUId;
			jsonOut.producerNodeId = this.producerNodeId;
			jsonOut.producerPort = this.producerPort;
			jsonOut.producerArtifactKind = this.producerArtifactKind;
			jsonOut.provenance = this.provenance;
			jsonOut.processes = this.processes;

			return jsonOut;
		}

		static fromJSON(json) {
			const {
				id,
				name,
				type,
				refId,
				refUpToProcessId,
				isTap,
				data,
				timeFormat,
				binWidth,
				originTime_ms,
				tableProcessGUId,
				producerNodeId,
				producerPort,
				producerArtifactKind,
				processes,
				compression,
				provenance
			} = json;
			// `binWidth`, `originTime_ms`, `provenance`, `name`, `type` are $derived
			// getters that delegate to refColumn for referencial columns. Object.assign
			// silently overrides a derived only when the value is non-undefined, so
			// passing `null` for a missing field destroys the delegation. Build the
			// columnData object so missing values stay undefined (no-op) while real
			// values continue to override (which is how non-ref columns store them).
			const columnData = {
				refId: refId ?? null,
				refUpToProcessId: refUpToProcessId ?? null,
				data: data ?? null,
				timeFormat: timeFormat ?? '',
				tableProcessGUId: tableProcessGUId ?? '',
				producerNodeId: producerNodeId ?? null,
				producerPort: producerPort ?? null,
				producerArtifactKind: producerArtifactKind ?? null,
				compression: compression ?? null
			};
			if (name !== undefined) columnData.name = name;
			if (type !== undefined) columnData.type = type;
			if (binWidth != null) columnData.binWidth = binWidth;
			if (originTime_ms != null) columnData.originTime_ms = originTime_ms;
			if (provenance != null) columnData.provenance = provenance;
			let column = new Column(columnData, id);
			if (isTap === true) column.isTap = true;

			column.processes = [];
			if (Array.isArray(processes)) {
				for (const p of processes) {
					column.processes.push(Process.fromJSON(p, column));
				}
			}

			return column;
		}
	}
</script>

<script>
	// @ts-nocheck
	import Icon from '$lib/icons/Icon.svelte';
	import ColumnSelector from '$lib/components/inputs/ColumnSelector.svelte';
	import TypeSelector from '$lib/components/reusables/TypeSelector.svelte';
	import MiniDataTable from '$lib/components/workflow/MiniDataTable.svelte';

	import Editable from '$lib/components/inputs/Editable.svelte';
	import { guessDateofArray } from '$lib/utils/time/TimeUtils.js';

	let {
		col = $bindable(),
		canChange = false,
		onChange = () => {},
		canvasSelectedProcessId = null
	} = $props();

	// Mini data-table preview, expanded per-row (panel display mode only). Matches
	// the node output rows on the canvas.
	let previewOpen = $state(false);

	// Live rename: write to customName so the name survives node-label changes
	// (an empty value falls back to the auto-derived name).
	function renameThis(v) {
		col.customName = v === '' ? null : v;
	}

	// The canvas node that represents this column: its producing node (derived),
	// the table-process that outputs it, the group that absorbs it, or its own
	// data node (plain source).
	function columnCanvasNodeId(c) {
		if (c.producerNodeId) return c.producerNodeId;
		for (const tp of core.tableProcesses ?? []) {
			if (Object.values(tp.args?.out ?? {}).includes(c.id)) return `tableprocess_${tp.id}`;
		}
		for (const g of core.groups ?? []) {
			if ((g.sourceColumnIds ?? []).includes(c.id)) return g.id;
		}
		return `data_${c.id}`;
	}

	// Find/select: jump to this column's node on the workflow canvas (select + pan)
	// and open its editor in the Control Panel.
	function findSelect() {
		const id = columnCanvasNodeId(col);
		appState.canvasSelectedNodeId = id;
		appState.focusNodeRequest = { id, n: (appState.focusNodeRequest?.n ?? 0) + 1 };
		appState.view = 'canvas';
		appState.showControlPanel = true;
	}

	function onTypeChange(newType) {
		if (newType !== 'time') return;
		const fmt = col.timeFormat;
		const isEmpty = !fmt || (Array.isArray(fmt) ? fmt.length === 0 : fmt === '');
		if (!isEmpty) return;
		const rawData = core.rawData.get(col.data);
		if (!Array.isArray(rawData) || rawData.length === 0) return;
		const sample = rawData.slice(0, 10);
		const guessed = guessDateofArray(sample);
		if (guessed !== -1 && guessed.length > 0) {
			col.timeFormat = guessed;
		}
	}
</script>

{#if col == undefined}
	<p>Column is undefined</p>
{:else}
	<div class="clps-container">
		<!-- Compact column row matching the canvas node output rows: a chevron to
		     drop down a mini data-table preview, the type + name, then right-aligned
		     find / delete buttons (revealed on hover). -->
		<div class="clps-item">
			<div class="clps-title-container">
				{#if !canChange}
					<button
						type="button"
						class="col-chev"
						aria-expanded={previewOpen}
						title={previewOpen ? 'Hide preview' : 'Show preview'}
						onclick={(e) => {
							e.stopPropagation();
							previewOpen = !previewOpen;
						}}
					>
						<span class="chev" aria-hidden="true">{previewOpen ? '▾' : '▸'}</span>
					</button>
				{/if}

				<div class="clps-title">
					<TypeSelector bind:value={col.type} onChange={onTypeChange} />

					{#if canChange}
						<div>
							<ColumnSelector bind:value={col.refId} bind:onChange />
						</div>
					{:else}
						<p class="col-name"><Editable value={col.name} onInput={renameThis} /></p>
					{/if}
				</div>

				<div class="clps-title-button">
					<button
						class="icon find-select-btn"
						title="Find on canvas / edit in panel"
						onclick={(e) => {
							e.stopPropagation();
							findSelect();
						}}
					>
						<Icon name="process" width={15} height={15} className="menu-icon" />
					</button>

					{#if col.tableProcessGUId == '' && col.refId == null}
						<button class="icon" title="Delete" onclick={(e) => doRemoveColumn(col.id)}>
							<Icon name="trash" width={15} height={15} className="menu-icon" />
						</button>
					{/if}
				</div>
			</div>

			{#if col.type == 'time'}
				<div class="control-input display time-format-row">
					<p>Time Format</p>
					{#if !canChange}
						<input bind:value={col.timeFormat} />
					{:else}
						<span>{getColumnById(col.refId)?.timeFormat}</span>
					{/if}
				</div>
			{/if}

			{#if previewOpen && !canChange}
				<div class="col-preview"><MiniDataTable column={col} maxRows={5} /></div>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Chevron + type/name on the left, action buttons inline on the right. */
	.clps-title-container {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		min-width: 0;
		gap: var(--space-2);
	}
	.clps-title-button {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		flex-shrink: 0;
	}

	/* Chevron to expand a mini data-table preview (matches canvas node outputs). */
	.col-chev {
		background: none;
		border: none;
		padding: 0 1px;
		margin: 0;
		cursor: pointer;
		color: var(--color-text-muted, #666);
		font-size: 10px;
		line-height: 1;
		flex-shrink: 0;
	}
	.col-chev:hover {
		color: var(--color-lightness-25, #444);
	}
	.col-name {
		margin: 0;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.col-preview {
		padding: 2px 4px 4px 18px;
	}

	/* Both action buttons (find-on-canvas + bin) reveal on row hover; keeps the row
	   uncluttered at rest. */
	.clps-title-button button {
		opacity: 0;
		transition: opacity 0.12s ease;
	}
	.clps-container:hover .clps-title-button button,
	.clps-title-button button:focus-visible {
		opacity: 1;
	}
	.time-format-row {
		display: flex;
		/* The parent .control-input makes this a column, so flex-start left-aligns
		   the "Time Format" label (centre would centre the shrink-to-fit label). */
		align-items: flex-start;
		gap: var(--space-1);
		font-size: var(--font-sm);
		padding: 2px 4px 4px;
	}
	.time-format-row p {
		margin: 0;
		color: var(--color-text-muted, #666);
	}
	.time-format-row input {
		flex: 1 1 auto;
		min-width: 0;
	}

	/* .data-collapsible-title-container {
		width: 100%;
		min-width: 0;

		display: flex;
		flex: 1 1 0;
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;

		margin: 0;
		padding: 0;
	} */

	.data-component-info {
		display: flex;
		flex-direction: column;
		width: 100%;

		font-size: var(--font-sm);
		text-align: left;
		color: var(--color-lightness-35);

		margin: 0;
		padding: 0;

		gap: var(--space-2);
	}

	.data-component-info p {
		margin: 0;
		padding: 0;
	}

	.line {
		width: 100%;
		height: 1px;

		background-color: var(--color-lightness-85);

		margin: var(--space-2) 0 var(--space-4) 0;
	}

	.block {
		width: 100%;
		height: 0.75rem;

		background-color: transparent;
	}

	/* General container */

	.clps-container {
		display: flex;
		flex: 1 1 0;
		flex-direction: column;
		position: relative;

		width: 100%;
		min-width: 0;

		border-radius: var(--radius-sm);

		margin: 1px 0;
	}

	.clps-container:hover {
		background-color: var(--color-lightness-97);
	}

	.clps-content-container {
		width: calc(100% - (0.5rem + 0.5rem) + 6px);
		/* note: width: calc(100% - (0.5rem + margin-left) + 6px)*/
		min-width: 0;

		display: flex;
		flex-direction: column;
		flex: 1 1 0;

		margin: 0 0 0 var(--space-4);
		padding: 0;
	}

	.clps-title {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;

		flex: 1 1 auto;
		min-width: 0;

		margin: 0;
		padding: 0;

		gap: var(--space-4);
	}

	details {
		width: 100%;
		min-width: 0;

		margin: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
		padding: 0;
	}

	summary {
		width: 100%;
		min-width: 0;

		list-style: none;

		display: flex;
		flex: 1 1 0;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;

		margin: 0;
		padding: 0;
	}

	summary p {
		margin: 0;
		padding: 0;
	}

	summary button {
		margin: 0;
		padding: 0;
	}

	summary .icon {
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s ease;
	}

	details:hover summary .icon {
		opacity: 1;
		pointer-events: auto;
	}

	/* Provenance italic style */
	italic {
		font-style: italic;
		font-size: var(--font-sm);
		color: var(--color-lightness-35);
	}

	/* Select and input controls — compact so panel rows match the node output
	   rows' density. */
	select,
	input {
		height: 1.55rem;
		width: auto;
		min-width: 0;
		box-sizing: border-box;

		padding: var(--space-1) var(--space-3);
		background-color: transparent;

		font-size: var(--font-md);
		font-weight: lighter;

		border: solid 1px transparent;
		border-radius: 2px;

		transition: border-color 0.2s;
	}

	input[readonly]:focus {
		border: 1px solid transparent;
		outline: none;
	}

	.display {
		margin: 0;
		margin-bottom: var(--space-4);
	}

	.process-container {
		display: flex;
		flex-direction: column;
		margin: 0;
		gap: var(--space-4);
	}

	.linked-process {
		border-left: 2px solid var(--color-lightness-35, #555);
		padding-left: var(--space-3);
	}

	.linked-badge {
		font-size: 10px;
		color: var(--color-lightness-35, #555);
		line-height: 1;
		margin-bottom: var(--space-1);
	}

	.drag-handle {
		cursor: grab;
		user-select: none;
		font-size: var(--font-sm);
		line-height: 1;
		color: var(--color-lightness-65, #aaa);
		padding: 0 var(--space-1);
		opacity: 0;
		transition: opacity 0.15s ease;
	}

	.drag-handle:active {
		cursor: grabbing;
	}

	.single-process-container:hover .drag-handle {
		opacity: 1;
	}

	.drag-over {
		border-top: 2px solid var(--color-lightness-35, #555);
	}

	/* Mirrors the canvas selection — applied when this process is the focused
	   node in WorkflowEditor (via appState.canvasSelectedNodeId). */
	.single-process-container.canvas-selected {
		border-radius: var(--radius-sm);
		box-shadow: inset 2px 0 0 var(--color-accent);
		background-color: color-mix(in srgb, var(--color-accent) 8%, transparent);
	}
</style>
