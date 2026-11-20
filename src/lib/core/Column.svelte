<script module>
	// @ts-nocheck

	import { Process, nextLinkedGroupId } from '$lib/core/Process.svelte';
	import { core, appState, appConsts } from '$lib/core/core.svelte.js';
	import { reconcileAllOutputs } from '$lib/core/reconcileOutputs.js';
	import { recordGraphMutation } from '$lib/core/operations.js';
	import { loadKeepingUnknown } from '$lib/core/unknownFields.js';
	import {
		resolveProducer,
		touchProducerDeps,
		getProducerProcess,
		producerInputColId
	} from '$lib/core/producerRuntime.js';
	import { getUNIXDate } from '$lib/utils/time/TimeUtils.js';
	import { auditTimeColumnParse } from '$lib/utils/time/timeParseAudit.js';
	import { min } from '$lib/components/plotbits/helpers/wrangleData';
	import { isInvalidValue } from '$lib/utils/stats.js';
	import { displayNameOf } from '$lib/core/columnLabels.js';
	import { remapSeriesRefs, seriesHasData } from '$lib/core/seriesChannelRefs.js';
	import { resolveTimeFrame, parseZoneOf, noteWallClockCounts } from '$lib/core/columnTimeZone.js';
	import { resolveWallClocks, wallClockToInstant } from '$lib/utils/time/zones.js';

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
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local linkedGroupId lookup built and consumed inside this function; never read reactively
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

	// id → index into core.data, for getColumnById. A hint, never trusted: every hit is checked
	// against core.data itself, and a miss or a stale hint rescans the array and rebuilds it.
	let _columnIndexById = new Map();

	/**
	 * The column with this id, or undefined. Was core.data.find(...) on every call: O(n) per
	 * lookup, so a node with n y columns that looks up each of its inputs and outputs cost
	 * O(n^2) (a Cosinor over 9471 columns took ~17 min). A hit in the id index is O(1); it reads
	 * core.data[i] and checks the id, so a removed or moved column falls through to the full
	 * scan, which (like find) reads the whole array and so keeps the same reactive dependencies
	 * when the id is not there.
	 */
	export function getColumnById(id) {
		// Column ids are non-negative numbers; -1 / null / undefined mean "not wired" and no
		// column (find compared with ===, so a string never matched either).
		if (typeof id !== 'number' || !(id >= 0)) return undefined;
		const data = core.data;
		const hint = _columnIndexById.get(id);
		if (hint !== undefined) {
			const c = data[hint];
			if (c != null && c.id === id) return c;
		}
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- see _columnIndexById
		const index = new Map();
		let found;
		for (let i = 0; i < data.length; i++) {
			const c = data[i];
			if (c == null) continue;
			if (!index.has(c.id)) index.set(c.id, i);
			if (found === undefined && c.id === id) found = c;
		}
		_columnIndexById = index;
		return found;
	}

	// --- Producer-column naming (dataflow model) -------------------------------
	// A produced column's default name describes its provenance: the input column
	// followed by the steps applied, e.g. "HR → Add" or "HR → Add → Normalize".
	// This keeps names informative and, after the uniqueness pass in the `name`
	// getter, unique. A user-set customName always wins (names stay editable).
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- module-level recursion guard for the name getter; identity bookkeeping only, never read reactively
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
		appState.AYStext = `Are you sure you want to delete ${displayNameOf(getColumnById(columnId))}?`;
		appState.AYScallback = function handleAYS(option) {
			if (option === 'Yes') {
				// One undoable step: undo restores the column, its data and its references.
				recordGraphMutation(() => removeColumn(columnId));
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

		// Step 3: Scrub refs from every table process, and drop the per-Y outputs whose
		// Y input has just gone.
		//
		// The orphaned outputs used to be left to each node's own syncYColumns(), which
		// runs from an $effect on args.yIN — so it only fired if that node's component
		// happened to be MOUNTED. A collapsed node renders through CompactNode and does
		// not mount its editor, so deleting a dataset left its outputs behind, still
		// holding data and still drawn by any plot reading them.
		//
		// Re-expanding did not heal it either: useMultiYTP seeds prevYIds from the
		// CURRENT args.yIN, so a fresh instance mounted after the scrub sees no
		// transition, concludes nothing changed, and never cleans up. The staleness was
		// therefore permanent, which is what made it look like the outputs "don't
		// disappear".
		//
		// Ownership belongs here, with the deletion, not with whichever component is
		// alive to notice — the same model deleteTableProcess already uses for its own
		// outputs. Collected first and removed after the sweep, because removing a
		// column re-enters this function.
		//
		// Every input the node DECLARES as a column id is scrubbed (its definition's
		// columnIdFields), not only xIN / yIN / xsIN: a Crossing's thresholdIN or a Rayleigh's
		// timeIN kept the dead id, and after a reload the column counter restarts at max+1, so
		// a new column could take that id and be wired in unasked (review ROB-15).
		function scrubTP(process) {
			const args = process.args;
			if (!args) return;
			const fields = appConsts.tableProcessMap?.get?.(process.name)?.columnIdFields ?? {};
			const scalar = new Set(['xIN', ...(fields.scalar ?? [])]);
			const array = new Set(['xsIN', ...(fields.array ?? [])]);
			for (const key of scalar) if (args[key] === columnId) args[key] = -1;
			for (const key of array) {
				if (Array.isArray(args[key]) && args[key].includes(columnId))
					args[key] = args[key].filter((id) => id !== columnId);
			}
			// yIN is scalar on some nodes and an array on others.
			if (args.yIN === columnId) args.yIN = -1;
			if (Array.isArray(args.yIN) && args.yIN.includes(columnId)) {
				args.yIN = args.yIN.filter((id) => id !== columnId);
			}
			if (args.out) {
				Object.keys(args.out).forEach((outKey) => {
					if (args.out[outKey] === columnId) args.out[outKey] = -1;
				});
			}
		}
		core.tableProcesses.forEach(scrubTP);
		// Now that the inputs are scrubbed, drop the per-input outputs that describe a
		// column this node no longer takes. Shared with the wire-deletion and load paths
		// (core/reconcileOutputs.js) so the invariant holds however the input went away —
		// it used to depend on the owning node's component being mounted, which a
		// collapsed node never is.
		reconcileAllOutputs(core.tableProcesses, (id) => {
			if (getColumnById(id)) removeColumn(id);
		});

		// Step 3a: Free (orphan) process nodes reading this column lose the input, and the
		// output column they produced FROM it (producerPort `out_<id>`) goes with it, exactly
		// as deleting that one wire does.
		const strandedOutputs = [];
		for (const proc of core.orphanProcesses ?? []) {
			const raw = proc?.args?.inIN;
			const ins = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
			if (!ins.includes(columnId)) continue;
			proc.args.inIN = Array.isArray(raw) ? raw.filter((id) => id !== columnId) : -1;
			for (const c of core.data) {
				if (c.producerNodeId === `process_${proc.id}` && c.producerPort === `out_${columnId}`)
					strandedOutputs.push(c.id);
			}
		}
		for (const id of strandedOutputs) if (getColumnById(id)) removeColumn(id);

		// A chained input (consumer fed through a plot's passthrough port) carrying this
		// column is dead too.
		if ((core.chainRefs ?? []).some((r) => r?.colId === columnId)) {
			core.chainRefs = core.chainRefs.filter((r) => r?.colId !== columnId);
		}

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

			// Series plots: scrub the removed column from every channel of each data point
			// (seriesChannelRefs, the one list) so it can't linger as an orphan series.
			// Clearing a channel to -1 (in place, to keep the Column instance) leaves a data
			// point's shared x as a re-usable seed; drop points left with no wired data
			// channel. (The scrub once knew x/y/z only, so a Histogram's `column` was never
			// cleared and every column-based series was dropped on ANY delete.)
			if (Array.isArray(plot.plot?.data)) {
				for (const dp of plot.plot.data) {
					remapSeriesRefs(dp, (id) => (id === columnId ? -1 : id));
				}
				plot.plot.data = plot.plot.data.filter(seriesHasData);
			}
		});

		// Step 5: Remove the column itself from core.data, and free its stored series. The
		// series is keyed by the column's `data` key, which is normally its id; a column
		// pasted by older versions shared the ORIGINAL's key, so deleting the original used to wipe
		// the copy (review ROB-16). A key another column still reads is left alone.
		const removed = getColumnById(columnId);
		core.data = core.data.filter((col) => col.id !== columnId);
		const stillRead = (key) => core.data.some((c) => c.data === key);
		for (const key of new Set([columnId, removed?.data])) {
			if (key == null || stillRead(key)) continue;
			core.rawData.delete(key);
		}

		return {
			success: true,
			removedColumnId: columnId,
			dependentColumnsAffected: dependentColumns.length,
			message: `Column ${columnId} safely removed. ${dependentColumns.length} dependent column(s) had their references cleared.`
		};
	}

	let _columnIdCounter = 0;

	// Only for a store that has just been emptied (the headless engine's fresh session,
	// mcp/src/engine/session.js): ids then restart at 0 so the same build gives the same ids.
	// Never call it while any column is still live: it would hand out a held id again.
	export function resetColumnIdCounter() {
		_columnIdCounter = 0;
	}

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
			// Describe one hop only. It intentionally does NOT read refColumn.provenance:
			// that recursion made `provenance` reference itself through a cyclic ref chain
			// (A→B→A), which Svelte rejects (derived_references_self in dev; an
			// UNINITIALIZED symbol in prod that then throws "Cannot convert a Symbol to a
			// string"). A single-level description is enough for this display-only field.
			if (this.isReferencial()) {
				return `refers to ${displayNameOf(this.refColumn) || '?'}`;
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
		// The name a person READS (legends, axis and series labels, node rows, result tables):
		// a node output's label rather than its internal `name` (`joined_483_38` reads
		// "amplitude"), a reference's target without the `*`. `name` stays the stored identity.
		// See core/columnLabels.js displayNameOf.
		get displayName() {
			return displayNameOf(this);
		}
		// Per-column group / replicate label (BioDare2 trace label). Tags the
		// biological group a data column belongs to so replicates sharing a label
		// can be aggregated for grouped analysis. Orthogonal to which Group/table
		// the column sits in. null / '' means unlabelled.
		groupLabel = $state(null);
		//Type of data - if it is referencial, then get the type from the reference
		type = $derived.by(() => {
			if (this.isReferencial()) return this.refColumn?.type;
		});
		//time format for converting time data
		timeFormat = $state([]);
		// The zone this column's wall clock belongs to: 'utc' ("As written" for text with no
		// offset), a fixed offset '+13:00', or an IANA name (utils/time/zones.js). Set on a
		// SOURCE time column only; null means 'utc'. Derived columns inherit theirs through
		// `timeFrame`. For zone-less text (and AWD) a zone other than 'utc' decides the instants
		// the text names (phase 3; resolved in #computePipeline), so it is part of getDataHash.
		timeZone = $state(null);
		// { zone, wall }: the zone the column's times are in and whether the stored ms are its
		// wall clock read as UTC. Inherited through references, process and analysis outputs
		// (core/columnTimeZone.js). Display helpers read it (utils/time/displayTime.js).
		timeFrame = $derived.by(() => resolveTimeFrame(this));

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
			// The house rule, not `v == null || isNaN(v)`: isNaN('') is false, so a blank
			// cell leaked through as -baseline (min() above already skips it).
			const isInvalid = isInvalidValue;
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
			this.timeZone;
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
						// The header's start is a wall clock with no zone: with a zone it is
						// resolved there (phase 3), and the samples follow it in elapsed time.
						const zone = this.type === 'time' ? parseZoneOf(this) : null;
						const start = zone ? wallClockToInstant(raw.start, zone) : raw.start;
						out = new Array(raw.length);
						for (let i = 0; i < raw.length; i++) {
							out[i] = start + i * raw.step;
						}
					}
				} else {
					out = core.rawData.get(this.data) ?? [];
				}
			}

			if (this.type === 'time' && !this.isReferencial() && this.compression !== 'awd') {
				try {
					// Preserve gaps: a null/empty cell stays null rather than being
					// coerced to Number(getUNIXDate(null)) === 0 (the 1970 epoch), which
					// would otherwise plot spurious points where a segment has no data
					// (e.g. Split's per-segment time outputs).
					const rawTimes = out;
					out = out.map((x) =>
						x == null || x === '' ? null : Number(getUNIXDate(x, this.timeFormat))
					);
					// Warn (once, debounced) when many non-blank values did not parse.
					auditTimeColumnParse(this, rawTimes, out);
					// Zone-less text with a zone (phase 3): the parse above is the wall clock read
					// as UTC; resolve it to the instants it names in the zone, with the repeated
					// and skipped hours of a daylight-saving change (utils/time/zones.js). Only
					// text cells: an epoch-ms cell already is an instant.
					const zone = parseZoneOf(this);
					if (zone) {
						const walls = out.map((v, i) => (typeof rawTimes[i] === 'string' ? v : null));
						const r = resolveWallClocks(walls, zone);
						out = out.map((v, i) => (typeof rawTimes[i] === 'string' ? r.instants[i] : v));
						noteWallClockCounts(out, {
							zone,
							repeated: r.repeated,
							secondPass: r.secondPass,
							unordered: r.unordered,
							skipped: r.skipped
						});
					}
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
				// Only when set: a column without one reads 'utc', as every column saved before
				// per-column zones does.
				if (this.timeZone != null) jsonOut.timeZone = this.timeZone;
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
			// `provenance` is a display-only $derived (a human-readable "refers to …"
			// string) that nothing reads back on load. Serialising it walked the
			// recursive refColumn chain during JSON.stringify; on a cyclic ref chain
			// Svelte returns its UNINITIALIZED symbol for the in-flight derived, and
			// interpolating a Symbol into a string throws. It carries no state, so we
			// simply don't serialise it.
			if (this.groupLabel != null && this.groupLabel !== '') {
				jsonOut.groupLabel = this.groupLabel;
			}
			jsonOut.processes = this.processes;

			return jsonOut;
		}

		// Fields of the saved column this version does not read are kept and saved again (ROB-22).
		static fromJSON(json) {
			return loadKeepingUnknown(json, (saved) => Column.#fromSaved(saved));
		}
		static #fromSaved(json) {
			const {
				id,
				name,
				type,
				refId,
				refUpToProcessId,
				isTap,
				data,
				timeFormat,
				timeZone,
				binWidth,
				originTime_ms,
				tableProcessGUId,
				producerNodeId,
				producerPort,
				producerArtifactKind,
				processes,
				compression,
				provenance,
				groupLabel
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
			if (groupLabel != null) columnData.groupLabel = groupLabel;
			if (typeof timeZone === 'string' && timeZone !== '') columnData.timeZone = timeZone;
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
	import { describeTimeFormatProblem } from '$lib/utils/time/TimeUtils.js';
	import { sniffTimeFormatOnTypeChange } from '$lib/utils/columnType.js';
	import { columnDisplayName, commitColumnRename } from '$lib/core/columnLabels.js';
	import { columnWarnings } from '$lib/core/columnWarnings.js';
	import TimeZoneSelect from '$lib/components/inputs/TimeZoneSelect.svelte';
	import {
		ownsTimeZone,
		timeZoneSource,
		readsWallClockText,
		zoneShiftNote
	} from '$lib/core/columnTimeZone.js';
	import { applyOp } from '$lib/core/operations.js';
	import { zoneLabel } from '$lib/utils/time/zones.js';
	import {
		getLegacyZone,
		getShowTimesIn,
		COLUMN_ZONE,
		AS_WRITTEN_LABEL
	} from '$lib/utils/time/displayTime.js';

	let {
		col = $bindable(),
		canChange = false,
		onChange = () => {},
		// eslint-disable-next-line no-unused-vars -- public prop set by DataDisplay; kept so the component's API stays stable
		canvasSelectedProcessId = null,
		// What this column is as a node output (core/portDescriptions.js), shown after its name
		// in the name's hover title and so read as its accessible description. Data panel only.
		description = null,
		// The id of the visible label that names this column's picker (a plot's "Time (x)"
		// row), passed on to the ColumnSelector when the column can be changed.
		labelledby = null
	} = $props();

	// Mini data-table preview, expanded per-row (panel display mode only). Matches
	// the node output rows on the canvas.
	let previewOpen = $state(false);

	// The "Time Format" field is a PARSE format: how the app reads raw text into an
	// instant. It only applies to columns whose stored data is text (imported /
	// entered, e.g. "2026-03-10T10:13"). Computed/output time columns (Smooth Data,
	// Bin Data, Cosinor…) store numeric timestamps (ms), so there's nothing to parse
	// and the field is inert — so hide it there. (Simulate Data stores ISO strings,
	// so it correctly keeps the field.)
	let timeFormatApplies = $derived.by(() => {
		if (col.type !== 'time') return false;
		const src = col.refId != null ? getColumnById(col.refId) : col;
		const arr = src ? core.rawData.get(src.data) : null;
		return Array.isArray(arr) && arr.some((v) => v != null && typeof v === 'string');
	});

	// Why this text time column would show blanks (no format, or values the format
	// cannot read), surfaced beside the format field instead of failing silently.
	let timeFormatProblem = $derived.by(() => {
		if (!timeFormatApplies || canChange) return null;
		return describeTimeFormatProblem(core.rawData.get(col.data), col.timeFormat);
	});

	// Warnings about the column's own data (e.g. a time column whose times repeat).
	let dataWarnings = $derived(columnWarnings(col));

	// Time zone (STAT-18): editable on a source time column, shown read-only (with where it
	// comes from) on a derived one. One setColumnTimeZone op per change, so it is one undo step.
	let zoneEditable = $derived(ownsTimeZone(col));
	let zoneFrame = $derived(col?.type === 'time' ? col.timeFrame : null);
	// Zone-less text (or AWD): its zone says where the wall clock was, so a zone other than
	// 'utc' moves its instants (phase 3) and the row says by how much.
	let zoneAsWritten = $derived(zoneEditable && readsWallClockText(col));
	let zoneMoveNote = $derived(zoneAsWritten ? zoneShiftNote(col) : null);
	let zoneFrom = $derived.by(() => {
		if (!zoneFrame || zoneEditable) return null;
		const src = timeZoneSource(col);
		return src && src !== col ? columnDisplayName(src) : null;
	});
	// When a session-wide setting decides how the times are shown, say so beside the zone.
	let zoneShownNote = $derived.by(() => {
		if (!zoneFrame) return null;
		const legacy = getLegacyZone();
		if (legacy) {
			return `Shown in ${zoneLabel(legacy)}: this session uses the old time zone setting (see Settings).`;
		}
		const show = getShowTimesIn();
		if (show !== COLUMN_ZONE && show !== zoneFrame.zone) {
			return `Shown in ${zoneLabel(show)} ("Show times in", Settings).`;
		}
		return null;
	});
	function setZone(zone) {
		applyOp({ kind: 'setColumnTimeZone', id: col.id, zone });
	}

	// Rename: one renameColumn operation when the edit is committed (an undo step that counts as
	// an unsaved change). Typing a node output's label back restores its auto name, so the label
	// stays live; an empty value falls back to the auto-derived name (columnLabels.renameTarget).
	function renameThis(v) {
		commitColumnRename(col, v);
	}

	// What the row shows (UI-4): a node output's label ("R²", "Cosinor fit: A1") while the
	// column keeps its auto name, otherwise the column's own name. Display only.
	let shownName = $derived(columnDisplayName(col));

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
		sniffTimeFormatOnTypeChange(col, newType);
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
						<Icon name={previewOpen ? 'caret-down' : 'caret-right'} width={12} height={12} />
					</button>
				{/if}

				<div class="clps-title">
					<TypeSelector bind:value={col.type} onChange={onTypeChange} />

					{#if canChange}
						<div class="col-picker">
							<ColumnSelector bind:value={col.refId} bind:onChange {labelledby} />
						</div>
					{:else}
						<p class="col-name" title={description ? `${shownName}\n${description}` : shownName}>
							<Editable value={shownName} onCommit={renameThis} />
						</p>
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
						<button class="icon" title="Delete" onclick={() => doRemoveColumn(col.id)}>
							<Icon name="trash" width={15} height={15} className="menu-icon" />
						</button>
					{/if}
				</div>
			</div>

			{#if timeFormatApplies}
				<!-- A <label> around the editable field; a <div> around the read-only one. -->
				<svelte:element
					this={canChange ? 'div' : 'label'}
					class="control-input display time-format-row"
				>
					<span class="ci-label">Time format</span>
					{#if !canChange}
						<input bind:value={col.timeFormat} />
					{:else}
						<span>{getColumnById(col.refId)?.timeFormat}</span>
					{/if}
				</svelte:element>
				{#if timeFormatProblem}
					<p class="time-format-warning" role="alert">{timeFormatProblem}</p>
				{/if}
			{/if}
			{#if zoneFrame && !canChange}
				<div class="control-input display time-zone-row" data-testid="column-time-zone-row">
					<p>Time zone</p>
					{#if zoneEditable}
						<TimeZoneSelect
							value={col.timeZone ?? 'utc'}
							utcLabel={zoneAsWritten ? AS_WRITTEN_LABEL : 'UTC'}
							ariaLabel={`Time zone of ${shownName}`}
							testid="column-time-zone"
							title={zoneAsWritten
								? 'Where these times were recorded. They stay as written; the zone decides the moments they name, so elapsed time across daylight saving and lining up with other columns are right.'
								: 'The zone these times are shown in. Their offsets already fix each moment.'}
							onChange={setZone}
						/>
					{:else}
						<span class="time-zone-inherited" data-testid="column-time-zone-inherited"
							>{zoneFrame.wall && zoneFrame.zone === 'utc'
								? AS_WRITTEN_LABEL
								: zoneLabel(zoneFrame.zone)}{#if zoneFrom}<span class="time-zone-from"
									>from {zoneFrom}</span
								>{/if}</span
						>
					{/if}
				</div>
				{#if zoneMoveNote}
					<p class="time-zone-note" data-testid="column-time-zone-move">{zoneMoveNote}</p>
				{/if}
				{#if zoneShownNote}
					<p class="time-zone-note" data-testid="column-time-zone-note">{zoneShownNote}</p>
				{/if}
			{/if}
			{#each dataWarnings as w (w)}
				<p class="time-format-warning" role="status" data-testid="column-warning">{w}</p>
			{/each}

			{#if !canChange && col.type !== 'time' && col.type !== 'bin' && col.refId == null}
				<label class="control-input display group-label-row">
					<span class="ci-label">Label</span>
					<input
						placeholder="group / replicate"
						title="Group or replicate label used to aggregate this trace with others sharing the label"
						value={col.groupLabel ?? ''}
						oninput={(e) => {
							const v = e.currentTarget.value;
							col.groupLabel = v.trim() === '' ? null : v;
						}}
					/>
				</label>
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
		/* A 24px pointer box (WCAG 2.5.8) around the 12px caret: the padding that makes it is
		   given back by the negative margin, so the row does not move. It grows to the LEFT
		   (into the row's indent): the type button 4px to its right grows by 4px too, and two
		   boxes that overlap shrink each other's target. */
		padding: 6px 1px 6px 11px;
		margin: -6px 0 -6px -10px;
		cursor: pointer;
		color: var(--color-text-muted);
		font-size: var(--font-2xs);
		line-height: 1;
		flex-shrink: 0;
	}
	.col-chev:hover {
		color: var(--color-lightness-25);
	}
	.col-name {
		margin: 0;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* The name renders in Editable's inline-block span, which the paragraph's
	   own text-overflow cannot ellipsize (an inline-block is atomic), so a long
	   name was cut mid-glyph. The span ellipsizes itself; the title has it all. */
	.col-name :global(.inline-edit-span) {
		display: block;
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
	.time-format-row > .ci-label {
		margin: 0;
		color: var(--color-text-muted);
	}
	.time-format-row input {
		flex: 1 1 auto;
		min-width: 0;
	}
	/* Laid out like the Time format row above it: the label on top, the field full width. */
	.time-zone-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-1);
		font-size: var(--font-sm);
		padding: 2px 4px 4px;
	}
	.time-zone-row p {
		margin: 0;
		color: var(--color-text-muted);
	}
	.time-zone-row :global(.tz-select) {
		align-self: stretch;
		width: 100%;
		height: 1.55rem;
		--field-font-size: var(--font-md);
	}
	.time-zone-inherited {
		align-self: stretch;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--font-md);
	}
	.time-zone-from {
		margin-left: var(--space-2);
		color: var(--color-text-muted);
	}
	.time-zone-note {
		font-size: var(--font-xs);
		color: var(--color-text-muted);
		margin: 0 4px var(--space-2);
	}
	.time-format-warning {
		font-size: var(--font-xs);
		color: var(--color-warning-text);
		background: var(--color-warning-bg);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		margin: 0 0 var(--space-2);
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

	/* The picker shrinks with the panel (its label ellipsises) rather than running a long
	   column name ("Binned: relative humidity (%)") past the panel's edge. */
	.col-picker {
		flex: 1 1 auto;
		min-width: 0;
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

	/* Input controls — compact so panel rows match the node output rows'
	   density. */
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

	.display {
		margin: 0;
		margin-bottom: var(--space-4);
	}
</style>
