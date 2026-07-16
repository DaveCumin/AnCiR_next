<script module>
	// @ts-nocheck
	// The node types that own a reactive compute effect (produce output columns):
	// table-processes and free column-processes. Data / plot / group / note / composite
	// nodes have nothing to recompute. Exported + pure so the selection is unit-tested
	// without mounting real node components (which run canvas/onMount side effects).
	export function selectComputeNodes(graphNodes) {
		return (graphNodes ?? []).filter((n) => n?.type === 'tableprocess' || n?.type === 'process');
	}
</script>

<script>
	// @ts-nocheck
	// Headless compute host: mounts a hidden, compute-only instance of every
	// table-process and column-process node so their reactive $effects keep
	// running regardless of which node (if any) is selected or expanded.
	//
	// Why this exists: every analysis / transform node computes its output
	// columns inside its own Svelte component's $effect, gated by
	// `if (!mounted) return`. In the workflow (canvas) view WorkflowEditor mounts
	// every node, so the whole pipeline stays live and downstream nodes recompute
	// when an upstream one changes. In the workspace (plots) view WorkflowEditor
	// is absent and the ONLY node that mounts is the one selected in the panel
	// (via CanvasNodeControls). So editing a node recomputes it, but any node
	// DOWNSTREAM of it never re-runs — its output columns, and every plot reading
	// them, stay stale. Example: `data → OutlierRemoval → Split → actogram`;
	// editing OutlierRemoval updates its own output but Split (unmounted) never
	// re-splits, so the actogram never redraws.
	//
	// Mounting every compute node here keeps the full chain reactive from the
	// plots view. This host is mounted only OUTSIDE the canvas view (WorkflowEditor
	// already keeps nodes live there). The single node that CanvasNodeControls also
	// mounts (the selected one) gets a duplicate instance — safe because output
	// reconcile is idempotent (initYColumns only creates missing columns;
	// syncYColumns reuses by key) and each instance carries its own calc token.
	// The same expanded-and-selected double-mount already occurs in the canvas
	// view without issue.
	import { appConsts, getProcessNodeGraph } from '$lib/core/core.svelte.js';

	// The projected node graph already resolves each table-process (tpObj/tpName)
	// and free column-process (processObj/processName) exactly as the editor panels
	// do, so reuse it rather than re-deriving from core. Keyed by node.id below so
	// instances stay stable across graph recomputes (no remount churn).
	const computeNodes = $derived(selectComputeNodes(getProcessNodeGraph().nodes));
</script>

<div class="node-compute-host" aria-hidden="true">
	{#each computeNodes as node (node.id)}
		{#if node.type === 'tableprocess' && node.tpObj}
			{@const TPComp = appConsts.tableProcessMap.get(node.tpName)?.component}
			{#if TPComp}<TPComp p={node.tpObj} />{/if}
		{:else if node.type === 'process' && node.processObj}
			{@const PComp = appConsts.processMap.get(node.processName)?.component}
			{#if PComp}<PComp p={node.processObj} />{/if}
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
