<script module>
	// @ts-nocheck
	import { plotHasOutputs } from '$lib/plots/plotMetricOutputs.svelte.js';
	import { computeKey } from '$lib/core/computeOwners.svelte.js';

	/**
	 * Every node that computes inside its own component, as `{ key, kind, name, obj }`:
	 * table processes, free and column-owned column processes, and plots that publish
	 * metric output ports (or, for a node-results Table, declared output ports). Enumerated from core, NOT from the projected canvas graph: the
	 * graph drops the members of a collapsed composite, and those still have to compute.
	 * Nodes with nothing to recompute (data, groups, notes, composites, plots without
	 * metric outputs) are not listed.
	 *
	 * Pure and exported so the selection is unit-tested without mounting real node
	 * components.
	 */
	export function computeTargets(state) {
		const out = [];
		for (const tp of state?.tableProcesses ?? []) {
			if (tp?.id == null) continue;
			out.push({
				key: computeKey('tableprocess', tp.id),
				kind: 'tableprocess',
				name: tp.name,
				obj: tp
			});
		}
		const processes = [
			...(state?.orphanProcesses ?? []),
			...(state?.data ?? []).flatMap((c) => c?.processes ?? [])
		];
		for (const p of processes) {
			if (p?.id == null) continue;
			out.push({ key: computeKey('process', p.id), kind: 'process', name: p.name, obj: p });
		}
		for (const plot of state?.plots ?? []) {
			// A metric plot always; a Table only in Node results mode with declared outputs.
			if (plot?.id == null || !plotHasOutputs(plot)) continue;
			out.push({ key: computeKey('plot', plot.id), kind: 'plot', name: plot.type, obj: plot });
		}
		return out;
	}
</script>

<script>
	// @ts-nocheck
	// Headless compute host: keeps every node's outputs a function of its current inputs,
	// whether or not the node is on screen.
	//
	// Every analysis / transform node computes its output columns inside its own
	// component's $effect, and every metric plot writes its output ports from its own
	// component. A node whose component is not mounted therefore does not compute: its
	// outputs keep the last values written (or the values saved in the session file)
	// while its inputs change, and everything wired downstream reads those stale values.
	// The component is unmounted whenever the node is not visible: collapsed on the
	// canvas, inside a collapsed composite, a plot hidden from the workspace, and, in the
	// plots view, any node that is not the one selected.
	//
	// This host mounts a hidden instance of the SAME component (the exact code the
	// expanded panel runs; there is no second compute path) for every such node, and only
	// for those: each place that shows a node's computing instance claims it in the
	// registry (core/computeOwners.svelte.js), and a claimed node gets no hidden instance.
	// So a node is computed by exactly one instance unless the user shows it in two
	// places at once (expanded on the canvas and selected in the control panel), and
	// those two share one computation per input hash through the node memo
	// (core/computeMemo.js).
	//
	// Handing over between the hidden and the visible instance costs no computation: the
	// memo outlives either instance, so the instance that mounts finds the hash already
	// handled and restores the cached panel state. That is also why mounting it in every
	// view (not just the plots view, as before 2026-09-30) does not recompute anything on
	// a view switch.
	//
	// Plots are mounted as `which="compute"`, which runs their calculation and metric
	// effects and renders nothing (the same instance a facet generator uses).
	//
	// A hidden instance stands down AT ONCE when a visible one is claimed (so two never
	// run side by side), but is only mounted once a node has gone unclaimed for
	// GRACE_MS. While a session loads the canvas mounts and remounts its panels several
	// times; without the grace every gap mounted, and then tore down, a full hidden
	// instance of every node (measured: 21 hidden mounts on the rest-activity demo, which
	// needs none). A gap that short costs nothing: whichever instance mounts next picks
	// up the memo, or recomputes if the inputs moved meanwhile.
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { appConsts, core } from '$lib/core/core.svelte.js';
	import { hasComputeOwner } from '$lib/core/computeOwners.svelte.js';
	import ErrorBoundary from '$lib/components/reusables/ErrorBoundary.svelte';

	const GRACE_MS = 50;

	const unclaimed = $derived(computeTargets(core).filter((t) => !hasComputeOwner(t.key)));
	/** Keys that have stayed unclaimed for the grace period. */
	const settled = new SvelteSet();
	const hidden = $derived(unclaimed.filter((t) => settled.has(t.key)));

	$effect(() => {
		const keys = new Set(unclaimed.map((t) => t.key));
		const pending = untrack(() => {
			for (const k of [...settled]) if (!keys.has(k)) settled.delete(k);
			return [...keys].filter((k) => !settled.has(k));
		});
		if (pending.length === 0) return;
		const timer = setTimeout(() => {
			for (const k of pending) if (!hasComputeOwner(k)) settled.add(k);
		}, GRACE_MS);
		return () => clearTimeout(timer);
	});

	function componentFor(t) {
		if (t.kind === 'tableprocess') return appConsts.tableProcessMap.get(t.name)?.component;
		if (t.kind === 'process') return appConsts.processMap.get(t.name)?.component;
		return appConsts.plotMap.get(t.name)?.plot;
	}
</script>

<div class="node-compute-host" aria-hidden="true">
	{#each hidden as t (t.key)}
		{@const Comp = componentFor(t)}
		{#if Comp}
			<div data-compute-key={t.key}>
				<!-- One boundary per hidden instance. Without it, ONE node that throws here
				     unmounts this host and with it the compute of every other node nobody is
				     looking at (ROB-12). The error box itself is off screen; reportError's
				     toast is what the user sees. -->
				<ErrorBoundary
					source="background"
					context={`calculating "${t.obj?.displayName ?? t.obj?.name ?? t.name}"`}
				>
					{#if t.kind === 'plot'}
						<Comp theData={t.obj} which="compute" />
					{:else}
						<!-- Function binding (no-op setter): see CanvasNodeControls. -->
						<Comp bind:p={() => t.obj, () => {}} />
					{/if}
				</ErrorBoundary>
			</div>
		{/if}
	{/each}
</div>

<style>
	/* Kept in the DOM (so lifecycle + $effects run) but fully out of sight and out
	   of the layout / hit-testing. Not display:none — some node components read
	   layout on mount, and we want their compute effects to behave identically to a
	   normally-rendered instance. */
	.node-compute-host {
		position: absolute;
		left: -99999px;
		top: 0;
		width: 1px;
		height: 1px;
		overflow: hidden;
		visibility: hidden;
		pointer-events: none;
	}
</style>
