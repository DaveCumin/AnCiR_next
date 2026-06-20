<script module>
	// @ts-nocheck
	import { Column, getColumnById } from '$lib/core/Column.svelte';

	import { appConsts, appState, core, snapToGrid } from '$lib/core/core.svelte';
	let _counter = 0;
	function getNextId() {
		return _counter++;
	}

	export function getPlotById(id) {
		const thePlot = core.plots.find((plot) => plot.id === id);
		return thePlot;
	}

	function deletePlotIds(ids) {
		const idSet = new Set(ids);
		// Deleting a facet generator also removes its generated children.
		core.plots = core.plots.filter(
			(p) => !idSet.has(p.id) && !(p.facetParent != null && idSet.has(p.facetParent))
		);
	}

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
		plot;
		// Faceting (small multiples): a generator plot has facet=true and produces
		// one child plot per series. Children carry facetParent (the generator id)
		// and facetKey (stable id for reconciliation); they aren't shown on the
		// canvas and the generator itself isn't shown on the workspace.
		facet = $state(false);
		facetParent = $state(null);
		facetKey = $state(null);

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
				plot: this.plot
			};
		}
		static fromJSON(json) {
			const id = json.id ?? json.plotid;
			const name = json.name ?? 'Untitled Plot';

			const { x, y, width, height, type, selected, plot, facet, facetParent, facetKey } = json;
			return new Plot(
				{ name, x, y, width, height, type, selected, plot, facet, facetParent, facetKey },
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
