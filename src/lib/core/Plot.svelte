<script module>
	// @ts-nocheck
	import { Column } from '$lib/core/Column.svelte';
	import { reportUnknownNode } from '$lib/core/unknownNode.js';

	import { appConsts, appState, core, snapToGrid } from '$lib/core/core.svelte';
	import { setSelection } from '$lib/tableProcesses/columnSet.js';
	import { removePlotMetricColumns } from '$lib/plots/plotMetricOutputs.svelte.js';
	import { newFigureStyle, normaliseFigureStyle } from '$lib/plots/figureStyle.js';
	import { FACETABLE_PLOT_TYPES as SHARED_FACETABLE_PLOT_TYPES } from '$lib/core/facetTypes.js';
	import { sanitiseOverrides } from '$lib/core/facetOverrides.js';
	import { allPanels } from '$lib/core/facetPanels.svelte.js';
	import { addNotification } from '$lib/core/notifications.svelte.js';
	// The facet type sets live in facetTypes.js (shared with the panel engine and the session
	// migration, which must stay free of this module); re-exported so existing importers work.
	export const FACETABLE_PLOT_TYPES = SHARED_FACETABLE_PLOT_TYPES;
	let _counter = 0;
	function getNextId() {
		let id = _counter++;
		// Never hand out an id a live plot already holds. Reservation below covers the plots a
		// session is ABOUT to rebuild; this covers the ones already standing.
		while (core.plots.some((p) => p.id === id)) id = _counter++;
		return id;
	}

	/**
	 * Claim every id an incoming session owns, BEFORE any of its plots are rebuilt.
	 *
	 * The load loop yields a frame between plots so the compositor stays responsive, which lets
	 * Svelte effects run mid-import. Until v76.4 a faceted plot's reconcile spawned child plots
	 * through this same allocator mid-load, so a child could be minted with an id that a plot
	 * later in the file already owned, and the workspace then keyed an `{#each}` on two plots
	 * with the same id. Facets are views now (no plot is minted during a load), but the
	 * reservation stays as a backstop for any other mid-load minting path (plan 0.2, 5.11).
	 * Monotonic, so opening a smaller session afterwards cannot rewind the counter.
	 */
	export function reservePlotIds(ids) {
		for (const id of ids ?? []) {
			if (Number.isFinite(id)) _counter = Math.max(_counter, id + 1);
		}
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
		const isDeleted = (p) => idSet.has(p.id);
		// Metric out-columns belong to the plot — delete them with it.
		for (const p of core.plots) {
			if (isDeleted(p)) removePlotMetricColumns(p);
		}
		core.plots = core.plots.filter((p) => !isDeleted(p));
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
		if (!plot) return;
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

	// Selection lives on plots AND on facet panels (facetPanels.svelte.js, plan 1.5), so every
	// helper below walks both. `id` may be a numeric plot id or a panel id string.
	export function selectPlot(e, id) {
		const all = [...core.plots, ...allPanels()];
		if (e.altKey) {
			// Alt held: toggle just this one.
			all.forEach((p) => {
				if (p.id == id) p.selected = !p.selected;
			});
		} else {
			// Deselect everything else and select this one.
			all.forEach((p) => {
				p.selected = p.id == id;
			});
		}
	}
	// Every renderable: the top-level plots and every panel. A generator is not drawn, so it
	// is not selected here (its canvas node selects it, see plotRefs.selectedRefs).
	export function selectAllPlots() {
		core.plots.forEach((p) => (p.selected = !p.facet));
		allPanels().forEach((p) => (p.selected = true));
	}
	export function deselectAllPlots() {
		core.plots.forEach((p) => (p.selected = false));
		allPanels().forEach((p) => (p.selected = false));
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
		// Faceting (small multiples): a generator plot has facet=true and is shown on the
		// workspace as one PANEL per series (core/facetPanels.svelte.js). Panels are views
		// derived from the generator on read: never in core.plots, never saved.
		facet = $state(false);
		// Rows the panel grid uses. 0 = automatic (near-square), which is what every plot did
		// before this option existed and what a session saved without the field loads as.
		// Columns follow from the row count; see facetGrid.js.
		facetRows = $state(0);
		// Per-panel overrides of a facet generator: { [unitKey]: { [innerPath]: value } }. Phase 1
		// admits axis limits only (facetOverrides.js). Persisted only when non-empty.
		facetOverrides = $state({});
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
		// style — this figure's own copy of the figure style (typeface, base type
		// size, physical width, export DPI, background, marker flags). See
		// plots/figureStyle.js.
		//
		// A COPY, taken from core.figureStyle at creation, not a live reference to it.
		// That is the whole model: editing the session template must not restyle
		// figures already finished, so retrofitting is an explicit "Apply to all".
		style = $state();

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
			// `??` not `||`: 0 is the meaningful "automatic" value, not a missing one.
			this.facetRows = plotData.facetRows ?? 0;
			// A wrong shape anywhere in the map loads as {} with a load warning, so a hand-edited
			// or stale session can never put a panel into a state the projection cannot apply.
			const { overrides, reason } = sanitiseOverrides(plotData.facetOverrides);
			this.facetOverrides = overrides;
			if (reason)
				addNotification(
					`Plot '${this.name}': ${reason}; the panel overrides were dropped`,
					'warning',
					0
				);
			this.setRefs =
				plotData.setRefs && typeof plotData.setRefs === 'object' ? { ...plotData.setRefs } : {};
			this.metricOut =
				plotData.metricOut && typeof plotData.metricOut === 'object'
					? { ...plotData.metricOut }
					: {};
			// Quick-Plot: the canvas node this plot was spawned from (for the reference
			// edge + re-click focus). null for normal user-created plots.
			this.sourceNodeId = plotData.sourceNodeId ?? null;
			// A saved style wins; otherwise copy the session template. Normalised either
			// way, so a plot from an older session (no style at all) or a hand-edited one
			// still ends up with every field present and valid.
			this.style = plotData.style
				? normaliseFigureStyle(plotData.style)
				: newFigureStyle(core.figureStyle);
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
				facetRows: this.facetRows,
				...(Object.keys(this.facetOverrides ?? {}).length > 0 && {
					facetOverrides: this.facetOverrides
				}),
				setRefs: this.setRefs,
				metricOut: this.metricOut,
				sourceNodeId: this.sourceNodeId,
				style: this.style,
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
				facetRows,
				facetOverrides,
				setRefs,
				metricOut,
				sourceNodeId,
				style
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
					facetRows,
					facetOverrides,
					setRefs,
					metricOut,
					sourceNodeId,
					style
				},
				id
			);
		}
	}
</script>

<script>
	let { plot } = $props();
	// Optional chaining: an unknown plot type used to throw a bare
	// "Cannot read properties of undefined" from the render.
	const PlotComponent = appConsts.plotMap.get(plot.type)?.plot ?? null;
	const unknownPlotMessage = PlotComponent ? '' : reportUnknownNode('plot', plot.type);
</script>

<div>
	{#if !PlotComponent}
		<p class="unknown-node">{unknownPlotMessage}</p>
	{:else}
		<PlotComponent bind:theData={plot} which="plot" />
	{/if}
</div>

<div>
	{#if PlotComponent}
		<PlotComponent theData={plot.plot} which="controls" />
	{/if}
</div>

<style>
	.unknown-node {
		font-size: var(--font-xs);
		color: var(--color-warning-text);
		background: var(--color-warning-bg);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		margin: 0;
	}
</style>
