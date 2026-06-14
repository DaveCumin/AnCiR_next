<script>
	// @ts-nocheck
	import { createEventDispatcher } from 'svelte';
	import MiniDataTable from './MiniDataTable.svelte';
	import { getColumnById } from '$lib/core/Column.svelte';
	let { node, selected = false, expanded = false, isDropTarget = false } = $props();
	const dispatch = createEventDispatcher();

	const typeColors = {
		data: '#b3d9f2',
		process: '#fffacc',
		tableprocess: '#ffe0b3',
		plot: '#b3f2cc'
	};

	let bgColor = $derived(node.tableColor ?? typeColors[node.type] ?? '#eee');
	let isEditable = $derived(node.type === 'process' || node.type === 'tableprocess');
	// Plot nodes always have a preview panel below, so apply the expanded border style
	let hasPanel = $derived(node.type === 'plot' || expanded);

	let inputPorts = $derived(node.ports?.inputs ?? []);
	let outputPorts = $derived(node.ports?.outputs ?? []);

	function portY(index, count) {
		if (!count) return 24;
		return ((index + 1) * 48) / (count + 1);
	}

	function startFromOutput(e, portName) {
		e.stopPropagation();
		e.preventDefault();
		dispatch('portstart', { nodeId: node.id, port: portName, direction: 'out' });
	}

	function endAtInput(e, portName) {
		e.stopPropagation();
		e.preventDefault();
		dispatch('portend', { nodeId: node.id, port: portName, direction: 'in' });
	}

	function disconnectInput(e, portName) {
		e.stopPropagation();
		if (!e.shiftKey && e.button !== 2) return;
		e.preventDefault();
		dispatch('portdisconnect', { nodeId: node.id, port: portName, direction: 'in' });
	}
</script>

<div
	class="workflow-node"
	class:selected
	class:expanded={hasPanel}
	class:drop-target={isDropTarget}
	style="background-color: {bgColor};"
	role="button"
	tabindex="0"
>
	<div class="node-header">
		<div class="node-label">{node.label}</div>
		{#if isDropTarget}
			<span class="drop-badge" title="Drop to replace all references">↓ replace</span>
		{:else if isEditable}
			<span class="expand-indicator" title={expanded ? 'Collapse' : 'Expand to edit'}>
				{expanded ? '▲' : '▼'}
			</span>
		{/if}
	</div>
	{#if node.sublabel}
		<div class="node-sublabel">{node.sublabel}</div>
	{/if}

	{#if node.type === 'data' && node.refId != null}
		{@const col = getColumnById(node.refId)}
		{#if col}
			<MiniDataTable column={col} maxRows={5} />
		{/if}
	{/if}

	{#each inputPorts as port, i (`in_${port.name}_${i}`)}
		<div
			class="port-handle port-in"
			style="top:{portY(i, inputPorts.length)}px;"
			title={`Input: ${port.name}`}
			onmousedown={(e) => disconnectInput(e, port.name)}
			onmouseup={(e) => endAtInput(e, port.name)}
			oncontextmenu={(e) => disconnectInput(e, port.name)}
			role="button"
			tabindex="-1"
		></div>
		<div class="port-label port-label-in" style="top:{portY(i, inputPorts.length)}px;">
			{port.name}
		</div>
	{/each}

	{#each outputPorts as port, i (`out_${port.name}_${i}`)}
		<div
			class="port-handle port-out"
			style="top:{portY(i, outputPorts.length)}px;"
			title={`Output: ${port.name}`}
			onmousedown={(e) => startFromOutput(e, port.name)}
			role="button"
			tabindex="-1"
		></div>
		<div class="port-label port-label-out" style="top:{portY(i, outputPorts.length)}px;">
			{port.name}
		</div>
	{/each}
</div>

<style>
	.workflow-node {
		width: 160px;
		min-height: 48px;
		position: relative;
		border-radius: 6px;
		border: 1.5px solid rgba(0, 0, 0, 0.15);
		padding: 6px 10px;
		cursor: grab;
		user-select: none;
		box-sizing: border-box;
		font-size: 12px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		transition: border-color 0.1s;
	}

	.workflow-node:hover {
		border-color: rgba(0, 0, 0, 0.3);
	}

	.workflow-node.selected {
		border: 2px solid #0275ff;
		box-shadow: 0 0 0 2px rgba(2, 117, 255, 0.2);
	}

	.workflow-node.expanded {
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
		border-bottom-color: transparent;
	}

	.workflow-node.drop-target {
		border: 2px dashed #28a745;
		box-shadow: 0 0 0 3px rgba(40, 167, 69, 0.25);
		background-color: #e8f8ec !important;
	}

	.node-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 4px;
		position: relative;
		z-index: 1;
	}

	.node-label {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
	}

	.expand-indicator {
		font-size: 9px;
		color: #666;
		flex-shrink: 0;
		pointer-events: none;
	}

	.drop-badge {
		font-size: 9px;
		font-weight: 700;
		color: #28a745;
		flex-shrink: 0;
		white-space: nowrap;
	}

	.node-sublabel {
		font-size: 10px;
		color: #555;
		background-color: rgba(0, 0, 0, 0.08);
		border-radius: 3px;
		padding: 1px 4px;
		display: inline-block;
		margin-top: 2px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}

	.port-handle {
		position: absolute;
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: #ffffff;
		border: 1px solid rgba(0, 0, 0, 0.45);
		transform: translateY(-50%);
		pointer-events: auto;
		cursor: crosshair;
	}

	.port-in {
		left: -4px;
	}

	.port-out {
		right: -4px;
	}

	.port-label {
		position: absolute;
		transform: translateY(-50%);
		font-size: 9px;
		line-height: 1;
		color: rgba(0, 0, 0, 0.65);
		background: rgba(255, 255, 255, 0.9);
		border: 1px solid rgba(0, 0, 0, 0.15);
		border-radius: 3px;
		padding: 1px 3px;
		pointer-events: none;
		opacity: 0;
		transition: opacity 120ms ease;
		max-width: 54px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.workflow-node:hover .port-label {
		opacity: 1;
	}

	.port-label-in {
		left: 8px;
	}

	.port-label-out {
		right: 8px;
	}
</style>
