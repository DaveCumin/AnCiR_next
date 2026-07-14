<script module>
	// @ts-nocheck
	import { Column, getColumnById } from '$lib/core/Column.svelte';

	import { appConsts, appState, core, snapToGrid } from '$lib/core/core.svelte';
	import { selectedColumnIds, setSelection } from '$lib/tableProcesses/columnSet.js';
	import { removePlotMetricColumns } from '$lib/plots/plotMetricOutputs.svelte.js';
	let _counter = 0;
	function getNextId() {
		return _counter++;
	}

	export function getPlotById(id) {
		const thePlot = core.plots.find((plot) => plot.id === id);
		return thePlot;
	}

	// Worksheet position for a NEW plot: tile it to the right of the most recent
	// plot (a small cascade on 500px-wide plots just looks stacked), wrapping to a
	// new row when it runs past the visible worksheet width. Shared by every add
	// path (worksheet palette AND workflow palette) so plots never spawn on top of
	// each other regardless of where they were added. The workflow-canvas position
	// is separate (stablePositions), so this only affects the worksheet layout.
	export function nextPlotSpawnPosition() {
		const plots = core.plots ?? [];
		const gap = appState.gridSize; // one grid unit between plots
		const startX = 40;
		const startY = 40;
		if (plots.length === 0) return { x: snapToGrid(startX), y: snapToGrid(startY) };
		const last = plots[plots.length - 1];
		// Tile off the plot's real on-canvas footprint, not its bare canvas size.
		// Draggable.svelte renders each wrapper at snapToGrid(width + 20) ×
		// snapToGrid(height + 50) — the +20 side chrome and +50 header bar. Using
		// the bare width/height here left rows overlapping (by the ~50px header)
		// and columns nearly touching, i.e. no visible gap.
		const lw = snapToGrid((last.width ?? 500) + 20);
		const lh = snapToGrid((last.height ?? 250) + 50);
		const canvasEl = typeof document !== 'undefined' ? document.querySelector('.canvas') : null;
		const bound = (canvasEl?.clientWidth ?? 1400) / (appState.canvasScale || 1) - 40;
		let x = (last.x ?? startX) + lw + gap;
		let y = last.y ?? startY;
		if (x + lw > bound) {
			x = startX;
			y = (last.y ?? startY) + lh + gap;
		}
		return { x: snapToGrid(x), y: snapToGrid(y) };
	}

	function deletePlotIds(ids) {
		const idSet = new Set(ids);
		const isDeleted = (p) => idSet.has(p.id) || (p.facetParent != null && idSet.has(p.facetParent));
		// Metric out-columns belong to the plot — delete them with it.
		for (const p of core.plots) {
			if (isDeleted(p)) removePlotMetricColumns(p);
		}
		// Deleting a facet generator also removes its generated children.
		core.plots = core.plots.filter((p) => !isDeleted(p));
	}

	// Plot types that support faceting (small multiples). These all use an x/y
	// series model the facet engine understands. Histogram is intentionally absent:
	// its series are column-based (not x/y), so faceting it needs the engine
	// generalised — tracked as a follow-up.
	export const FACETABLE_PLOT_TYPES = new Set([
		'scatterplot',
		'boxplot',
		'actogram',
		'correlogram',
		'periodogram',
		'fft'
	]);

	// Group a plot's flat data points into series-sets by shared x (mirrors the
	// per-set (xN, ysN) ports). Each set keeps only valid ys, in wired order.
	function facetSets(data) {
		const sets = [];
		for (const dp of data ?? []) {
			const xRef = dp?.x?.refId ?? -1;
			const yRef = dp?.y?.refId ?? -1;
			let s = sets.find((ss) => ss.xRefId === xRef);
			if (!s) {
				s = { xRefId: xRef, ys: [] };
				sets.push(s);
			}
			if (yRef >= 0 && getColumnById(yRef)) s.ys.push(yRef);
		}
		return sets;
	}

	// Reconcile a facet generator's child plots. Set 1 (the first wired x-group)
	// drives the facets: one child plot per y in set 1. Any further sets (2, 3, …)
	// are paired by position — the i-th y of set 2/3 is overlaid onto child i — so
	// e.g. raw points in set 1 and their fitted curves in set 2 land on the same
	// small multiple. Children are keyed for stable reuse and arranged in a grid.
	// Idempotent: only writes core.plots / child fields when something changed.
	export function syncFacetChildren(gen) {
		if (!gen) return;
		const sets = gen.facet ? facetSets(gen.plot?.data) : [];
		const primary = sets[0] ?? { xRefId: -1, ys: [] };
		const padding = appState.gridSize ?? 15;
		const width = snapToGrid(gen.width ?? 360);
		const height = snapToGrid(gen.height ?? 220);
		const nCols = Math.max(1, Math.ceil(Math.sqrt(primary.ys.length || 1)));
		const keep = new Set();

		primary.ys.forEach((yRef, i) => {
			const key = `${gen.id}:${i}:${yRef}`;
			keep.add(key);
			const col = i % nCols;
			const row = Math.floor(i / nCols);
			// Lay children out below the generator's position.
			const x = snapToGrid((gen.x ?? 0) + col * (width + padding));
			const y = snapToGrid((gen.y ?? 0) + height + 2 * padding + row * (height + padding));
			const yName = getColumnById(yRef)?.name ?? `series ${i + 1}`;

			// Desired series for this facet: the primary y plus the i-th y of each
			// later set (paired by position).
			const desired = [{ xRef: primary.xRefId, yRef }];
			for (let k = 1; k < sets.length; k++) {
				if (i < sets[k].ys.length) desired.push({ xRef: sets[k].xRefId, yRef: sets[k].ys[i] });
			}
			const desiredSig = desired.map((d) => `${d.xRef}:${d.yRef}`).join(',');

			let child = core.plots.find((p) => p.facetParent === gen.id && p.facetKey === key);
			if (!child) {
				child = new Plot({ type: gen.type, name: yName, x, y, width, height });
				child.facetParent = gen.id;
				child.facetKey = key;
				core.plots.push(child);
			} else {
				child.x = x;
				child.y = y;
				child.width = width;
				child.height = height;
				child.name = yName;
			}

			// Sync the child's series to `desired` only when they differ (keeps the
			// reconciliation idempotent and avoids needless column churn).
			const currentSig = (child.plot?.data ?? [])
				.map((dp) => `${dp?.x?.refId ?? -1}:${dp?.y?.refId ?? -1}`)
				.join(',');
			if (currentSig !== desiredSig) {
				child.plot.data = [];
				for (const d of desired) {
					const dataIn = { y: { refId: d.yRef } };
					if (d.xRef != null && d.xRef >= 0) dataIn.x = { refId: d.xRef };
					child.plot.addData(dataIn);
				}
			}
		});

		// Drop children that no longer correspond to a facet. Only reassign when
		// something actually changed so this is idempotent (safe to call from an
		// effect without re-triggering itself).
		const stale = core.plots.filter((p) => p.facetParent === gen.id && !keep.has(p.facetKey));
		if (stale.length) {
			const staleSet = new Set(stale);
			core.plots = core.plots.filter((p) => !staleSet.has(p));
		}
	}

	// Reconcile every facet generator and prune children whose parent is no longer
	// a generator (faceting toggled off, or the generator deleted). Idempotent.
	export function reconcileAllFacets() {
		const gens = core.plots.filter((p) => p.facet);
		for (const g of gens) syncFacetChildren(g);
		const genIds = new Set(gens.map((g) => g.id));
		const orphans = core.plots.filter((p) => p.facetParent != null && !genIds.has(p.facetParent));
		if (orphans.length) {
			const orphanSet = new Set(orphans);
			core.plots = core.plots.filter((p) => !orphanSet.has(p));
		}
	}

	// --- Live Column Set → plot inputs -----------------------------------------
	// A Column Set wired to a plot's many-in port feeds its selected columns as
	// plot series. The link lives on plot.setRefs (by channel); these helpers
	// materialise it into the plot's series and keep it in sync — idempotently —
	// as the set's rule / candidate columns change. Ownership is by candidate
	// membership: a series is "set-owned" iff its column is a candidate of a wired
	// set, so we never have to tag the per-type data classes.

	/** Map a plot input port name to the setRefs channel it feeds (or null). */
	export function plotSetChannel(portName) {
		if (portName === 'series') return 'series';
		if (portName === 'data') return 'data';
		if (portName === 'ys' || portName === 'ys*' || /^ys\d+$/.test(portName ?? '')) return 'y';
		return null;
	}

	/**
	 * Ensure a plot's data holds exactly one series per `selected` column for the
	 * set-owned domain (`candidates`), preserving user series. `field` is 'y' for
	 * x/y plots (paired with `xRef`) or the single input field for single-input
	 * plots (xRef null). Idempotent — rewrites only when the set-owned set differs.
	 */
	function reconcileSeriesByColumn(plot, field, xRef, candidates, selected) {
		const data = plot.plot?.data ?? [];
		const refOf = (dp) => dp?.[field]?.refId ?? -1;
		const setOwned = (dp) => candidates.has(refOf(dp));
		const curOwned = data.filter(setOwned).map(refOf);
		const same =
			curOwned.length === selected.length && curOwned.every((id, i) => id === selected[i]);
		if (same) return;
		const userSeries = data.filter((dp) => !setOwned(dp));
		plot.plot.data = userSeries;
		for (const id of selected) {
			const dataIn = { [field]: { refId: id } };
			if (xRef != null && xRef >= 0) dataIn.x = { refId: xRef };
			if (typeof plot.plot.addData === 'function') plot.plot.addData(dataIn);
			else plot.plot.data = [...plot.plot.data, dataIn];
		}
	}

	/** Materialise every Column Set wired to a plot into its series (idempotent). */
	export function syncPlotSets(plot) {
		if (!plot || plot.facetParent != null) return;
		if (plot.type === 'tableplot') {
			const { candidates, selected } = setSelection(plot.setRefs?.series ?? []);
			const cur = plot.plot?.columnRefs ?? [];
			const next = cur.filter((id) => !candidates.has(id));
			for (const id of selected) if (!next.includes(id)) next.push(id);
			if (next.length !== cur.length || next.some((id, i) => id !== cur[i]))
				plot.plot.columnRefs = next;
			return;
		}
		const defaultInputs = appConsts?.plotMap?.get(plot.type)?.defaultInputs ?? [];
		if (defaultInputs.length === 1) {
			const { candidates, selected } = setSelection(plot.setRefs?.data ?? []);
			reconcileSeriesByColumn(plot, defaultInputs[0], null, candidates, selected);
			return;
		}
		const { candidates, selected } = setSelection(plot.setRefs?.y ?? []);
		const primaryX =
			(plot.plot?.data ?? []).map((dp) => dp?.x?.refId).find((r) => r != null && r >= 0) ?? -1;
		reconcileSeriesByColumn(plot, 'y', primaryX, candidates, selected);
	}

	/** Reconcile every plot that has a Column Set wired in. Idempotent. */
	export function reconcileAllPlotSets() {
		for (const p of core.plots ?? []) {
			if (p.facetParent != null) continue;
			if (p.setRefs && Object.values(p.setRefs).some((a) => (a ?? []).length > 0)) syncPlotSets(p);
		}
	}

	/**
	 * Detach a Column Set from a plot: strip the series it materialised (using its
	 * candidate columns as the ownership domain) and drop it from every channel.
	 * Used on wire-delete and when the Column Set node itself is deleted. `colset`
	 * may be the live node (preferred) or null when already gone — in which case a
	 * fallback candidate list can be supplied.
	 */
	export function detachColumnSetFromPlot(plot, colsetId, fallbackCandidates = []) {
		if (!plot) return;
		const set = (core.tableProcesses ?? []).find((tp) => tp.id === colsetId);
		const cands = new Set(
			(set?.args?.colsIN ?? fallbackCandidates).filter((id) => typeof id === 'number' && id >= 0)
		);
		for (const ch of Object.keys(plot.setRefs ?? {}))
			plot.setRefs[ch] = (plot.setRefs[ch] ?? []).filter((id) => id !== colsetId);
		if (plot.type === 'tableplot') {
			plot.plot.columnRefs = (plot.plot?.columnRefs ?? []).filter((id) => !cands.has(id));
		} else {
			const di = appConsts?.plotMap?.get(plot.type)?.defaultInputs ?? [];
			const field = di.length === 1 ? di[0] : 'y';
			plot.plot.data = (plot.plot?.data ?? []).filter((dp) => !cands.has(dp?.[field]?.refId ?? -1));
		}
	}

	export function removePlots(ids) {
		if (!Array.isArray(ids)) ids = [ids];

		const selectedPlots = core.plots.filter((p) => p.selected);
		const clickedIsSelected = ids.length === 1 && selectedPlots.some((p) => p.id === ids[0]);

		if (clickedIsSelected && selectedPlots.length > 1) {
			// Single click on a plot that's part of a multi-selection: offer choice.
			const clickedName = core.plots.find((p) => p.id === ids[0]).name;
			const allSelectedIds = selectedPlots.map((p) => p.id);
			const optJust = `Just "${clickedName}"`;
			const optAll = `All ${selectedPlots.length} plots`;
			appState.AYStext = `Delete just "${clickedName}" or all ${selectedPlots.length} selected plots?`;
			appState.AYSoptions = [optJust, optAll, 'Cancel'];
			appState.AYScallback = (option) => {
				if (option === optJust) deletePlotIds(ids);
				else if (option === optAll) deletePlotIds(allSelectedIds);
			};
		} else {
			// Normal flow: confirm deletion of the given set.
			appState.AYStext =
				ids.length === 1
					? `Are you sure you want to remove ${core.plots.find((p) => p.id === ids[0]).name}?`
					: `Are you sure you want to remove these ${ids.length} plots?`;
			appState.AYSoptions = ['Yes', 'No'];
			appState.AYScallback = (option) => {
				if (option === 'Yes') deletePlotIds(ids);
			};
		}
		appState.showAYSModal = true;
	}

	export function selectPlot(e, id) {
		// //look for alt held at the same time
		if (e.altKey) {
			//simply toggle selection
			core.plots.forEach((p) => {
				p.id == id ? (p.selected = !p.selected) : null;
			});
		} else {
			//de-select all others and only select this one
			core.plots.forEach((p) => {
				p.id == id ? (p.selected = true) : (p.selected = false);
			});
		}
	}
	export function selectAllPlots() {
		core.plots.forEach((p) => (p.selected = true));
	}
	export function deselectAllPlots() {
		core.plots.forEach((p) => (p.selected = false));
	}

	export function removeColumnFromPlots(c_id) {
		core.plots.forEach((p, pi) => {
			//for the table
			if (p.type == 'tableplot') {
				p.plot.columnRefs = p.plot.columnRefs.filter((cr) => cr != c_id);
			} else {
				// for each plot
				p.plot.data.forEach((d, di) => {
					// console.log('data:');
					// console.log($state.snapshot(d));
					//for each data
					Object.keys($state.snapshot(d)).forEach((k) => {
						if (d[k]?.refId == c_id) {
							//if it's a match, then remove the reference
							//console.log('removing col ', k, ' from plot ', pi, '(', p.name, '), data ', di);
							core.plots[pi].plot.data[di][k] = new Column({ refId: -1 });
						}
					});
				});
			}
		});
	}

	export class Plot {
		id;
		name = $state('plot' + this.id);
		x = $state(350);
		y = $state(150);
		width = $state(500);
		height = $state(250);
		type;
		typeDisplayName = $state('');
		selected = $state(false);
		// Reactive so wholesale reassignment (undo/redo of input wiring via the
		// setPlotInner op) re-renders the plot. In-place edits to plot.plot.data /
		// columnRefs were already reactive on their own $state; this covers the swap.
		plot = $state();
		// Faceting (small multiples): a generator plot has facet=true and produces
		// one child plot per series. Children carry facetParent (the generator id)
		// and facetKey (stable id for reconciliation); they aren't shown on the
		// canvas and the generator itself isn't shown on the workspace.
		facet = $state(false);
		facetParent = $state(null);
		facetKey = $state(null);
		// Live Column Set inputs, keyed by channel: `series` (tableplot), `data`
		// (single-input plots like Histogram), or `y` (x/y plots — one y-series per
		// selected column, sharing the plot's primary x). Each value is a list of
		// Column Set table-process ids. reconcileAllPlotSets() materialises the
		// selected columns into this plot's series and keeps them in sync as the
		// set's rule / candidate columns change (see syncPlotSets).
		setRefs = $state({});
		// Scalar-metric output columns ({ key → colId }, e.g. peak_period) for
		// analysis plots — see plots/plotMetricOutputs.js. Persisted so wiring
		// from a plot's metric ports survives reload.
		metricOut = $state({});

		constructor(plotData = {}, id = null) {
			// console.log('new plot: ', plotData);
			// console.log('plotdata.width: ', plotData.width);
			if (id === null) {
				this.id = getNextId();
			} else {
				this.id = id;
				_counter = Math.max(id + 1, _counter + 1);
			}
			//need to set the plot type first to get the display name
			this.type = plotData.type;

			if (!this.type) {
				throw new Error('Plot type is required');
			}

			const plotTypeEntry = appConsts.plotMap.get(this.type);
			if (!plotTypeEntry) {
				throw new Error(`Unknown plot type: ${this.type}`);
			}

			if (typeof plotTypeEntry.data.fromJSON !== 'function') {
				throw new Error(`plotTypeEntry.data.fromJSON is not a function`);
			}

			// Set display name for the plot type
			this.typeDisplayName = plotTypeEntry.displayName || this.type;

			//set things - use display name in default plot name
			this.name = plotData.name ?? `${this.typeDisplayName}_${this.id}`;
			this.x = plotData.x ?? 350;
			this.y = plotData.y ?? 150;
			this.width = plotData.width ?? 500;
			this.height = plotData.height ?? 250;

			this.plot = plotTypeEntry.data.fromJSON(this, plotData.plot);

			this.facet = plotData.facet ?? false;
			this.facetParent = plotData.facetParent ?? null;
			this.facetKey = plotData.facetKey ?? null;
			this.setRefs =
				plotData.setRefs && typeof plotData.setRefs === 'object' ? { ...plotData.setRefs } : {};
			this.metricOut =
				plotData.metricOut && typeof plotData.metricOut === 'object'
					? { ...plotData.metricOut }
					: {};
			// Quick-Plot: the canvas node this plot was spawned from (for the reference
			// edge + re-click focus). null for normal user-created plots.
			this.sourceNodeId = plotData.sourceNodeId ?? null;
		}

		toJSON() {
			return {
				id: this.id,
				name: this.name,
				x: this.x,
				y: this.y,
				width: this.width,
				height: this.height,
				type: this.type,
				selected: this.selected,
				facet: this.facet,
				facetParent: this.facetParent,
				facetKey: this.facetKey,
				setRefs: this.setRefs,
				metricOut: this.metricOut,
				sourceNodeId: this.sourceNodeId,
				plot: this.plot
			};
		}
		static fromJSON(json) {
			const id = json.id ?? json.plotid;
			const name = json.name ?? 'Untitled Plot';

			const {
				x,
				y,
				width,
				height,
				type,
				selected,
				plot,
				facet,
				facetParent,
				facetKey,
				setRefs,
				metricOut,
				sourceNodeId
			} = json;
			return new Plot(
				{
					name,
					x,
					y,
					width,
					height,
					type,
					selected,
					plot,
					facet,
					facetParent,
					facetKey,
					setRefs,
					metricOut,
					sourceNodeId
				},
				id
			);
		}
	}
</script>

<script>
	let { plot } = $props();
	const Plot = appConsts.plotMap.get(plot.type).plot ?? null;
</script>

<div>
	<Plot bind:theData={plot} which="plot" />
</div>

<div>
	<Plot theData={plot.plot} which="controls" />
</div>
