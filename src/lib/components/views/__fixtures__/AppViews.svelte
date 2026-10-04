<script>
	// @ts-nocheck
	// Test fixture: the part of +page.svelte that decides which node components are mounted.
	// The canvas view mounts WorkflowEditor, the plots view PlotDisplay, and NodeComputeHost
	// is mounted in both, outside the view branch. CanvasNodeControls stands in for the
	// control panel: ControlDisplay shows it whenever a single non-plot node is selected,
	// in either view, and it mounts that node's component.
	import WorkflowEditor from '$lib/components/workflow/WorkflowEditor.svelte';
	import PlotDisplay from '$lib/components/views/PlotDisplay.svelte';
	import NodeComputeHost from '$lib/components/views/NodeComputeHost.svelte';
	import CanvasNodeControls from '$lib/components/views/CanvasNodeControls.svelte';
	import { appState } from '$lib/core/core.svelte.js';
</script>

{#if appState.view === 'canvas'}
	<WorkflowEditor inline={true} />
{:else}
	<PlotDisplay />
{/if}
<NodeComputeHost />
{#if appState.canvasSelectedNodeId != null && !String(appState.canvasSelectedNodeId).startsWith('plot_')}
	<CanvasNodeControls />
{/if}
